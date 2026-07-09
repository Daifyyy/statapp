// Kariérní vrstva – souhrn sezóny (vč. hodnocení pohárů/sestupu a čistých kont),
// přechod do další sezóny (drift ratingů) a agregace historie. Čisté funkce.

import { deriveSeed, mulberry32 } from "./rng";
import { newSeason, currentTable } from "./engine";
import { teamById } from "./teams";
import { evaluateSeason, teamPrestige } from "./leagues";
import { expectedRank } from "./reputation";
import {
  applyDevelopment,
  nextScouting,
  nextYouth,
  youthRegression,
  EMPTY_SPEND,
} from "./development";
import type { DevSpend } from "./development";
import {
  DRIFT_NOISE,
  DRIFT_PERFORMANCE,
  DRIFT_REGRESSION,
  SPREAD_ATTACK_MAX,
  SPREAD_ATTACK_MIN,
  SPREAD_DEFENSE_MAX,
  SPREAD_DEFENSE_MIN,
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
  const verdict = evaluateSeason(you.rank, state.teams.length, state.leagueId, state.leagueAccess);
  return {
    season: state.season,
    leagueId: state.leagueId,
    leagueName: state.leagueName,
    yourTeamId: state.yourTeamId,
    yourName: yourTeam.name,
    yourLogo: yourTeam.logo,
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
    promoted: verdict.promoted,
    championId: champion.teamId,
    championName: teamById(state.teams, champion.teamId).name,
    objectiveMet: you.rank <= state.objective.targetRank,
    yourPrestige: teamPrestige(yourTeam, state.leagueId, state.teams),
  };
}

/** Kontext driftu: co se v minulé sezóně stalo (výkon týmů) a co jsi investoval. */
export interface DriftContext {
  yourTeamId: number;
  /** Finální tabulka minulé sezóny (pro výkonovou zpětnou vazbu AI týmů). */
  table: { teamId: number; rank: number }[];
  /** Tvoje investice rozvojových bodů. */
  spend: DevSpend;
  /** Kumulativní investice do mládeže (tlumí regresi tvého klubu). */
  youth: number;
}

/**
 * Drift ratingů mezi sezónami:
 *  1. regrese ke **skutečnému průměru ligy** + šum (u tvého klubu tlumená mládeží),
 *  2. výkonová zpětná vazba: kdo přeplnil očekávání, mírně posílí; kdo podlezl, oslabí,
 *  3. **renormalizace na původní průměr a rozptyl** ligy,
 *  4. teprve pak tvoje investice (`applyDevelopment`) – ta má rozptyl posunout.
 *
 * Krok 3 nahradil dřívější `amplifySpread`. Ten roztahoval odchylky 1.35× KAŽDOU sezónu,
 * zatímco regrese je vracela jen 0.9× → net 1.215×/sezónu a liga se za ~10 sezón
 * polarizovala do clampů (std útoku 0.56 → 0.91). `amplifySpread` patří jen na čerstvě
 * postavenou ligu (`generateLeague`/`standingsToTeams`), ne do mezisezónního driftu.
 * Regrese se navíc dřív počítala ke KONSTANTĚ 1.65 (střed generovaného rozsahu), ne
 * k průměru ligy → reálným ligám (průměr ~1.35) to každou sezónu nafukovalo útok, a
 * clampy `ATTACK_MIN/MAX` (0.95–2.35) ořezávaly reálné špičky.
 */
function driftTeams(teams: GameTeam[], seed: number, ctx: DriftContext): GameTeam[] {
  if (teams.length === 0) return teams;
  const rand = mulberry32(seed);
  const size = teams.length;
  const rankOf = new Map(ctx.table.map((r) => [r.teamId, r.rank]));
  const expectedOf = new Map(
    [...teams]
      .sort((a, b) => b.attack - b.defense - (a.attack - a.defense))
      .map((t, i) => [t.id, i + 1] as const)
  );

  const meanAtk = mean(teams.map((t) => t.attack));
  const meanDef = mean(teams.map((t) => t.defense));
  const stdAtk = std(teams.map((t) => t.attack), meanAtk);
  const stdDef = std(teams.map((t) => t.defense), meanDef);

  const drifted = teams.map((t) => {
    // Tvůj klub regreduje pomaleji podle investic do mládeže.
    const reg = t.id === ctx.yourTeamId ? youthRegression(ctx.youth) : DRIFT_REGRESSION;
    // Přeplněné očekávání → posílí (kladné `perf`), podlezené → oslabí.
    const rank = rankOf.get(t.id) ?? Math.round(size / 2);
    const exp = expectedOf.get(t.id) ?? Math.round(size / 2);
    const perf = size > 1 ? (exp - rank) / (size - 1) : 0; // −1 .. 1
    const nudge = perf * DRIFT_PERFORMANCE;
    return {
      ...t,
      attack: t.attack + (meanAtk - t.attack) * reg + (rand() - 0.5) * DRIFT_NOISE + nudge,
      // Obrana: nižší = lepší, takže dobrý výkon ji SNIŽUJE.
      defense: t.defense + (meanDef - t.defense) * reg + (rand() - 0.5) * DRIFT_NOISE - nudge,
    };
  });

  // Renormalizace: vrať lize původní průměr i rozptyl (drift jen promíchá pořadí sil).
  const renorm = renormalize(drifted, meanAtk, stdAtk, meanDef, stdDef);
  const you = renorm.find((t) => t.id === ctx.yourTeamId);
  if (!you) return renorm;
  const developed = applyDevelopment(you, ctx.spend, renorm);
  return renorm.map((t) => (t.id === ctx.yourTeamId ? developed : t));
}

