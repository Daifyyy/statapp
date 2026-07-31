import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiFixture } from "./apiFootball";

/**
 * Sestavení klubu pro porovnání – konkrétně **co dostane tým, který v dané lize
 * nemá historii** (nováček z nižší soutěže). Celá logika žila bez testu a chovala se
 * nejhůř přesně na startu sezóny: fallback na zápasy napříč soutěžemi se vypínal
 * podle `formPool`, který se naplní prvním odehraným kolem, takže nováčkovi v 1. kole
 * spadl kontext z 20 zápasů na jediný a okno SEASON (70 % λ) zůstalo prázdné.
 *
 * API i cache jsou nahrazené fakem – neověřuje se Prisma ani síť, ale **naše rozhodnutí**:
 * kdy se sáhne pro formu napříč soutěžemi, co se do ní přimíchá a co skončí v baseline.
 */

const { api } = vi.hoisted(() => ({
  api: {
    /** klíč `team:league:season` → odehrané zápasy */
    teamFixtures: new Map<string, ApiFixture[]>(),
    lastFixtures: [] as ApiFixture[],
    lastFixturesCalls: 0,
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {},
  isRealDataConfigured: () => true,
}));

vi.mock("./apiFootball", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiFootball")>();
  return {
    ...actual,
    fetchTeamFixtures: async (team: number, league: number, season: number) =>
      api.teamFixtures.get(`${team}:${league}:${season}`) ?? [],
    fetchLastFixtures: async () => {
      api.lastFixturesCalls++;
      return api.lastFixtures;
    },
    // Statistiky nejsou předmětem testu – góly nese samotný fixture.
    fetchFixtureStatistics: async () => [],
  };
});

vi.mock("./cache", () => ({
  // Bez cachování: zajímá nás, kolikrát se sáhne na API, ne TTL (to má cache.test.ts).
  cachedJson: async <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) =>
    fetcher(),
  cachedJsonMemo: async <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) =>
    fetcher(),
  getCachedMatchStats: async () => new Map(),
  getCachedFixtureStats: async () => new Map(),
  saveMatchStats: async () => {},
  MIN_READABLE_CACHE_VERSION: 1,
}));

const { getCompareTeam } = await import("./realRepository");
const { CURRENT_SEASON, PREVIOUS_SEASON } = await import("./catalog");

const TEAM = 500;
const LEAGUE = 39; // Premier League
const SECOND_TIER = 40; // Championship
const META = { name: "Nováček FC", logoUrl: "", country: "Anglie" };

function fx(
  id: number,
  season: number,
  daysAgo: number,
  opts: { league?: number; leagueName?: string } = {}
): ApiFixture {
  return {
    fixture: {
      id,
      date: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      status: { short: "FT" },
    },
    league: {
      id: opts.league ?? LEAGUE,
      season,
      name: opts.leagueName ?? "Premier League",
    },
    teams: {
      home: { id: TEAM, name: META.name, logo: "" },
      away: { id: 900, name: "Soupeř", logo: "" },
    },
    goals: { home: 2, away: 1 },
  } as ApiFixture;
}

beforeEach(() => {
  api.teamFixtures.clear();
  api.lastFixtures = [];
  api.lastFixturesCalls = 0;
});

describe("buildClubTeam – nováček bez historie v lize", () => {
  /** 12 druholigových zápasů loňska + 3 letní přáteláky (už nová sezóna). */
  function setupFallbackPool() {
    api.lastFixtures = [
      ...Array.from({ length: 3 }, (_, i) =>
        fx(300 + i, CURRENT_SEASON, 10 + i, {
          league: 667,
          leagueName: "Club Friendlies",
        })
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        fx(200 + i, PREVIOUS_SEASON, 60 + i * 7, {
          league: SECOND_TIER,
          leagueName: "Championship",
        })
      ),
    ];
  }

  it("po prvním odehraném kole NEspadne na jediný zápas", async () => {
    // Přesně situace 2. kola: jedno ligové kolo odehráno, loni v této lize nic.
    api.teamFixtures.set(`${TEAM}:${LEAGUE}:${CURRENT_SEASON}`, [
      fx(1, CURRENT_SEASON, 1),
    ]);
    api.teamFixtures.set(`${TEAM}:${LEAGUE}:${PREVIOUS_SEASON}`, []);
    setupFallbackPool();

    const team = await getCompareTeam(TEAM, LEAGUE, false, META);

    expect(api.lastFixturesCalls).toBe(1);
    // Dřív tady byl přesně 1 zápas (fallback se po 1. kole vypnul).
    expect(team!.leagueMatches.length).toBeGreaterThan(1);
    // Ligové kolo v datech ZŮSTANE – fallback doplňuje, nenahrazuje.
    expect(team!.leagueMatches.some((m) => m.fixtureId === 1)).toBe(true);
    // A okno SEASON (70 % λ) má z čeho počítat: loňský druholigový ročník.
    expect(team!.leagueMatches.filter((m) => m.isBaseline).length).toBeGreaterThan(0);
  });

  it("letní příprava jde do formy, ale ne do baseline a jen se sníženou vahou", async () => {
    api.teamFixtures.set(`${TEAM}:${LEAGUE}:${CURRENT_SEASON}`, []);
    api.teamFixtures.set(`${TEAM}:${LEAGUE}:${PREVIOUS_SEASON}`, []);
    setupFallbackPool();

    const team = await getCompareTeam(TEAM, LEAGUE, false, META);
    const friendlies = team!.leagueMatches.filter((m) => m.fixtureId >= 300);

    expect(friendlies.length).toBeGreaterThan(0);
    // Přátelák je z nové sezóny → do okna „minulá sezóna" nepatří.
    expect(friendlies.every((m) => !m.isBaseline)).toBe(true);
    // `competitive: false` → `matchWeight` mu dá FRIENDLY_WEIGHT místo plné jedničky.
    expect(friendlies.every((m) => !m.competitive)).toBe(true);
  });

  it("stejný zápas ze dvou zdrojů se nezapočítá dvakrát", async () => {
    // Fallback vrací i zápas, který už máme z ligového dotazu.
    const shared = fx(1, CURRENT_SEASON, 1);
    api.teamFixtures.set(`${TEAM}:${LEAGUE}:${CURRENT_SEASON}`, [shared]);
    api.teamFixtures.set(`${TEAM}:${LEAGUE}:${PREVIOUS_SEASON}`, []);
    setupFallbackPool();
    api.lastFixtures = [shared, ...api.lastFixtures];

    const team = await getCompareTeam(TEAM, LEAGUE, false, META);
    const ids = team!.leagueMatches.map((m) => m.fixtureId);

    expect(ids.filter((id) => id === 1)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildClubTeam – klub s historií v lize", () => {
  it("nesahá pro zápasy napříč soutěžemi (žádné volání navíc)", async () => {
    api.teamFixtures.set(
      `${TEAM}:${LEAGUE}:${CURRENT_SEASON}`,
      Array.from({ length: 3 }, (_, i) => fx(i + 1, CURRENT_SEASON, i + 1))
    );
    api.teamFixtures.set(
      `${TEAM}:${LEAGUE}:${PREVIOUS_SEASON}`,
      Array.from({ length: 30 }, (_, i) => fx(100 + i, PREVIOUS_SEASON, 60 + i * 7))
    );

    const team = await getCompareTeam(TEAM, LEAGUE, false, META);

    expect(api.lastFixturesCalls).toBe(0);
    expect(team!.leagueMatches.filter((m) => m.isBaseline).length).toBeGreaterThan(0);
  });
});
