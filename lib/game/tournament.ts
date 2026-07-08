// Turnajové jádro: skupiny + vyřazovací pavouk. Čistě funkční, offline, deterministické
// dle seedu. Sdílené pro reprezentační turnaje (Euro/MS) i budoucí klubový pohár.
//
// Stavební kameny se recyklují z ligy: `simulateMatch` (Poisson + Dixon–Coles),
// `singleRoundRobin` (skupina 4 týmů = 3 kola po 2 zápasech), `groupTable` (tiebreaky),
// `resolveYourAdjust` (celá manažerská agency přes `AgencyState`). Nové je jen to, co
// v lize neexistuje: los z košíků, ranking třetích míst, pavouk, prodloužení a penalty.
//
// **Neutrální půda.** Reprezentační turnaj se hraje na neutrálním hřišti → `homeBoost: 1`
// dá `homeAdvantage(1) === {0, 0}`, takže `homeId`/`awayId` je jen nominální (kdo je vlevo
// na tabuli). Pořadatel může mít `homeBoost > 1` a domácí výhodu dostane zadarmo.

import { deriveSeed, mulberry32, shuffle } from "./rng";
import { EXTRA_TIME_LAMBDA, PENALTY_ATTACK_WEIGHT, PENALTY_MAX_EDGE, STARTING_FITNESS, STARTING_MORALE } from "./balance";
import { simulateMatch, NEUTRAL_ADJUST } from "./simulate";
import type { SideAdjust } from "./simulate";
import { singleRoundRobin } from "./schedule";
import { groupTable, rankAcrossGroups } from "./standings";
import { teamById } from "./teams";
import { resolveAdjust } from "./engine";
import { maybeEvent } from "./events";
import { updateMorale } from "./morale";
import { updateFitness } from "./fitness";
import { teamStrengthScore } from "./leagues";
import { RNG_SALT_TOURNAMENT } from "./agency";
import type { AgencyState } from "./agency";
import type { Fixture, GameTeam, Instruction, MatchResult, Modifier, PendingEvent, Plan, TableRow } from "./types";

// ───────────────────────── formát ─────────────────────────

/** Vyřazovací fáze v pořadí. `group` je skupinová část, `done` konec turnaje. */
export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "done";

const KO_ORDER: Stage[] = ["r32", "r16", "qf", "sf", "final"];

export const STAGE_LABEL: Record<Stage, string> = {
  group: "Skupina",
  r32: "Šestnáctifinále",
  r16: "Osmifinále",
  qf: "Čtvrtfinále",
  sf: "Semifinále",
  final: "Finále",
  done: "Konec",
};

/** Popis turnajového formátu (Euro 24, MS 48, …). */
export interface TournamentFormat {
  id: string;
  name: string;
  /** Počet skupin (každá po `groupSize` týmech). */
  groups: number;
  groupSize: number;
  /** Kolik týmů z každé skupiny postupuje přímo. */
  advancePerGroup: number;
  /** Kolik nejlepších třetích míst napříč skupinami postupuje navíc. */
  bestThirds: number;
}

/** Euro: 6×4, top 2 + 4 nejlepší třetí = 16 → osmifinále. */
export const EURO_FORMAT: TournamentFormat = {
  id: "EURO",
  name: "Mistrovství Evropy",
  groups: 6,
  groupSize: 4,
  advancePerGroup: 2,
  bestThirds: 4,
};

/** MS 2026: 12×4, top 2 + 8 nejlepších třetích = 32 → šestnáctifinále. */
export const WORLD_CUP_FORMAT: TournamentFormat = {
  id: "WC",
  name: "Mistrovství světa",
  groups: 12,
  groupSize: 4,
  advancePerGroup: 2,
  bestThirds: 8,
};

/** Kolik týmů projde do vyřazovací fáze. Musí být mocnina dvou. */
export function knockoutSize(f: TournamentFormat): number {
  return f.groups * f.advancePerGroup + f.bestThirds;
}

/** Fáze, kterou vyřazovací část začíná (16 týmů → `r16`, 32 → `r32`). */
export function firstKnockoutStage(f: TournamentFormat): Stage {
  const size = knockoutSize(f);
  const idx = KO_ORDER.length - Math.log2(size);
  const stage = KO_ORDER[idx];
  if (!stage) throw new Error(`Nepodporovaná velikost pavouka: ${size}`);
  return stage;
}

// ───────────────────────── stav ─────────────────────────

