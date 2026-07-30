// Orchestrace sezóny – čisté funkce nad SeasonState (žádné IO). Každé kolo má
// vlastní deterministický RNG odvozený ze seedu + čísla kola → výsledky nezávisí
// na průběhu session (odolné vůči reloadu/uložení do DB mezi koly). Zápasové plány,
// morálka a eventy hýbou λ TVÉHO týmu; AI soupeři jedou neutrálně (NEUTRAL_ADJUST).

import { deriveSeed, mulberry32, shuffle } from "./rng";
import { composeAdjust } from "./adjust";
import { matchStakes } from "./stakes";
import type { MatchStakes } from "./stakes";
import { generateLeague, teamById } from "./teams";
import { roundRobin } from "./schedule";
import { simulateMatch, predictProbs, NEUTRAL_ADJUST } from "./simulate";
import { expectedPointsOf } from "./expectedPoints";
import { winProbOf } from "./tacticImpact";
import type { SideAdjust } from "./simulate";
import { buildTable } from "./standings";
import { MOCK_LEAGUE, seasonObjective, teamStrengthScore } from "./leagues";
import { scoutOpponent } from "./scouting";
import type { ScoutReport } from "./scouting";
import { updateMorale } from "./morale";
import { updateFitness } from "./fitness";
import { maybeEvent } from "./events";
import { RNG_SALT_LEAGUE } from "./agency";
import type { AgencyState } from "./agency";
import { STARTING_FITNESS, STARTING_MORALE } from "./balance";
import type {
  Fixture,
  GameTeam,
  Instruction,
  LeagueAccess,
  MatchProbs,
  MatchResult,
  Plan,
  SeasonState,
} from "./types";

/**
 * Založí novou sezónu: rozlosuje ligu a nastaví tvůj tým. Bez `teams` vygeneruje
 * fiktivní ligu (mock/offline); s `teams` (reálná liga z API) použije je.
 */
export function newSeason(
  seed: number,
  yourTeamId: number,
  opts: {
    season?: number;
    teams?: GameTeam[];
    leagueId?: number;
    leagueName?: string;
    leagueAccess?: LeagueAccess | null;
    /** Kumulativní investice do mládeže – přenáší se s klubem, ne s trenérem. */
    youth?: number;
    /** Kumulativní investice do skautingu – také patří klubu. */
    scouting?: number;
  } = {}
): SeasonState {
  const league = opts.teams ?? generateLeague(seed);
  // Pořadí id do rozlosování promíchat seedem (vlastní RNG stream, salt 50000):
  // - `injectYourTeam` staví tvůj klub vždy na index 0, jinak by dostával privilegovanou
  //   pozici fixního týmu (jediný s dokonalým střídáním doma/venku),
  // - `startNextSeason` zachovává pořadí pole `teams`, takže bez míchání by měla každá
  //   sezóna kariéry identický rozpis kol (lišily by se jen výsledky).
  // Míchá se jen kopie id; `state.teams` (a tím tabulka) zůstává v původním pořadí.
  const schedule = roundRobin(
    shuffle(
      league.map((t) => t.id),
      mulberry32(deriveSeed(seed, 50000))
    )
  );
  const leagueId = opts.leagueId ?? MOCK_LEAGUE.id;
  const leagueAccess = opts.leagueAccess ?? null;
  const you = teamById(league, yourTeamId);
  const state: SeasonState = {
    season: opts.season ?? 1,
    leagueId,
    leagueName: opts.leagueName ?? MOCK_LEAGUE.name,
    seed,
    rngSalt: RNG_SALT_LEAGUE,
    teams: league,
    yourTeamId,
    schedule,
    results: [],
    round: 0,
    plan: "balanced",
    instruction: "none",
    morale: STARTING_MORALE,
    fitness: STARTING_FITNESS,
    youth: opts.youth ?? 0,
    scouting: opts.scouting ?? 0,
    devBonus: 0,
    objective: seasonObjective(you, league, leagueId, leagueAccess),
    modifiers: [],
    scoutBoostUntilRound: null,
    pendingEvent: null,
    leagueAccess,
  };
  // `maybeEvent` filtruje eventy podle stavu (podmínky), takže potřebuje hotový state.
  return { ...state, pendingEvent: maybeEvent(state, nextOpponentOf(state)) };
}

/**
 * Soupeř tvého týmu v aktuálním kole, nebo `null` (sezóna dohraná). Odvozené ze `schedule`,
 * NEUKLÁDÁ se do stavu – uložená kopie by se mohla rozejít s rozpisem. Agency ho dostává
 * jako parametr (`maybeEvent`).
 */
export function nextOpponentOf(state: SeasonState): number | null {
  const fixtures = state.schedule[state.round];
  if (!fixtures) return null;
  const f = fixtures.find(
    (x) => x.homeId === state.yourTeamId || x.awayId === state.yourTeamId
  );
  if (!f) return null;
  return f.homeId === state.yourTeamId ? f.awayId : f.homeId;
}

