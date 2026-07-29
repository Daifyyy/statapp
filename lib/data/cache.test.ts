import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchStat } from "@/lib/types";

/**
 * `cache.ts` je jediný modul, kde se potkává TTL, verzování a zápis do Neonu – a má
 * nejvíc zdokumentovaných incidentů v repu (`null` se neuloží, prázdné pole krátce,
 * dvě verze cache). Dosud to všechno hlídal jen komentář.
 *
 * Prisma se proto nahrazuje malým in-memory fakem. Neověřuje se jím Prisma, ale **naše
 * rozhodnutí**: kdy se sáhne na fetcher, s jakým TTL se zapíše a které řádky se čtou.
 */
const { db } = vi.hoisted(() => {
  interface CacheRow {
    key: string;
    payload: unknown;
    expiresAt: Date;
  }
  type StatRow = Record<string, unknown> & {
    teamId: number;
    fixtureId: number;
    context: string;
    schemaVersion: number;
  };

  const apiRows = new Map<string, CacheRow>();
  const statRows: StatRow[] = [];
  const calls = { findUnique: 0, upsert: 0, findMany: 0, statUpsert: 0 };

  const matches = (row: StatRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "gte" in v) {
        return (row[k] as number) >= (v as { gte: number }).gte;
      }
      return row[k] === v;
    });

  const db = {
    apiCache: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        calls.findUnique++;
        return apiRows.get(where.key) ?? null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: CacheRow;
        update: Omit<CacheRow, "key">;
      }) => {
        calls.upsert++;
        const existing = apiRows.get(where.key);
        apiRows.set(where.key, existing ? { ...existing, ...update } : create);
      },
    },
    matchStatCache: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        calls.findMany++;
        return statRows.filter((r) => matches(r, where));
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { teamId_fixtureId_context: { teamId: number; fixtureId: number; context: string } };
        create: StatRow;
        update: StatRow;
      }) => {
        calls.statUpsert++;
        const k = where.teamId_fixtureId_context;
        const i = statRows.findIndex(
          (r) => r.teamId === k.teamId && r.fixtureId === k.fixtureId && r.context === k.context
        );
        if (i >= 0) statRows[i] = { ...statRows[i], ...update };
        else statRows.push(create);
      },
    },
    /** Test helpers (mimo Prisma API). */
    _reset() {
      apiRows.clear();
      statRows.length = 0;
      for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0;
    },
    _apiRow: (key: string) => apiRows.get(key),
    _seedApi: (row: CacheRow) => apiRows.set(row.key, row),
    _seedStat: (row: StatRow) => statRows.push(row),
    _statRows: () => statRows,
    _calls: () => calls,
  };
  return { db };
});

vi.mock("@/lib/db", () => ({ prisma: db, isRealDataConfigured: () => true }));

const {
  CURRENT_CACHE_VERSION,
  MIN_READABLE_CACHE_VERSION,
  cachedJson,
  cachedJsonMemo,
  getCachedMatchStats,
  getCachedFixtureStats,
  saveMatchStats,
} = await import("./cache");

const HOUR = 3600;
beforeEach(() => db._reset());

/** Minimální řádek `MatchStatCache` tak, jak ho vrací Prisma (všechny sloupce). */
function statRow(over: Record<string, unknown> = {}) {
  const nulls = Object.fromEntries(
    [
      "goalsFor", "goalsAgainst", "corners", "fouls", "shots", "xg", "xgAgainst",
      "shotsOnTarget", "shotsOffTarget", "blockedShots", "shotsInsideBox",
      "shotsOutsideBox", "offsides", "possession", "passesTotal", "passesAccurate",
      "passAccuracy", "yellowCards", "redCards", "saves", "opponentId",
      "opponentName", "opponentLogo",
    ].map((k) => [k, null])
  );
  return {
    teamId: 1,
    fixtureId: 100,
    context: "league",
    date: new Date("2026-03-01T18:00:00Z"),
    isHome: true,
    isNeutral: false,
    competitive: true,
    season: 2025,
    schemaVersion: CURRENT_CACHE_VERSION,
    ...nulls,
    ...over,
  };
}