/** Odehraný vyřazovací zápas – nese i to, co `MatchResult` neumí (prodloužení, penalty). */
export interface KnockoutTie {
  stage: Stage;
  round: number;
  homeId: number;
  awayId: number;
  /** Skóre po 90 minutách (a po prodloužení, pokud se hrálo). */
  homeGoals: number;
  awayGoals: number;
  afterExtraTime: boolean;
  /** Skóre rozstřelu, když ani prodloužení nerozhodlo. */
  penalties?: [number, number];
  winnerId: number;
}

/** Stav turnaje. Strukturálně splňuje `AgencyState`, takže agency funguje beze změny. */
export interface TournamentState extends AgencyState {
  formatId: string;
  /** Skupiny jako pole id týmů (`groups[g][i]`). */
  groups: number[][];
  /** Rozpis skupinové fáze po hracích dnech (`groupSchedule[md]`). */
  groupSchedule: Fixture[][];
  /** Kompletní odehrané zápasy (skupiny i pavouk) – zdroj formy pro agency. */
  results: MatchResult[];
  /** Detaily vyřazovacích zápasů (prodloužení, penalty, vítěz). */
  knockout: KnockoutTie[];
  stage: Stage;
  /** Dvojice čekající na odehrání v aktuální vyřazovací fázi. */
  pending: { homeId: number; awayId: number }[];
  /** Kam jsi to dotáhl (`done` = turnaj skončil, i když jsi vypadl dřív). */
  yourStage: Stage;
  eliminated: boolean;
  champion: number | null;
}

// ───────────────────────── los ─────────────────────────

/**
 * Los skupin z košíků. Týmy se seřadí dle síly, rozdělí do `groupSize` košíků po
 * `groups` týmech, každý košík se zamíchá seedem a rozdá po skupinách. Nejsilnější tým
 * tak nikdy nepotká druhého nejsilnějšího už ve skupině.
 */
export function drawGroups(
  teams: GameTeam[],
  format: TournamentFormat,
  seed: number
): number[][] {
  const need = format.groups * format.groupSize;
  if (teams.length !== need) {
    throw new Error(`drawGroups: ${format.id} chce ${need} týmů, dostal ${teams.length}`);
  }
  const ranked = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
  const groups: number[][] = Array.from({ length: format.groups }, () => []);

  for (let pot = 0; pot < format.groupSize; pot++) {
    const slice = ranked.slice(pot * format.groups, (pot + 1) * format.groups);
    const drawn = shuffle(slice, mulberry32(deriveSeed(seed, 20000 + pot)));
    drawn.forEach((t, g) => groups[g].push(t.id));
  }
  return groups;
}

// ───────────────────────── založení ─────────────────────────

export function newTournament(
  seed: number,
  yourTeamId: number,
  teams: GameTeam[],
  format: TournamentFormat
): TournamentState {
  const groups = drawGroups(teams, format, seed);
  // Všechny skupiny hrají paralelně: hrací den `md` = kolo `md` z každé skupiny.
  const perGroup = groups.map((g) => singleRoundRobin(g));
  const matchdays = perGroup[0].length; // 4 týmy → 3
  const groupSchedule: Fixture[][] = Array.from({ length: matchdays }, (_, md) =>
    perGroup.flatMap((g) => g[md].map((f) => ({ ...f, round: md })))
  );

  const state: TournamentState = {
    formatId: format.id,
    seed,
    round: 0,
    rngSalt: RNG_SALT_TOURNAMENT,
    teams,
    yourTeamId,
    results: [],
    knockout: [],
    groups,
    groupSchedule,
    stage: "group",
    pending: [],
    yourStage: "group",
    eliminated: false,
    champion: null,
    morale: STARTING_MORALE,
    fitness: STARTING_FITNESS,
    modifiers: [],
    scoutBoostUntilRound: null,
    plan: "balanced",
    instruction: "none",
    pendingEvent: null,
  };
  return { ...state, pendingEvent: maybeEvent(state, nextOpponentOf(state)) };
}

export function setTournamentPlan(state: TournamentState, plan: Plan): TournamentState {
  return { ...state, plan };
}

export function setTournamentInstruction(
  state: TournamentState,
  instruction: Instruction
): TournamentState {
  return { ...state, instruction };
}

// ───────────────────────── dotazy ─────────────────────────

export function isTournamentOver(state: TournamentState): boolean {
  return state.stage === "done";
}