/** Je sezóna dohraná? */
export function isSeasonOver(state: SeasonState): boolean {
  return state.round >= state.schedule.length;
}

/** Nastaví zápasový plán pro nejbližší zápas (jinak stav nemění). */
export function setPlan(state: SeasonState, plan: Plan): SeasonState {
  return { ...state, plan };
}

/** Nastaví vedlejší instrukci pro nejbližší zápas (jinak stav nemění). */
export function setInstruction(state: SeasonState, instruction: Instruction): SeasonState {
  return { ...state, instruction };
}

/**
 * Výsledná úprava λ TVÉHO týmu proti danému soupeři: plán × counter (dle SKUTEČNÉHO stylu
 * soupeře) × instrukce (dle traitů) × morálka × kondice × aktivní eventové modifikátory.
 * Čistá – `plan`/`instruction` jsou explicitní parametry, aby náhled predikce
 * (`yourNextMatch`) mohl počítat s neutrální volbou nezávisle na tom, co je zrovna
 * vybrané ve `state` (viz `resolveYourAdjust`).
 *
 * Counter čte `scout.style` (pravdu), ne `scout.reportedStyle` (co vidí hráč) – protitah
 * buď opravdu sedne, nebo ne, podle skutečnosti.
 */
export function resolveAdjust(
  state: AgencyState,
  oppId: number,
  plan: Plan,
  instruction: Instruction
): SideAdjust {
  const scout = scoutOpponent(state, oppId);
  return composeAdjust(state, scout.style, scout.traits, plan, instruction);
}

/** Úprava λ tvého týmu se SKUTEČNĚ zvolenou taktikou – používá se při odehrání kola. */
export function resolveYourAdjust(state: AgencyState, oppId: number): SideAdjust {
  return resolveAdjust(state, oppId, state.plan, state.instruction);
}

/** Odehraje jedno kolo (tvůj plán/morálka/eventy platí jen pro tvůj zápas). */
export function playRound(state: SeasonState): SeasonState {
  if (isSeasonOver(state)) return state;
  const fixtures = state.schedule[state.round];
  const rand = mulberry32(deriveSeed(state.seed, state.round));
  const results = state.results.slice();
  const you = teamById(state.teams, state.yourTeamId);
  let yourResult: MatchResult | null = null;
  let oppStronger = false;

  for (const f of fixtures) {
    const home = teamById(state.teams, f.homeId);
    const away = teamById(state.teams, f.awayId);
    const youHome = f.homeId === state.yourTeamId;
    const youAway = f.awayId === state.yourTeamId;
    const homeAdj: SideAdjust = youHome
      ? resolveYourAdjust(state, f.awayId)
      : NEUTRAL_ADJUST;
    const awayAdj: SideAdjust = youAway
      ? resolveYourAdjust(state, f.homeId)
      : NEUTRAL_ADJUST;
    const r = simulateMatch(home, away, homeAdj, awayAdj, rand);
    const mr: MatchResult = {
      round: state.round,
      homeId: f.homeId,
      awayId: f.awayId,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
      // Očekávané body tvého týmu – ze STEJNÉ λ, jakou zápas právě odehrál (plán,
      // counter, instrukce, morálka, kondice, eventy jsou v `homeAdj`/`awayAdj`).
      // Ne z náhledu `yourNextMatch`, ten jede neutrálně kvůli anti-exploitu a rozdíl
      // proti němu by měřil „zabrala taktika", ne smůlu. Viz `expectedPoints.ts`.
      // `r.probs` je z TÉŽE mřížky, jakou se sampluje skóre – druhé `predictProbs`
      // by počítalo totéž znovu a mohlo se rozejít.
      ...(youHome || youAway
        ? matchTacticFields(state, home, away, youHome, r.probs)
        : {}),
    };
    results.push(mr);
    if (youHome || youAway) {
      yourResult = mr;
      const opp = youHome ? away : home;
      oppStronger = teamStrengthScore(opp) > teamStrengthScore(you);
    }
  }

  const nextRound = state.round + 1;
  let morale = state.morale;
  let fitness = state.fitness;
  if (yourResult) {
    const isHome = yourResult.homeId === state.yourTeamId;
    const forG = isHome ? yourResult.homeGoals : yourResult.awayGoals;
    const agG = isHome ? yourResult.awayGoals : yourResult.homeGoals;
    const outcome = forG > agG ? "W" : forG < agG ? "L" : "D";
    morale = updateMorale(state.morale, outcome, oppStronger);
    // Kondice se hýbe podle plánu, kterým jsi zápas odehrál (únava − regenerace).
    fitness = updateFitness(state.fitness, state.plan);
  }
  // Prořezat expirované modifikátory a připravit event pro nové kolo.
  const modifiers = state.modifiers.filter((m) => m.untilRound >= nextRound);
  const next: SeasonState = {
    ...state,
    results,
    round: nextRound,
    morale,
    fitness,
    modifiers,
    pendingEvent: null,
  };
  // Event se losuje z eventů, které pro NOVÝ stav splňují podmínku → potřebuje `next`.
  return {
    ...next,
    pendingEvent:
      nextRound < state.schedule.length ? maybeEvent(next, nextOpponentOf(next)) : null,
  };
}