describe("cachedJson – TTL a read-through", () => {
  it("miss → zavolá fetcher, uloží a vrátí", async () => {
    const fetcher = vi.fn(async () => ({ a: 1 }));
    await expect(cachedJson("k1", HOUR, fetcher)).resolves.toEqual({ a: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(db._apiRow("k1")?.payload).toEqual({ a: 1 });
  });

  it("platný hit → fetcher se NEVOLÁ", async () => {
    db._seedApi({ key: "k2", payload: { z: 9 }, expiresAt: new Date(Date.now() + HOUR * 1000) });
    const fetcher = vi.fn(async () => ({ z: 0 }));
    await expect(cachedJson("k2", HOUR, fetcher)).resolves.toEqual({ z: 9 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("expirovaný hit → fetcher se zavolá znovu a řádek se PŘEPÍŠE", async () => {
    db._seedApi({ key: "k3", payload: { v: "staré" }, expiresAt: new Date(Date.now() - 1000) });
    await expect(cachedJson("k3", HOUR, async () => ({ v: "nové" }))).resolves.toEqual({
      v: "nové",
    });
    expect(db._apiRow("k3")?.payload).toEqual({ v: "nové" });
  });
});

describe("cachedJson – dvě pojistky proti uložení „nic“ na dlouho", () => {
  it("`null` se NEUKLÁDÁ vůbec", async () => {
    // Sloupec `payload` je non-nullable → upsert s `null` házel výjimku, kterou volající
    // `catch` spolkl. Navenek to vypadalo jako „null se schválně neukládá", ve
    // skutečnosti to znamenalo PLNÝ PŘEPOČET při každém volání (u ratingů sken celé ligy).
    await expect(cachedJson("k4", HOUR, async () => null)).resolves.toBeNull();
    expect(db._apiRow("k4")).toBeUndefined();
    expect(db._calls().upsert).toBe(0);
  });

  it("`undefined` taky ne (== null pokrývá obojí)", async () => {
    await expect(cachedJson("k5", HOUR, async () => undefined)).resolves.toBeUndefined();
    expect(db._calls().upsert).toBe(0);
  });

  it("PRÁZDNÉ pole dostane krátké TTL (3 h), ne plných 24", async () => {
    // Sáhnout na `teams:X:<sezóna>` pár dní před publikací nové sezóny vrátí `[]`.
    // S plným TTL je liga slepá i poté, co API data doplní.
    const before = Date.now();
    await cachedJson("k6", 24 * HOUR, async () => []);
    const ttlMs = db._apiRow("k6")!.expiresAt.getTime() - before;
    expect(ttlMs).toBeLessThanOrEqual(3 * HOUR * 1000 + 50);
    expect(ttlMs).toBeGreaterThan(2.9 * HOUR * 1000);
  });

  it("krátké TTL se prázdnotou NEPRODLUŽUJE (je to Math.min, ne přepis)", async () => {
    // Kdyby se dosadilo natvrdo 3 h, klíč s hodinovým TTL by se prázdnem prodloužil.
    const before = Date.now();
    await cachedJson("k7", HOUR, async () => []);
    const ttlMs = db._apiRow("k7")!.expiresAt.getTime() - before;
    expect(ttlMs).toBeLessThanOrEqual(HOUR * 1000 + 50);
  });

  it("NEprázdné pole i objekt dostanou PLNÉ TTL", async () => {
    const before = Date.now();
    await cachedJson("k8", 24 * HOUR, async () => [1, 2, 3]);
    await cachedJson("k9", 24 * HOUR, async () => ({ ok: true }));
    for (const k of ["k8", "k9"]) {
      const ttlMs = db._apiRow(k)!.expiresAt.getTime() - before;
      expect(ttlMs).toBeGreaterThan(23 * HOUR * 1000);
    }
  });
});

describe("cachedJsonMemo – in-process vrstva", () => {
  it("druhé volání v okně nesáhne ANI do DB", async () => {
    const fetcher = vi.fn(async () => ({ live: 1 }));
    await cachedJsonMemo("memo-a", 60, HOUR, fetcher);
    const dbReads = db._calls().findUnique;
    await cachedJsonMemo("memo-a", 60, HOUR, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(db._calls().findUnique).toBe(dbReads); // žádné další čtení z Neonu
  });

  it("po vypršení paměti se jde zase do DB (ta zůstává zdrojem pravdy)", async () => {
    const fetcher = vi.fn(async () => ({ live: 2 }));
    await cachedJsonMemo("memo-b", 0, HOUR, fetcher); // memTtl 0 = hned stale
    const dbReads = db._calls().findUnique;
    await cachedJsonMemo("memo-b", 0, HOUR, fetcher);
    expect(db._calls().findUnique).toBeGreaterThan(dbReads);
  });
});

describe("verzování cache", () => {
  it("MIN nesmí být nad CURRENT (jinak je cache okamžitě celá nečitelná)", () => {
    expect(MIN_READABLE_CACHE_VERSION).toBeLessThanOrEqual(CURRENT_CACHE_VERSION);
  });

  it("řádek POD prahem se NEČTE", async () => {
    db._seedStat(statRow({ schemaVersion: MIN_READABLE_CACHE_VERSION - 1, goalsFor: 2 }));
    expect((await getCachedMatchStats(1, "league")).size).toBe(0);
  });

  it("řádek NA prahu (starší než current) se ČTE", async () => {
    // Tohle je celý smysl dvou konstant: verze 3 přidala jen metadata o soupeři, metriky
    // jsou v v2 i v3 identické. Kdyby se v2 přestala číst, zahodí se ~9 000 zápasů
    // a znovu stáhnou po 1 volání – draze a přesně na startu sezóny.
    db._seedStat(statRow({ schemaVersion: MIN_READABLE_CACHE_VERSION, goalsFor: 2 }));
    const map = await getCachedMatchStats(1, "league");
    expect(map.size).toBe(1);
    expect(map.get(100)!.metrics.GOALS_FOR).toBe(2);
  });

  it("zapisuje se vždy AKTUÁLNÍ verzí", async () => {
    await saveMatchStats(1, "league", [matchStat()]);
    expect(db._statRows()[0].schemaVersion).toBe(CURRENT_CACHE_VERSION);
  });
});

describe("čtení řádků", () => {
  it("chybějící sloupec se do metrik NEDOSTANE jako nula", async () => {
    // Nula by tiše posunula průměr; chybějící metrika musí renormalizovat váhy.
    db._seedStat(statRow({ goalsFor: 1, xg: null }));
    const ms = (await getCachedMatchStats(1, "league")).get(100)!;
    expect(ms.metrics.GOALS_FOR).toBe(1);
    expect("XG" in ms.metrics).toBe(false);
  });

  it("nula se ale zachová, když v datech OPRAVDU je", async () => {
    db._seedStat(statRow({ goalsFor: 0 }));
    const ms = (await getCachedMatchStats(1, "league")).get(100)!;
    expect(ms.metrics.GOALS_FOR).toBe(0);
  });

  it("soupeř: bez `opponentId` je null, s ním se složí (chybějící jméno = prázdné)", async () => {
    db._seedStat(statRow({ fixtureId: 100 }));
    db._seedStat(statRow({ fixtureId: 101, opponentId: 7, opponentName: null, opponentLogo: "u" }));
    const map = await getCachedMatchStats(1, "league");
    expect(map.get(100)!.opponent).toBeNull();
    expect(map.get(101)!.opponent).toEqual({ id: 7, name: "", logoUrl: "u" });
  });

  it("`isBaseline` je vždy false – dopočítá se až v realRepository", async () => {
    // Uložená hodnota by po přechodu sezóny zastarala; proto se neukládá.
    db._seedStat(statRow());
    expect((await getCachedMatchStats(1, "league")).get(100)!.isBaseline).toBe(false);
  });

  it("getCachedMatchStats klíčuje dle fixtureId, filtruje tým i kontext", async () => {
    db._seedStat(statRow({ teamId: 1, fixtureId: 100 }));
    db._seedStat(statRow({ teamId: 1, fixtureId: 101 }));
    db._seedStat(statRow({ teamId: 2, fixtureId: 100 })); // jiný tým
    db._seedStat(statRow({ teamId: 1, fixtureId: 102, context: "national" })); // jiný kontext
    const map = await getCachedMatchStats(1, "league");
    expect([...map.keys()].sort()).toEqual([100, 101]);
  });

  it("getCachedFixtureStats klíčuje dle teamId a bere OBĚ strany zápasu", async () => {
    // Jiný klíč než výše schválně: přehled zápasu potřebuje obě půlky, ne stovky
    // řádků jednoho týmu.
    db._seedStat(statRow({ teamId: 1, fixtureId: 100, goalsFor: 2 }));
    db._seedStat(statRow({ teamId: 2, fixtureId: 100, goalsFor: 1 }));
    db._seedStat(statRow({ teamId: 1, fixtureId: 999 }));
    const map = await getCachedFixtureStats(100);
    expect([...map.keys()].sort()).toEqual([1, 2]);
    expect(map.get(2)!.metrics.GOALS_FOR).toBe(1);
  });
});

/** Vzorový zápas se sadou metrik napříč typy sloupců. */
function matchStat(over: Partial<MatchStat> = {}): MatchStat {
  return {
    fixtureId: 100,
    date: "2026-03-01T18:00:00.000Z",
    isHome: true,
    isNeutral: false,
    competitive: true,
    season: 2025,
    isBaseline: false,
    metrics: {
      GOALS_FOR: 2,
      GOALS_AGAINST: 0,
      XG: 1.7,
      XG_AGAINST: 0.4,
      POSSESSION: 58,
      RED_CARDS: 0,
    },
    opponent: { id: 7, name: "Soupeř", logoUrl: "https://x/7.png" },
    ...over,
  };
}

describe("saveMatchStats", () => {
  it("prázdný seznam se DB ani nedotkne", async () => {
    await saveMatchStats(1, "league", []);
    expect(db._calls().statUpsert).toBe(0);
  });

  it("je to UPSERT: řádek staré verze se přepíše, nevznikne duplicita", async () => {
    // Bez upsertu by `getCachedMatchStats` starý řádek navždy ignoroval (je pod prahem)
    // a tým by se stahoval pořád dokola.
    db._seedStat(statRow({ schemaVersion: 1, goalsFor: 99 }));
    await saveMatchStats(1, "league", [matchStat()]);
    expect(db._statRows()).toHaveLength(1);
    expect(db._statRows()[0].schemaVersion).toBe(CURRENT_CACHE_VERSION);
    expect(db._statRows()[0].goalsFor).toBe(2);
  });

  it("round-trip: co se uloží, to se přečte zpět beze změny", async () => {
    const original = matchStat();
    await saveMatchStats(1, "league", [original]);
    const back = (await getCachedMatchStats(1, "league")).get(100)!;
    expect(back.metrics).toEqual(original.metrics);
    expect(back.opponent).toEqual(original.opponent);
    expect(back.date).toBe(original.date);
    expect(back.season).toBe(original.season);
    expect(back.isNeutral).toBe(original.isNeutral);
  });

  it("metrika, kterou zápas nemá, se uloží jako null (ne 0)", async () => {
    await saveMatchStats(1, "league", [matchStat({ metrics: { GOALS_FOR: 1 } })]);
    const row = db._statRows()[0];
    expect(row.goalsFor).toBe(1);
    expect(row.xg).toBeNull();
    expect(row.saves).toBeNull();
  });

  it("uloží víc zápasů naráz", async () => {
    await saveMatchStats(1, "league", [
      matchStat({ fixtureId: 100 }),
      matchStat({ fixtureId: 101 }),
    ]);
    expect(db._statRows()).toHaveLength(2);
  });
});