/** Zápas tvého týmu v aktuální fázi (skupina i pavouk), nebo `null` (vypadl / konec). */
export function yourFixture(
  state: TournamentState
): { homeId: number; awayId: number } | null {
  if (state.stage === "done" || state.eliminated) return null;
  if (state.stage === "group") {
    const md = state.groupSchedule[state.round];
    return md?.find((f) => f.homeId === state.yourTeamId || f.awayId === state.yourTeamId) ?? null;
  }
  return (
    state.pending.find((t) => t.homeId === state.yourTeamId || t.awayId === state.yourTeamId) ??
    null
  );
}

/** Soupeř tvého týmu v aktuální fázi – vstup pro `maybeEvent` (viz `agency.ts`). */
export function nextOpponentOf(state: TournamentState): number | null {
  const f = yourFixture(state);
  if (!f) return null;
  return f.homeId === state.yourTeamId ? f.awayId : f.homeId;
}

/** Tabulka skupiny, ve které hraje daný tým. */
export function groupTableOf(state: TournamentState, groupIndex: number): TableRow[] {
  return groupTable(state.groups[groupIndex], state.results, state.seed, groupIndex);
}

export function groupIndexOf(state: TournamentState, teamId: number): number {
  return state.groups.findIndex((g) => g.includes(teamId));
}

// ───────────────────────── vyřazovací zápas ─────────────────────────

/**
 * Odehraje vyřazovací zápas: 90 minut → při remíze prodloužení (λ × `EXTRA_TIME_LAMBDA`)
 * → při remíze penalty. **Nikdy nevrátí remízu.**
 *
 * Penalty jsou skoro coin-flip: `p = 0.5 + PENALTY_ATTACK_WEIGHT × (útokA − útokB)`,
 * clampnuto na `±PENALTY_MAX_EDGE`. Reálně rozstřel kvalitou týmu rozhodnutý skoro není.
 */
export function playKnockoutTie(
  home: GameTeam,
  away: GameTeam,
  homeAdj: SideAdjust,
  awayAdj: SideAdjust,
  rand: () => number,
  stage: Stage,
  round: number
): KnockoutTie {
  const reg = simulateMatch(home, away, homeAdj, awayAdj, rand);
  let homeGoals = reg.homeGoals;
  let awayGoals = reg.awayGoals;
  let afterExtraTime = false;

  if (homeGoals === awayGoals) {
    afterExtraTime = true;
    const et = simulateMatch(home, away, homeAdj, awayAdj, rand, EXTRA_TIME_LAMBDA);
    homeGoals += et.homeGoals;
    awayGoals += et.awayGoals;
  }

  if (homeGoals !== awayGoals) {
    return {
      stage,
      round,
      homeId: home.id,
      awayId: away.id,
      homeGoals,
      awayGoals,
      afterExtraTime,
      winnerId: homeGoals > awayGoals ? home.id : away.id,
    };
  }

  // Rozstřel: skóre je jen kosmetika (5-4 / 4-5), o vítězi rozhodne jeden vážený los.
  const edge = clamp(
    PENALTY_ATTACK_WEIGHT * (home.attack - away.attack),
    -PENALTY_MAX_EDGE,
    PENALTY_MAX_EDGE
  );
  const homeWins = rand() < 0.5 + edge;
  return {
    stage,
    round,
    homeId: home.id,
    awayId: away.id,
    homeGoals,
    awayGoals,
    afterExtraTime: true,
    penalties: homeWins ? [5, 4] : [4, 5],
    winnerId: homeWins ? home.id : away.id,
  };
}

// ───────────────────────── pavouk ─────────────────────────

/**
 * Postupující po skupinové fázi, seřazení pro nasazení do pavouka: nejdřív vítězové skupin,
 * pak druzí, pak nejlepší třetí. Uvnitř každé úrovně dle bodů/rozdílu/vstřelených.
 */
export function qualifiers(state: TournamentState, format: TournamentFormat): number[] {
  const tables = state.groups.map((_, g) => groupTableOf(state, g));
  const byPlace: TableRow[][] = [];
  for (let place = 0; place < format.groupSize; place++) {
    byPlace.push(tables.map((t) => t[place]));
  }

  const out: number[] = [];
  for (let place = 0; place < format.advancePerGroup; place++) {
    out.push(...rankAcrossGroups(byPlace[place], state.seed, 100 + place).map((r) => r.teamId));
  }
  if (format.bestThirds > 0) {
    const thirds = rankAcrossGroups(byPlace[format.advancePerGroup], state.seed, 200);
    out.push(...thirds.slice(0, format.bestThirds).map((r) => r.teamId));
  }
  return out;
}

