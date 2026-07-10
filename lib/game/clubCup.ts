// Klubový pohár (Liga mistrů-styl): jádro nad `tournament.ts` (skupiny + pavouk), BEZ
// kvalifikační fáze – na rozdíl od `nationalCompetitions.ts` se kvalifikace neodehrává,
// jen VYHODNOTÍ: klub, který v minulé sezóně dosáhl evropské příčky (`SeasonSummary.europe`),
// automaticky postupuje do poháru příští sezóny (`clubQualifies`); zbytek pole doplní vážený
// los ze statického poolu (`clubCupPool.ts`). Čistě funkční, offline, deterministické dle seedu.

import { deriveSeed, mulberry32 } from "./rng";
import { RNG_SALT_CUP } from "./agency";
import { CLUB_CUP_POOL, clubCupSeedToGameTeam } from "./clubCupPool";
import type { ClubCupSeed } from "./clubCupPool";
import {
  isTournamentOver,
  newTournament,
  nextOpponentOf,
  playTournamentRound,
  simulateTournamentToEnd,
  yourFixture,
} from "./tournament";
import type { Stage, TournamentFormat, TournamentState } from "./tournament";
import { resolveAdjust } from "./engine";
import { NEUTRAL_ADJUST, predictProbs } from "./simulate";
import { scoutOpponent } from "./scouting";
import type { ScoutReport } from "./scouting";
import { teamById } from "./teams";
import { maybeEvent } from "./events";
import type { CupSummary, EuropeSpot, GameTeam, Instruction, MatchProbs, Plan } from "./types";

export const CLUB_CUP_ID = "CUP";
export const CLUB_CUP_NAME = "Klubový pohár";

/** 8 skupin po 4 = 32 týmů → osmifinále (r16). Vědomé zjednodušení reálného formátu LM. */
export const CLUB_CUP_FORMAT: TournamentFormat = {
  id: CLUB_CUP_ID,
  name: CLUB_CUP_NAME,
  groups: 8,
  groupSize: 4,
  advancePerGroup: 2,
  bestThirds: 0,
};

export function cupFieldSize(): number {
  return CLUB_CUP_FORMAT.groups * CLUB_CUP_FORMAT.groupSize;
}

/** Umístění, které v předchozí sezóně dává postup do poháru – jakákoli evropská příčka. */
export function clubQualifies(europe: EuropeSpot): boolean {
  return europe !== "NONE";
}

// ───────────────────────── los pole ─────────────────────────

/**
 * Los `count` klubů z poolu vážený silou (silnější mají větší šanci, ne jistotu). Bez
 * opakování. Strukturálně obdoba `weightedDraw` v `nationalCompetitions.ts` – vlastní
 * (nesdílená) kopie, ať klubový pohár nezávisí na interním detailu reprezentačního modulu.
 */
function weightedDraw(pool: ClubCupSeed[], count: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const minStrength = Math.min(...pool.map(seedStrength), 0);
  const weighted = pool.map((s) => ({ id: s.id, w: seedStrength(s) - minStrength + 0.3 }));
  const out: number[] = [];

  while (out.length < count && weighted.length > 0) {
    let total = 0;
    for (const c of weighted) total += c.w;
    let x = rand() * total;
    let idx = 0;
    for (; idx < weighted.length; idx++) {
      x -= weighted[idx].w;
      if (x <= 0) break;
    }
    const pick = weighted.splice(Math.min(idx, weighted.length - 1), 1)[0];
    out.push(pick.id);
  }
  return out;
}

function seedStrength(s: ClubCupSeed): number {
  return s.attack - s.defense;
}

const POOL_BY_ID = new Map(CLUB_CUP_POOL.map((s) => [s.id, s]));

/** Sestaví pole poháru: tvůj klub garantovaně + zbytek vážený los ze statického poolu. */
function buildCupField(yourTeam: GameTeam, seed: number): GameTeam[] {
  const need = cupFieldSize() - 1;
  const drawn = weightedDraw(CLUB_CUP_POOL, need, deriveSeed(seed, 50000));
  const teams = drawn.map((id) => clubCupSeedToGameTeam(POOL_BY_ID.get(id)!));
  return [yourTeam, ...teams];
}

// ───────────────────────── běh ─────────────────────────

/**
 * Probíhající klubový pohár. Na rozdíl od `TournamentRun` nemá fázi „kvalifikace" – ta se
 * vyhodnotí při SESTAVENÍ (`clubQualifies`), ne odehráváním, takže `tournament` existuje
 * hned od začátku (žádný `null` mezistav).
 */
export interface CupRun {
  seed: number;
  yourTeamId: number;
  yourName: string;
  yourLogo?: string;
  /** Sezóna klubové kariéry, pro kterou byl pohár sestaven. */
  season: number;
  /** Pořadové číslo poháru v klubové kariéře (1-based). */
  edition: number;
  /** Prestiž klubu v době kvalifikace – strop pro kladný přírůstek reputace (viz reputation.ts). */
  teamPrestige?: number;
  tournament: TournamentState;
}

