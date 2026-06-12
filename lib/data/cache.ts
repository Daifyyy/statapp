import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MatchStat, Metric } from "@/lib/types";

export type MatchContext = "league" | "euro" | "national";

/**
 * TTL cache raw odpovědí (ligy, týmy, seznamy zápasů). Read-through:
 * při miss/expiraci zavolá `fetcher`, výsledek uloží a vrátí (§1.1).
 */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = new Date();
  const hit = await prisma.apiCache.findUnique({ where: { key } });
  if (hit && hit.expiresAt > now) {
    return hit.payload as T;
  }
  const data = await fetcher();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const payload = data as unknown as Prisma.InputJsonValue;
  await prisma.apiCache.upsert({
    where: { key },
    create: { key, payload, expiresAt },
    update: { payload, expiresAt },
  });
  return data;
}

// ---- Trvalá cache per-zápas statistik (MatchStatCache) ----

type Row = Prisma.MatchStatCacheGetPayload<object>;

function rowToMatchStat(r: Row): MatchStat {
  const metrics: Partial<Record<Metric, number>> = {};
  if (r.goalsFor != null) metrics.GOALS_FOR = r.goalsFor;
  if (r.goalsAgainst != null) metrics.GOALS_AGAINST = r.goalsAgainst;
  if (r.corners != null) metrics.CORNERS = r.corners;
  if (r.fouls != null) metrics.FOULS = r.fouls;
  if (r.shots != null) metrics.SHOTS = r.shots;
  if (r.xg != null) metrics.XG = r.xg;
  return {
    fixtureId: r.fixtureId,
    date: r.date.toISOString(),
    isHome: r.isHome,
    isNeutral: r.isNeutral,
    competitive: r.competitive,
    isPreviousSeason: r.isPreviousSeason,
    metrics,
  };
}

/** Načte všechny cachované zápasy týmu v daném kontextu jako mapu dle fixtureId. */
export async function getCachedMatchStats(
  teamId: number,
  context: MatchContext
): Promise<Map<number, MatchStat>> {
  const rows = await prisma.matchStatCache.findMany({
    where: { teamId, context },
  });
  return new Map(rows.map((r) => [r.fixtureId, rowToMatchStat(r)]));
}

function toRow(teamId: number, context: MatchContext, ms: MatchStat) {
  return {
    teamId,
    fixtureId: ms.fixtureId,
    context,
    date: new Date(ms.date),
    isHome: ms.isHome,
    isNeutral: ms.isNeutral,
    competitive: ms.competitive,
    isPreviousSeason: ms.isPreviousSeason,
    goalsFor: ms.metrics.GOALS_FOR ?? null,
    goalsAgainst: ms.metrics.GOALS_AGAINST ?? null,
    corners: ms.metrics.CORNERS ?? null,
    fouls: ms.metrics.FOULS ?? null,
    shots: ms.metrics.SHOTS ?? null,
    xg: ms.metrics.XG ?? null,
  };
}

/**
 * Dávkové uložení statistik více zápasů jedním dotazem (mimo kritickou cestu
 * stahování). `skipDuplicates` – historické zápasy se nemění, takže jen inserty.
 */
export async function saveMatchStats(
  teamId: number,
  context: MatchContext,
  list: MatchStat[]
): Promise<void> {
  if (list.length === 0) return;
  await prisma.matchStatCache.createMany({
    data: list.map((ms) => toRow(teamId, context, ms)),
    skipDuplicates: true,
  });
}