/**
 * Standardní nasazovací pořadí pavouka pro `n` týmů (mocnina dvou), 1-indexované nasazení.
 * Rekurzivně: `[1,2]` → `[1,4,2,3]` → `[1,8,4,5,2,7,3,6]` → …
 *
 * Musí se skládat takhle, ne prostě `1v16, 2v15, 3v14…`: při naivním pořadí by se vítězové
 * sousedních dvojic potkali hned v dalším kole, takže nasazená jednička by narazila na
 * dvojku už ve čtvrtfinále. Tenhle klíč je zaručuje až ve finále.
 */
export function bracketSeedOrder(n: number): number[] {
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`bracketSeedOrder: ${n} není mocnina dvou`);
  let order = [1, 2];
  while (order.length < n) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) {
      next.push(s, sum - s);
    }
    order = next;
  }
  return order;
}

/**
 * Nasazený pavouk. `qualified` je seřazený od nejlepšího postupujícího; klíč
 * (`bracketSeedOrder`) drží nejlepší dva na opačných polovinách.
 *
 * Reálné turnaje mají složitější rozpis (větve svázané s písmeny skupin) – tohle je vědomé
 * zjednodušení. Jedna reálná vlastnost se drží: pokud by se v prvním kole potkaly dva týmy
 * ze STEJNÉ skupiny, prohodí se soupeř se sousední dvojicí.
 */
export function seedBracket(
  qualified: number[],
  groupOf: (teamId: number) => number
): { homeId: number; awayId: number }[] {
  const n = qualified.length;
  const order = bracketSeedOrder(n);
  const ties = Array.from({ length: n / 2 }, (_, i) => ({
    homeId: qualified[order[2 * i] - 1],
    awayId: qualified[order[2 * i + 1] - 1],
  }));

  // Odveta ze skupiny hned v prvním kole → prohoď hosty se sousední dvojicí, pokud to pomůže.
  for (let i = 0; i < ties.length; i++) {
    if (groupOf(ties[i].homeId) !== groupOf(ties[i].awayId)) continue;
    const j = i + 1 < ties.length ? i + 1 : i - 1;
    if (j < 0) break;
    if (
      groupOf(ties[i].homeId) === groupOf(ties[j].awayId) ||
      groupOf(ties[j].homeId) === groupOf(ties[i].awayId)
    )
      continue; // prohození by nepomohlo
    const tmp = ties[i].awayId;
    ties[i].awayId = ties[j].awayId;
    ties[j].awayId = tmp;
  }
  return ties;
}

// ───────────────────────── odehrání ─────────────────────────

/** Úprava λ tvého týmu; AI soupeři jedou neutrálně (stejně jako v lize). */
function adjustFor(state: TournamentState, teamId: number, oppId: number): SideAdjust {
  return teamId === state.yourTeamId
    ? resolveAdjust(state, oppId, state.plan, state.instruction)
    : NEUTRAL_ADJUST;
}

/**
 * Odehraje aktuální kolo turnaje: buď hrací den skupinové fáze (všechny skupiny naráz),
 * nebo celou vyřazovací fázi. Vrací nový stav (čistá funkce).
 */
