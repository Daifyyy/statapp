import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MatchStat, Metric } from "@/lib/types";

export type MatchContext = "league" | "euro" | "national";

/**
 * Verze sady metrik v MatchStatCache. Po přidání nových metrik bumpni → starší
 * řádky se přestanou číst, dotáhnou se znovu z API (zadarmo) a přepíšou s plnou
 * sadou. Bezpečné pro sdílený Neon (žádné plošné mazání). §A/4
 */
export const CURRENT_CACHE_VERSION = 2;

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

/**
 * Krátká **in-process** vrstva před `cachedJson` pro pár horkých, sdílených klíčů
 * (živé skóre): při pollu N uživatelů se týž payload nečte N× z Neonu, ale drží se
 * `memTtlSeconds` v paměti instance. Padne s instancí (serverless) → jen zrychlení,
 * ne zdroj pravdy; DB TTL zůstává autoritativní. Používat jen pro malé, často čtené,
 * na uživateli nezávislé odpovědi (jinak roste paměť a hrozí stale mezi instancemi).
 */
const memoryHits = new Map<string, { value: unknown; expires: number }>();

export async function cachedJsonMemo<T>(
  key: string,
  memTtlSeconds: number,
  dbTtlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = memoryHits.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await cachedJson<T>(key, dbTtlSeconds, fetcher);
  memoryHits.set(key, { value, expires: now + memTtlSeconds * 1000 });
  return value;
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
  if (r.xgAgainst != null) metrics.XG_AGAINST = r.xgAgainst;
  if (r.shotsOnTarget != null) metrics.SHOTS_ON_TARGET = r.shotsOnTarget;
  if (r.shotsOffTarget != null) metrics.SHOTS_OFF_TARGET = r.shotsOffTarget;
  if (r.blockedShots != null) metrics.BLOCKED_SHOTS = r.blockedShots;
  if (r.shotsInsideBox != null) metrics.SHOTS_INSIDE_BOX = r.shotsInsideBox;
  if (r.shotsOutsideBox != null) metrics.SHOTS_OUTSIDE_BOX = r.shotsOutsideBox;
  if (r.offsides != null) metrics.OFFSIDES = r.offsides;
  if (r.possession != null) metrics.POSSESSION = r.possession;
  if (r.passesTotal != null) metrics.PASSES_TOTAL = r.passesTotal;
  if (r.passesAccurate != null) metrics.PASSES_ACCURATE = r.passesAccurate;
  if (r.passAccuracy != null) metrics.PASS_ACCURACY = r.passAccuracy;
  if (r.yellowCards != null) metrics.YELLOW_CARDS = r.yellowCards;
  if (r.redCards != null) metrics.RED_CARDS = r.redCards;
  if (r.saves != null) metrics.SAVES = r.saves;
  return {
    fixtureId: r.fixtureId,
    date: r.date.toISOString(),
    isHome: r.isHome,
    isNeutral: r.isNeutral,
    competitive: r.competitive,
    season: r.season,
    isBaseline: false, // dopočítá se v realRepository dle baseline sezóny
    metrics,
  };
}

/** Načte všechny cachované zápasy týmu v daném kontextu jako mapu dle fixtureId. */
export async function getCachedMatchStats(
  teamId: number,
  context: MatchContext
): Promise<Map<number, MatchStat>> {
  const rows = await prisma.matchStatCache.findMany({
    where: { teamId, context, schemaVersion: CURRENT_CACHE_VERSION },
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
    season: ms.season,
    goalsFor: ms.metrics.GOALS_FOR ?? null,
    goalsAgainst: ms.metrics.GOALS_AGAINST ?? null,
    corners: ms.metrics.CORNERS ?? null,
    fouls: ms.metrics.FOULS ?? null,
    shots: ms.metrics.SHOTS ?? null,
    xg: ms.metrics.XG ?? null,
    xgAgainst: ms.metrics.XG_AGAINST ?? null,
    shotsOnTarget: ms.metrics.SHOTS_ON_TARGET ?? null,
    shotsOffTarget: ms.metrics.SHOTS_OFF_TARGET ?? null,
    blockedShots: ms.metrics.BLOCKED_SHOTS ?? null,
    shotsInsideBox: ms.metrics.SHOTS_INSIDE_BOX ?? null,
    shotsOutsideBox: ms.metrics.SHOTS_OUTSIDE_BOX ?? null,
    offsides: ms.metrics.OFFSIDES ?? null,
    possession: ms.metrics.POSSESSION ?? null,
    passesTotal: ms.metrics.PASSES_TOTAL ?? null,
    passesAccurate: ms.metrics.PASSES_ACCURATE ?? null,
    passAccuracy: ms.metrics.PASS_ACCURACY ?? null,
    yellowCards: ms.metrics.YELLOW_CARDS ?? null,
    redCards: ms.metrics.RED_CARDS ?? null,
    saves: ms.metrics.SAVES ?? null,
    schemaVersion: CURRENT_CACHE_VERSION,
  };
}

/**
 * Uloží statistiky více zápasů (mimo kritickou cestu stahování). Upsert (ne jen
 * insert), aby se řádky ze starší `schemaVersion` přepsaly na aktuální sadu metrik
 * – jinak by je `getCachedMatchStats` navždy ignoroval a tým se stahoval pořád dokola.
 */
export async function saveMatchStats(
  teamId: number,
  context: MatchContext,
  list: MatchStat[]
): Promise<void> {
  if (list.length === 0) return;
  await Promise.all(
    list.map((ms) => {
      const row = toRow(teamId, context, ms);
      return prisma.matchStatCache.upsert({
        where: {
          teamId_fixtureId_context: {
            teamId,
            fixtureId: ms.fixtureId,
            context,
          },
        },
        create: row,
        update: row,
      });
    })
  );
}
