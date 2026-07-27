import type { FixturePrediction, Prisma } from "@prisma/client";
import type { PredictionRow } from "@/lib/types";
import { prisma } from "@/lib/db";
import { PREDICT_PARAMS } from "@/lib/stats/predict";
import { FINISHED_STATUSES } from "./apiFootball";

/**
 * Úložiště predikcí nad tabulkou `FixturePrediction` (real DB). Plní ho cron na
 * pozadí; predikční záložka / track-record / kalibrace odsud jen ČTOU.
 */

/** Predikční část jednoho řádku k upsertu (bez výsledku – ten doplní settle;
 * bez benchmarku – ten má vlastní cyklus přes `saveBenchmark`). */
export type PredictionUpsert = Omit<
  PredictionRow,
  // ρ/zostření/kalibrace nedodává volající – razítkuje je store z aktuálních `PREDICT_PARAMS`.
  | "rho"
  | "sharpen"
  | "calibA"
  | "calibB"
  | "status"
  | "homeGoals"
  | "awayGoals"
  | "benchAvailable"
  | "benchHomeWin"
  | "benchDraw"
  | "benchAwayWin"
  | "oddsBookmaker"
  | "oddsHome"
  | "oddsDraw"
  | "oddsAway"
  | "oddsOver25"
  | "oddsBtts"
  | "oddsUnder25"
  | "oddsBttsNo"
  | "oddsCloseHome"
  | "oddsCloseDraw"
  | "oddsCloseAway"
  | "oddsCloseOver25"
  | "oddsCloseUnder25"
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
    readinessSample: p.readinessSample,
    modelVersion: p.modelVersion,
    rho: p.rho,
    sharpen: p.sharpen,
    calibA: p.calibA,
    calibB: p.calibB,
    status: p.status,
    homeGoals: p.homeGoals,
    awayGoals: p.awayGoals,
    benchAvailable: p.benchAvailable,
    benchHomeWin: p.benchHomeWin,
    benchDraw: p.benchDraw,
    benchAwayWin: p.benchAwayWin,
    oddsBookmaker: p.oddsBookmaker,
    oddsHome: p.oddsHome,
    oddsDraw: p.oddsDraw,
    oddsAway: p.oddsAway,
    oddsOver25: p.oddsOver25,
    oddsBtts: p.oddsBtts,
    oddsUnder25: p.oddsUnder25,
    oddsBttsNo: p.oddsBttsNo,
    oddsCloseHome: p.oddsCloseHome,
    oddsCloseDraw: p.oddsCloseDraw,
    oddsCloseAway: p.oddsCloseAway,
    oddsCloseOver25: p.oddsCloseOver25,
    oddsCloseUnder25: p.oddsCloseUnder25,
    oddsBooks: p.oddsBooks,
    oddsCloseBooks: p.oddsCloseBooks,
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
    readinessSample: row.readinessSample,
    modelVersion: row.modelVersion,
    // Čím byly pravděpodobnosti odvozeny z λ – `reprice` podle toho pozná zastaralý řádek.
    rho: PREDICT_PARAMS.rho,
    sharpen: PREDICT_PARAMS.sharpen,
    calibA: PREDICT_PARAMS.calibA,
    calibB: PREDICT_PARAMS.calibB,
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

/**
 * Které snímky kurzu už zápas má. Pipeline podle toho pozná, jestli má vzít **první**
 * snímek (cena, kterou bychom dostali), **zavírací** (nejlepší odhad trhu), nebo nic –
 * viz `runPredictUpcoming`. Každý snímek se bere právě jednou.
 */
export async function oddsSnapshotState(
  fixtureId: number
): Promise<{ hasOpen: boolean; hasClose: boolean }> {
  const row = await prisma.fixturePrediction.findUnique({
    where: { fixtureId },
    select: { oddsFetchedAt: true, oddsCloseAt: true },
  });
  return { hasOpen: row?.oddsFetchedAt != null, hasClose: row?.oddsCloseAt != null };
}

/**
 * Uloží referenční kurzy (decimal odds) na existující řádek. Samostatný životní
 * cyklus od naší predikce – `upsertPrediction` je nepřepisuje (jako benchmark).
 */
export async function saveOdds(
  fixtureId: number,
  odds: {
    bookmaker: string;
    home: number | null;
    draw: number | null;
    away: number | null;
    over25: number | null;
    btts: number | null;
    under25?: number | null;
    bttsNo?: number | null;
    books?: unknown;
  }
): Promise<void> {
  await prisma.fixturePrediction.update({
    where: { fixtureId },
    data: {
      oddsBookmaker: odds.bookmaker,
      oddsHome: odds.home,
      oddsDraw: odds.draw,
      oddsAway: odds.away,
      oddsOver25: odds.over25,
      oddsBtts: odds.btts,
      // Protistrany: bez nich nejde odmaržovat Over/BTTS (viz komentář ve schématu).
      oddsUnder25: odds.under25 ?? null,
      oddsBttsNo: odds.bttsNo ?? null,
      // Všechny knihy z téže odpovědi → nejlepší cena + sharp konsenzus (0 volání navíc).
      ...(odds.books ? { oddsBooks: odds.books as Prisma.InputJsonValue } : {}),
      oddsFetchedAt: new Date(),
    },
  });
}

/**
 * Uloží **zavírací** snímek kurzu (druhý a poslední). BTTS se sem neukládá – zavírací
 * linii sledujeme jen u trhů, kde má CLV smysl počítat (1X2 a total), a BTTS je trh,
 * kde model prokazatelně nemá signál.
 */
export async function saveClosingOdds(
  fixtureId: number,
  odds: {
    home: number | null;
    draw: number | null;
    away: number | null;
    over25: number | null;
    under25?: number | null;
    books?: unknown;
  }
): Promise<void> {
  await prisma.fixturePrediction.update({
    where: { fixtureId },
    data: {
      oddsCloseHome: odds.home,
      oddsCloseDraw: odds.draw,
      oddsCloseAway: odds.away,
      oddsCloseOver25: odds.over25,
      oddsCloseUnder25: odds.under25 ?? null,
      // Zavírací snímek všech knih. Teprve s ním jde CLV počítat proti **sharp
      // konsenzu** místo jedné vybrané knihy – tedy proti nejlepšímu odhadu trhu.
      ...(odds.books ? { oddsCloseBooks: odds.books as Prisma.InputJsonValue } : {}),
      oddsCloseAt: new Date(),
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

/**
 * Nedávno odehrané predikce pro záložku „Výsledky" (poslední `days` dní, max
 * `limit`). Nenačítá celou historii – seznam je jen UI pohled na čerstvé výsledky.
 *
 * `leagueIds` **musí filtrovat už v dotazu**, ne až nad výsledkem: predikce se počítají
 * nad širší množinou soutěží než kolik jich appka denně nabízí, takže `take: limit` přes
 * všechny ligy vrátí okno, které může být z valné části tvořené ligami, jež volající
 * stejně zahodí – a záložka se pak smrskne nebo vyprázdní ve dnech, kdy hrají hlavně ony.
 */
export async function getRecentSettledPredictions(
  {
    days = 14,
    limit = 40,
    leagueIds,
  }: { days?: number; limit?: number; leagueIds?: number[] } = {}
): Promise<PredictionRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.fixturePrediction.findMany({
    where: {
      status: { in: [...FINISHED_STATUSES] },
      homeGoals: { not: null },
      kickoff: { gte: since },
      ...(leagueIds ? { leagueId: { in: leagueIds } } : {}),
    },
    orderBy: { kickoff: "desc" },
    take: limit,
  });
  return rows.map(toRow);
}