export function playTournamentRound(state: TournamentState, format: TournamentFormat): TournamentState {
  if (isTournamentOver(state)) return state;
  const rand = mulberry32(deriveSeed(state.seed + state.rngSalt, state.round));

  const results = state.results.slice();
  const knockout = state.knockout.slice();
  let yourResult: MatchResult | null = null;
  let oppStronger = false;
  let eliminated = state.eliminated;
  let champion = state.champion;
  let yourStage = state.yourStage;

  const you = teamById(state.teams, state.yourTeamId);
  const noteYourMatch = (mr: MatchResult, oppId: number) => {
    yourResult = mr;
    oppStronger = teamStrengthScore(teamById(state.teams, oppId)) > teamStrengthScore(you);
  };

  let nextStage: Stage = state.stage;
  let pending: { homeId: number; awayId: number }[] = [];

  if (state.stage === "group") {
    for (const f of state.groupSchedule[state.round]) {
      const home = teamById(state.teams, f.homeId);
      const away = teamById(state.teams, f.awayId);
      const r = simulateMatch(
        home,
        away,
        adjustFor(state, f.homeId, f.awayId),
        adjustFor(state, f.awayId, f.homeId),
        rand
      );
      const mr: MatchResult = {
        round: state.round,
        homeId: f.homeId,
        awayId: f.awayId,
        homeGoals: r.homeGoals,
        awayGoals: r.awayGoals,
      };
      results.push(mr);
      if (f.homeId === state.yourTeamId) noteYourMatch(mr, f.awayId);
      else if (f.awayId === state.yourTeamId) noteYourMatch(mr, f.homeId);
    }

    const lastMatchday = state.round === state.groupSchedule.length - 1;
    if (lastMatchday) {
      // Skupiny dohrané → nasadit pavouka z postupujících.
      const advanced = qualifiers({ ...state, results }, format);
      pending = seedBracket(advanced, (id) => groupIndexOf(state, id));
      nextStage = firstKnockoutStage(format);
      if (!advanced.includes(state.yourTeamId)) {
        eliminated = true;
        yourStage = "group";
      } else {
        yourStage = nextStage;
      }
    } else {
      nextStage = "group";
      pending = [];
    }
  } else {
    // Vyřazovací fáze: odehraj všechny dvojice, vítězové postupují.
    const winners: number[] = [];
    for (const tie of state.pending) {
      const home = teamById(state.teams, tie.homeId);
      const away = teamById(state.teams, tie.awayId);
      const played = playKnockoutTie(
        home,
        away,
        adjustFor(state, tie.homeId, tie.awayId),
        adjustFor(state, tie.awayId, tie.homeId),
        rand,
        state.stage,
        state.round
      );
      knockout.push(played);
      const mr: MatchResult = {
        round: state.round,
        homeId: played.homeId,
        awayId: played.awayId,
        homeGoals: played.homeGoals,
        awayGoals: played.awayGoals,
      };
      results.push(mr);
      if (tie.homeId === state.yourTeamId) noteYourMatch(mr, tie.awayId);
      else if (tie.awayId === state.yourTeamId) noteYourMatch(mr, tie.homeId);
      winners.push(played.winnerId);
    }

    if (!eliminated && !winners.includes(state.yourTeamId)) eliminated = true;

    if (state.stage === "final") {
      champion = winners[0];
      nextStage = "done";
      pending = [];
      // `yourStage` zůstává "final" i pro mistra – je to „kam jsi to dotáhl", ne stav turnaje.
      // Titul se pozná z `champion === yourTeamId`.
    } else {
      nextStage = KO_ORDER[KO_ORDER.indexOf(state.stage) + 1];
      // Vítězové drží pořadí dvojic → pavouk zůstává konzistentní.
      pending = Array.from({ length: winners.length / 2 }, (_, i) => ({
        homeId: winners[2 * i],
        awayId: winners[2 * i + 1],
      }));
      if (!eliminated) yourStage = nextStage;
    }
  }

  const nextRound = state.round + 1;
  let morale = state.morale;
  let fitness = state.fitness;
  if (yourResult) {
    morale = updateMorale(state.morale, outcomeFor(yourResult, state.yourTeamId), oppStronger);
    fitness = updateFitness(state.fitness, state.plan);
  }

  const next: TournamentState = {
    ...state,
    results,
    knockout,
    round: nextRound,
    stage: nextStage,
    pending,
    yourStage,
    eliminated,
    champion,
    morale,
    fitness,
    modifiers: state.modifiers.filter((m: Modifier) => m.untilRound >= nextRound),
    pendingEvent: null,
  };

  // Event jen dokud hraješ – vypadnutému trenérovi nemá kdo nabízet volby.
  const pendingEvent: PendingEvent | null =
    next.stage !== "done" && !next.eliminated ? maybeEvent(next, nextOpponentOf(next)) : null;
  return { ...next, pendingEvent };
}

/** Dohraje turnaj do konce se současnou taktikou (eventy se přeskočí, jako `simulateToEnd`). */
export function simulateTournamentToEnd(
  state: TournamentState,
  format: TournamentFormat
): TournamentState {
  let s = state;
  let guard = 0;
  while (!isTournamentOver(s) && guard++ < 100) s = playTournamentRound(s, format);
  return s;
}

function outcomeFor(r: MatchResult, teamId: number): "W" | "D" | "L" {
  const [f, a] = r.homeId === teamId ? [r.homeGoals, r.awayGoals] : [r.awayGoals, r.homeGoals];
  return f > a ? "W" : f < a ? "L" : "D";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
