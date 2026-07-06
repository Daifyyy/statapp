// Orchestrace sezóny – čisté funkce nad SeasonState (žádné IO). Každé kolo má
// vlastní deterministický RNG odvozený ze seedu + čísla kola → výsledky nezávisí
// na průběhu session (odolné vůči reloadu/uložení do DB mezi koly). Zápasové plány,
// morálka a eventy hýbou λ TVÉHO týmu; AI soupeři jedou neutrálně (NEUTRAL_ADJUST).

import { deriveSeed, mulberry32 } from "./rng";
import { generateLeague, teamById } from "./teams";
import { roundRobin } from "./schedule";
import { simulateMatch, predictProbs, NEUTRAL_ADJUST } from "./simulate";
import type { SideAdjust } from "./simulate";
import { buildTable } from "./standings";
import { MOCK_LEAGUE, seasonObjective, teamStrengthScore } from "./leagues";
import { resolvePlan } from "./plans";
import { scoutOpponent } from "./scouting";
import type { ScoutReport } from "./scouting";
import { moraleFactor, updateMorale } from "./morale";
import { maybeEvent } from "./events";
import { STARTING_MORALE } from "./balance";
import type {
  Fixture,
  GameTeam,
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
  } = {}
): SeasonState {
  const league = opts.teams ?? generateLeague(seed);
  const schedule = roundRobin(league.map((t) => t.id));
  const leagueId = opts.leagueId ?? MOCK_LEAGUE.id;
  const you = teamById(league, yourTeamId);
  return {
    season: opts.season ?? 1,
    leagueId,
    leagueName: opts.leagueName ?? MOCK_LEAGUE.name,
    seed,
    teams: league,
    yourTeamId,
    schedule,
    results: [],
    round: 0,
    plan: "balanced",
    morale: STARTING_MORALE,
    objective: seasonObjective(you, league, leagueId),
    modifiers: [],
    pendingEvent: maybeEvent(seed, 0),
  };
}

/** Je sezóna dohraná? */
export function isSeasonOver(state: SeasonState): boolean {
  return state.round >= state.schedule.length;
}

/** Nastaví zápasový plán pro nejbližší zápas (jinak stav nemění). */
export function setPlan(state: SeasonState, plan: Plan): SeasonState {
  return { ...state, plan };
}

/**
 * Výsledná úprava λ TVÉHO týmu proti danému soupeři: plán × counter (dle stylu soupeře)
 * × morálka × aktivní eventové modifikátory. Čistá – stejná v predikci i při odehrání.
 */
export function resolveYourAdjust(state: SeasonState, oppId: number): SideAdjust {
  const scout = scoutOpponent(state, oppId);
  const base = resolvePlan(state.plan, scout.style);
  const mf = moraleFactor(state.morale);
  let attack = base.attack * mf;
  let concede = base.concede / mf; // vyšší morálka = míň obdržených
  for (const m of state.modifiers) {
    if (m.untilRound >= state.round) {
      if (m.attack) attack *= m.attack;
      if (m.concede) concede *= m.concede;
    }
  }
  return { attack, concede };
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
  if (yourResult) {
    const isHome = yourResult.homeId === state.yourTeamId;
    const forG = isHome ? yourResult.homeGoals : yourResult.awayGoals;
    const agG = isHome ? yourResult.awayGoals : yourResult.homeGoals;
    const outcome = forG > agG ? "W" : forG < agG ? "L" : "D";
    morale = updateMorale(state.morale, outcome, oppStronger);
  }
  // Prořezat expirované modifikátory a připravit event pro nové kolo.
  const modifiers = state.modifiers.filter((m) => m.untilRound >= nextRound);
  const pendingEvent =
    nextRound < state.schedule.length ? maybeEvent(state.seed, nextRound) : null;

  return { ...state, results, round: nextRound, morale, modifiers, pendingEvent };
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
  const yourAdj = resolveYourAdjust(state, oppId);
  const homeAdj = isHome ? yourAdj : NEUTRAL_ADJUST;
  const awayAdj = isHome ? NEUTRAL_ADJUST : yourAdj;
  const probs = predictProbs(home, away, homeAdj, awayAdj);
  return {
    fixture,
    isHome,
    opponent: isHome ? away : home,
    probs,
    scout: scoutOpponent(state, oppId),
  };
}

/** Výsledky tvého týmu (nejnovější první). */
export function yourResults(state: SeasonState) {
  return state.results
    .filter((r) => r.homeId === state.yourTeamId || r.awayId === state.yourTeamId)
    .slice()
    .reverse();
}