/**
 * Pole `xp`/`xpBase`/`win`/`winBase` pro TVŮJ zápas: skutečná predikce + kontrafaktuál
 * „co kdybys nechal `balanced`/`none`".
 *
 * Základna se počítá ze **stejného stavu** (tedy s toutéž morálkou, kondicí i eventovými
 * modifikátory) – v rozdílu se proto vyruší a zůstane čistý efekt tvé volby. Je to zároveň
 * přesně ten výpočet, který hráč viděl v náhledu (`yourNextMatch`), takže hlášení po zápase
 * navazuje na číslo, které mu appka ukázala. Viz `tacticImpact.ts`.
 */
function matchTacticFields(
  state: SeasonState,
  home: GameTeam,
  away: GameTeam,
  youHome: boolean,
  probs: MatchProbs
): Pick<MatchResult, "xp" | "xpBase" | "win" | "winBase"> {
  const oppId = youHome ? away.id : home.id;
  const baseAdj = resolveAdjust(state, oppId, "balanced", "none");
  const baseProbs = predictProbs(
    home,
    away,
    youHome ? baseAdj : NEUTRAL_ADJUST,
    youHome ? NEUTRAL_ADJUST : baseAdj
  );
  return {
    xp: expectedPointsOf(probs, youHome),
    xpBase: expectedPointsOf(baseProbs, youHome),
    win: winProbOf(probs, youHome),
    winBase: winProbOf(baseProbs, youHome),
  };
}

/** Dohraje celou sezónu (současný plán platí pro zbývající zápasy; eventy se přeskočí). */
export function simulateToEnd(state: SeasonState): SeasonState {
  let s = state;
  while (!isSeasonOver(s)) s = playRound(s);
  return s;
}

/** Aktuální ligová tabulka. */
export function currentTable(state: SeasonState) {
  return buildTable(
    state.teams.map((t) => t.id),
    state.results
  );
}

/** Tvůj příští zápas + predikce modelu (s tvým plánem/morálkou) + scout soupeře. */
export function yourNextMatch(state: SeasonState): {
  fixture: Fixture;
  isHome: boolean;
  opponent: GameTeam;
  probs: MatchProbs;
  scout: ScoutReport;
  /** Co ze zápasu potřebuješ – kontext pro hráče i váhy pro doporučení skautů. */
  stakes: MatchStakes;
} | null {
  if (isSeasonOver(state)) return null;
  const fixtures = state.schedule[state.round];
  const fixture = fixtures.find(
    (f) => f.homeId === state.yourTeamId || f.awayId === state.yourTeamId
  );
  if (!fixture) return null; // pojistka (v úplné lize hraje každý každé kolo)
  const isHome = fixture.homeId === state.yourTeamId;
  const home = teamById(state.teams, fixture.homeId);
  const away = teamById(state.teams, fixture.awayId);
  const oppId = isHome ? fixture.awayId : fixture.homeId;
  // Náhled predikce ignoruje zvolený plán I instrukci (jinak by šlo obojí proklikat a vzít
  // nejvyšší %) – projeví se až ve skutečném odehrání kola (`playRound` → `resolveYourAdjust`).
  // Morálka, kondice a eventové modifikátory se v náhledu ukázat SMÍ: hráč je v tu chvíli
  // nemůže změnit, takže se nedají optimalizovat.
  const yourAdj = resolveAdjust(state, oppId, "balanced", "none");
  const homeAdj = isHome ? yourAdj : NEUTRAL_ADJUST;
  const awayAdj = isHome ? NEUTRAL_ADJUST : yourAdj;
  const probs = predictProbs(home, away, homeAdj, awayAdj);
  // Sázky řídí, čím se v tomhle zápase měří úspěch – doporučení skautů se pak neptá
  // „kde bude největší gólový rozdíl", ale „co odsud potřebuju odvézt".
  const stakes = matchStakes(state, oppId);
  return {
    fixture,
    isHome,
    opponent: isHome ? away : home,
    probs,
    scout: scoutOpponent(state, oppId, { youHome: isHome, weights: stakes.weights }),
    stakes,
  };
}

/** Výsledky tvého týmu (nejnovější první). */
export function yourResults(state: SeasonState) {
  return state.results
    .filter((r) => r.homeId === state.yourTeamId || r.awayId === state.yourTeamId)
    .slice()
    .reverse();
}
