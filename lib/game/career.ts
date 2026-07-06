// Kariérní vrstva – souhrn sezóny (vč. hodnocení pohárů/sestupu a čistých kont),
// přechod do další sezóny (drift ratingů) a agregace historie. Čisté funkce.

import { deriveSeed, mulberry32 } from "./rng";
import { newSeason, currentTable } from "./engine";
import { teamById } from "./teams";
import { evaluateSeason } from "./leagues";
import { expectedRank } from "./reputation";
import {
  ATTACK_MAX,
  ATTACK_MIN,
  DEFENSE_BEST,
  DEFENSE_WORST,
} from "./balance";
import type { GameTeam, MatchResult, SeasonState, SeasonSummary } from "./types";

/** Počet čistých kont tvého týmu (soupeř nedal gól) z výsledků sezóny. */
export function cleanSheetsOf(results: MatchResult[], teamId: number): number {
  let n = 0;
  for (const r of results) {
    if (r.homeId === teamId && r.awayGoals === 0) n++;
    else if (r.awayId === teamId && r.homeGoals === 0) n++;
  }
  return n;
}

/** Kompaktní souhrn dohrané sezóny (pro historii). Předpokládá dohranou sezónu. */
export function summarizeSeason(state: SeasonState): SeasonSummary {
  const table = currentTable(state);
  const you = table.find((r) => r.teamId === state.yourTeamId)!;
  const champion = table[0];
  const yourTeam = teamById(state.teams, state.yourTeamId);
  const verdict = evaluateSeason(you.rank, state.teams.length, state.leagueId);
  return {
    season: state.season,
    leagueId: state.leagueId,
    leagueName: state.leagueName,
    yourTeamId: state.yourTeamId,
    yourName: yourTeam.name,
    yourRank: you.rank,
    expectedRank: expectedRank(yourTeam, state.teams),
    yourPoints: you.points,
    win: you.win,
    draw: you.draw,
    loss: you.loss,
    goalsFor: you.goalsFor,
    goalsAgainst: you.goalsAgainst,
    cleanSheets: cleanSheetsOf(state.results, state.yourTeamId),
    champion: verdict.champion,
    europe: verdict.europe,
    relegated: verdict.relegated,
    championId: champion.teamId,
    championName: teamById(state.teams, champion.teamId).name,
  };
}

/**
 * Lehký drift ratingu mezi sezónami: regrese ke středu ligy + malý šum. Drží týmy
 * v realistickém rozsahu, ale pořadí sil se mezi sezónami mírně mění.
 */
function driftTeams(teams: GameTeam[], seed: number): GameTeam[] {
  const rand = mulberry32(seed);
  const midAttack = (ATTACK_MIN + ATTACK_MAX) / 2;
  const midDefense = (DEFENSE_BEST + DEFENSE_WORST) / 2;
  return teams.map((t) => {
    const attack = clamp(
      t.attack + (midAttack - t.attack) * 0.1 + (rand() - 0.5) * 0.25,
      ATTACK_MIN,
      ATTACK_MAX
    );
    const defense = clamp(
      t.defense + (midDefense - t.defense) * 0.1 + (rand() - 0.5) * 0.25,
      DEFENSE_BEST,
      DEFENSE_WORST
    );
    return { ...t, attack: round2(attack), defense: round2(defense) };
  });
}

/** Spustí další sezónu se STEJNÝM týmem i ligou (driftnuté ratingy, nový rozpis). */
export function startNextSeason(state: SeasonState): SeasonState {
  const nextSeed = deriveSeed(state.seed, 1000 + state.season);
  const teams = driftTeams(state.teams, nextSeed);
  return newSeason(nextSeed, state.yourTeamId, {
    season: state.season + 1,
    teams,
    leagueId: state.leagueId,
    leagueName: state.leagueName,
  });
}

/** Agregované kariérní statistiky napříč historií. */
export interface CareerStats {
  seasons: number;
  titles: number;
  europeanQualifs: number;
  relegations: number;
  bestRank: number;
  worstRank: number;
  avgRank: number;
  totalWin: number;
  totalDraw: number;
  totalLoss: number;
  totalGoalsFor: number;
  totalGoalsAgainst: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  cleanSheets: number;
}

export function careerStats(history: SeasonSummary[]): CareerStats | null {
  if (history.length === 0) return null;
  let titles = 0;
  let europeanQualifs = 0;
  let relegations = 0;
  let bestRank = Infinity;
  let worstRank = 0;
  let sumRank = 0;
  let totalWin = 0;
  let totalDraw = 0;
  let totalLoss = 0;
  let totalGoalsFor = 0;
  let totalGoalsAgainst = 0;
  let cleanSheets = 0;
  let games = 0;
  for (const s of history) {
    if (s.champion) titles++;
    if (s.europe !== "NONE") europeanQualifs++;
    if (s.relegated) relegations++;
    bestRank = Math.min(bestRank, s.yourRank);
    worstRank = Math.max(worstRank, s.yourRank);
    sumRank += s.yourRank;
    totalWin += s.win;
    totalDraw += s.draw;
    totalLoss += s.loss;
    totalGoalsFor += s.goalsFor;
    totalGoalsAgainst += s.goalsAgainst;
    cleanSheets += s.cleanSheets;
    games += s.win + s.draw + s.loss;
  }
  const g = games || 1;
  return {
    seasons: history.length,
    titles,
    europeanQualifs,
    relegations,
    bestRank,
    worstRank,
    avgRank: Math.round((sumRank / history.length) * 10) / 10,
    totalWin,
    totalDraw,
    totalLoss,
    totalGoalsFor,
    totalGoalsAgainst,
    avgGoalsFor: Math.round((totalGoalsFor / g) * 100) / 100,
    avgGoalsAgainst: Math.round((totalGoalsAgainst / g) * 100) / 100,
    cleanSheets,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
