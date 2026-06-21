import type { FixturePrediction } from "@prisma/client";
import type { PredictionRow } from "@/lib/types";
import { prisma } from "@/lib/db";
import { FINISHED_STATUSES } from "./apiFootball";

/**
 * Úložiště predikcí nad tabulkou `FixturePrediction` (real DB). Plní ho cron na
 * pozadí; predikční záložka / track-record / kalibrace odsud jen ČTOU.
 */

/** Predikční část jednoho řádku k upsertu (bez výsledku – ten doplní settle;
 * bez benchmarku – ten má vlastní cyklus přes `saveBenchmark`). */
export type PredictionUpsert = Omit<
  PredictionRow,
  | "status"
  | "homeGoals"
  | "awayGoals"
  | "benchAvailable"
  | "benchHomeWin"
  | "benchDraw"
  | "benchAwayWin"
> & { kickoff: string };

function toRow(p: FixturePrediction): PredictionRow {
  return {
    fixtureId: p.fixtureId,
    leagueId: p.leagueId,
    season: p.season,
    kickoff: p.kickoff.toISOString(),
    homeTeamId: p.homeTeamId,
    awayTeamId: p.awayTeamId,
    homeName: p.homeName,
    awayName: p.awayName,
    homeLogo: p.homeLogo,
    awayLogo: p.awayLogo,
    available: p.available,
    lambdaHome: p.lambdaHome,
    lambdaAway: p.lambdaAway,
    homeWin: p.homeWin,
    draw: p.draw,
    awayWin: p.awayWin,
    bttsYes: p.bttsYes,
    over25: p.over25,
    lowConfidence: p.lowConfidence,
    modelVersion: p.modelVersion,
    status: p.status,
    homeGoals: p.homeGoals,
    awayGoals: p.awayGoals,
    benchAvailable: p.benchAvailable,
    benchHomeWin: p.benchHomeWin,
    benchDraw: p.benchDraw,
    benchAwayWin: p.benchAwayWin,
  };
}

/** Upsert predikce (přepíše predikční pole, výsledek nechá být). */
export async function upsertPrediction(row: PredictionUpsert): Promise<void> {
  const data = {
    leagueId: row.leagueId,
    season: row.season,
    kickoff: new Date(row.kickoff),
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    homeName: row.homeName,
    awayName: row.awayName,
    homeLogo: row.homeLogo,
    awayLogo: row.awayLogo,
    available: row.available,
    lambdaHome: row.lambdaHome,
    lambdaAway: row.lambdaAway,
    homeWin: row.homeWin,
    draw: row.draw,
    awayWin: row.awayWin,
    bttsYes: row.bttsYes,
    over25: row.over25,
    lowConfidence: row.lowConfidence,
    modelVersion: row.modelVersion,
    predictedAt: new Date(),
  };
  await prisma.fixturePrediction.upsert({
    where: { fixtureId: row.fixtureId },
    create: { fixtureId: row.fixtureId, ...data },
    update: data,
  });
}

/**
 * Je už uložený benchmark (API predikce) pro tento zápas? Drží pravidlo „fetch 1×"
 * (predikujeme při 1. zachycení, API se mění blíž k výkopu → záměrně neaktualizovat).
 */
export async function hasBenchmark(fixtureId: number): Promise<boolean> {
  const row = await prisma.fixturePrediction.findUnique({
    where: { fixtureId },
    select: { benchHomeWin: true },
  });
  return row?.benchHomeWin != null;
}

/**
 * Uloží benchmark (predikce API-Footballu 1X2) na existující řádek. Samostatný
 * životní cyklus od naší predikce (`upsertPrediction` ho nepřepisuje).
 */
export async function saveBenchmark(
  fixtureId: number,
  bench: { home: number; draw: number; away: number }
): Promise<void> {
  await prisma.fixturePrediction.update({
    where: { fixtureId },
    data: {
      benchAvailable: true,
      benchHomeWin: bench.home,
      benchDraw: bench.draw,
      benchAwayWin: bench.away,
      benchFetchedAt: new Date(),
    },
  });
}

/** Nadcházející predikce (status NS, výkop v budoucnu) – pro záložku. */
export async function getUpcomingPredictionRows(
  modelVersion?: number
): Promise<PredictionRow[]> {
  const rows = await prisma.fixturePrediction.findMany({
    where: {
      status: "NS",
      kickoff: { gt: new Date() },
      ...(modelVersion != null ? { modelVersion } : {}),
    },
    orderBy: { kickoff: "asc" },
  });
  return rows.map(toRow);
}

/** Predikce čekající na výsledek (status NS, výkop už proběhl) – pro settle. */
export async function getUnsettledPredictions(
  graceMs = 3 * 60 * 60 * 1000
): Promise<PredictionRow[]> {
  const rows = await prisma.fixturePrediction.findMany({
    where: { status: "NS", kickoff: { lt: new Date(Date.now() - graceMs) } },
    orderBy: { kickoff: "asc" },
  });
  return rows.map(toRow);
}

/** Doplní skutečný výsledek odehraného zápasu. */
export async function applyResult(
  fixtureId: number,
  status: string,
  homeGoals: number | null,
  awayGoals: number | null
): Promise<void> {
  await prisma.fixturePrediction.update({
    where: { fixtureId },
    data: { status, homeGoals, awayGoals, settledAt: new Date() },
  });
}

/** Odehrané predikce se známým výsledkem – pro track-record a kalibraci. */
export async function getSettledPredictions(
  modelVersion?: number
): Promise<PredictionRow[]> {
  const rows = await prisma.fixturePrediction.findMany({
    where: {
      status: { in: [...FINISHED_STATUSES] },
      homeGoals: { not: null },
      ...(modelVersion != null ? { modelVersion } : {}),
    },
    orderBy: { kickoff: "desc" },
  });
  return rows.map(toRow);
}