function renormalize(
  teams: GameTeam[],
  meanAtk: number,
  stdAtk: number,
  meanDef: number,
  stdDef: number
): GameTeam[] {
  const mA = mean(teams.map((t) => t.attack));
  const mD = mean(teams.map((t) => t.defense));
  const sA = std(teams.map((t) => t.attack), mA);
  const sD = std(teams.map((t) => t.defense), mD);
  const kA = sA > 1e-6 ? stdAtk / sA : 1;
  const kD = sD > 1e-6 ? stdDef / sD : 1;
  return teams.map((t) => ({
    ...t,
    attack: round2(clamp(meanAtk + (t.attack - mA) * kA, SPREAD_ATTACK_MIN, SPREAD_ATTACK_MAX)),
    defense: round2(clamp(meanDef + (t.defense - mD) * kD, SPREAD_DEFENSE_MIN, SPREAD_DEFENSE_MAX)),
  }));
}

/**
 * Spustí další sezónu se STEJNÝM týmem i ligou (driftnuté ratingy, investice, nový rozpis).
 * `spend` = rozdělení rozvojových bodů (bez něj se jen driftuje).
 */
export function startNextSeason(state: SeasonState, spend: DevSpend = EMPTY_SPEND): SeasonState {
  const nextSeed = deriveSeed(state.seed, 1000 + state.season);
  const table = currentTable(state);
  const teams = driftTeams(state.teams, nextSeed, {
    yourTeamId: state.yourTeamId,
    table,
    spend,
    youth: state.youth,
  });
  return newSeason(nextSeed, state.yourTeamId, {
    season: state.season + 1,
    teams,
    leagueId: state.leagueId,
    leagueName: state.leagueName,
    leagueAccess: state.leagueAccess,
    youth: nextYouth(state.youth, spend),
    scouting: nextScouting(state.scouting, spend),
  });
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function std(xs: number[], m: number): number {
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** Agregované kariérní statistiky napříč historií. */
export interface CareerStats {
  seasons: number;
  titles: number;
  europeanQualifs: number;
  relegations: number;
  promotions: number;
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
  avgPPG: number;
  cleanSheets: number;
}

export function careerStats(history: SeasonSummary[]): CareerStats | null {
  if (history.length === 0) return null;
  let titles = 0;
  let europeanQualifs = 0;
  let relegations = 0;
  let promotions = 0;
  let bestRank = Infinity;
  let worstRank = 0;
  let sumRank = 0;
  let totalWin = 0;
  let totalDraw = 0;
  let totalLoss = 0;
  let totalGoalsFor = 0;
  let totalGoalsAgainst = 0;
  let totalPoints = 0;
  let cleanSheets = 0;
  let games = 0;
  for (const s of history) {
    if (s.champion) titles++;
    if (s.europe !== "NONE") europeanQualifs++;
    if (s.relegated) relegations++;
    if (s.promoted) promotions++;
    bestRank = Math.min(bestRank, s.yourRank);
    worstRank = Math.max(worstRank, s.yourRank);
    sumRank += s.yourRank;
    totalWin += s.win;
    totalDraw += s.draw;
    totalLoss += s.loss;
    totalGoalsFor += s.goalsFor;
    totalGoalsAgainst += s.goalsAgainst;
    totalPoints += s.yourPoints;
    cleanSheets += s.cleanSheets;
    games += s.win + s.draw + s.loss;
  }
  const g = games || 1;
  return {
    seasons: history.length,
    titles,
    europeanQualifs,
    relegations,
    promotions,
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
    avgPPG: Math.round((totalPoints / g) * 100) / 100,
    cleanSheets,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