export function startCupRun(
  seed: number,
  yourTeam: GameTeam,
  season: number,
  edition: number,
  teamPrestige?: number
): CupRun {
  const teams = buildCupField(yourTeam, seed);
  const base = { ...newTournament(seed, yourTeam.id, teams, CLUB_CUP_FORMAT), rngSalt: RNG_SALT_CUP };
  // `newTournament` spočítala počáteční `pendingEvent` ještě pod `RNG_SALT_TOURNAMENT` (svým
  // vlastním saltem) – po přepnutí na `RNG_SALT_CUP` se musí dopočítat znovu, jinak by první
  // event poháru náhodou korelovat s prvním eventem reprezentačního turnaje na stejném seedu.
  const tournament = { ...base, pendingEvent: maybeEvent(base, nextOpponentOf(base)) };
  return {
    seed,
    yourTeamId: yourTeam.id,
    yourName: yourTeam.name,
    yourLogo: yourTeam.logo,
    season,
    edition,
    teamPrestige,
    tournament,
  };
}

export function isCupRunOver(run: CupRun): boolean {
  return isTournamentOver(run.tournament);
}

export function playCupRunRound(run: CupRun): CupRun {
  return { ...run, tournament: playTournamentRound(run.tournament, CLUB_CUP_FORMAT) };
}

/** Dohraje pohár do konce (eventy se přeskočí, jako `simulateToEnd`/`simulateRunToEnd`). */
export function simulateCupRunToEnd(run: CupRun): CupRun {
  return { ...run, tournament: simulateTournamentToEnd(run.tournament, CLUB_CUP_FORMAT) };
}

export function setCupPlan(run: CupRun, plan: Plan): CupRun {
  return { ...run, tournament: { ...run.tournament, plan } };
}

export function setCupInstruction(run: CupRun, instruction: Instruction): CupRun {
  return { ...run, tournament: { ...run.tournament, instruction } };
}

// ───────────────────────── náhled zápasu ─────────────────────────

/** Náhled nejbližšího zápasu poháru (predikce + scouting) – sdílené s ligovým `yourNextMatch`. */
export interface CupPreview {
  homeId: number;
  awayId: number;
  isHome: boolean;
  you: GameTeam;
  opponent: GameTeam;
  probs: MatchProbs;
  scout: ScoutReport;
}

export function cupPreview(run: CupRun): CupPreview | null {
  const t = run.tournament;
  const f = yourFixture(t);
  if (!f) return null;

  const isHome = f.homeId === run.yourTeamId;
  const oppId = isHome ? f.awayId : f.homeId;
  // Náhled ignoruje zvolený plán/instrukci (anti-exploit, stejně jako `yourNextMatch`/`runPreview`).
  const yourAdj = resolveAdjust(t, oppId, "balanced", "none");
  const probs = predictProbs(
    teamById(t.teams, f.homeId),
    teamById(t.teams, f.awayId),
    isHome ? yourAdj : NEUTRAL_ADJUST,
    isHome ? NEUTRAL_ADJUST : yourAdj
  );
  return {
    homeId: f.homeId,
    awayId: f.awayId,
    isHome,
    you: teamById(t.teams, run.yourTeamId),
    opponent: teamById(t.teams, oppId),
    probs,
    scout: scoutOpponent(t, oppId),
  };
}

// ───────────────────────── vyhodnocení ─────────────────────────

function tallyMatches(t: TournamentState, teamId: number) {
  let played = 0, win = 0, draw = 0, loss = 0, goalsFor = 0, goalsAgainst = 0;
  for (const r of t.results) {
    const isHome = r.homeId === teamId;
    const isAway = r.awayId === teamId;
    if (!isHome && !isAway) continue;
    played++;
    const gf = isHome ? r.homeGoals : r.awayGoals;
    const ga = isHome ? r.awayGoals : r.homeGoals;
    goalsFor += gf;
    goalsAgainst += ga;
    if (gf > ga) win++;
    else if (gf < ga) loss++;
    else draw++;
  }
  return { played, win, draw, loss, goalsFor, goalsAgainst };
}

/** Nejdál dosažená fáze poháru (`yourStage`, jako u `TournamentRun`). */
export function cupStageReached(run: CupRun): Stage {
  return run.tournament.yourStage;
}

/** Souhrn dohraného poháru do síně slávy. */
export function summarizeCupRun(run: CupRun): CupSummary {
  const tally = tallyMatches(run.tournament, run.yourTeamId);
  return {
    cupId: CLUB_CUP_ID,
    cupName: CLUB_CUP_NAME,
    edition: run.edition,
    season: run.season,
    teamId: run.yourTeamId,
    teamName: run.yourName,
    teamLogo: run.yourLogo,
    stageReached: cupStageReached(run),
    champion: run.tournament.champion === run.yourTeamId,
    teamPrestige: run.teamPrestige,
    ...tally,
  };
}
