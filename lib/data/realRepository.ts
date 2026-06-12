import type { League, MatchStat, Metric, Team } from "@/lib/types";
import {
  fetchFixtureStatistics,
  fetchLastFixtures,
  fetchLeagueTeams,
  fetchTeamFixtures,
  FINISHED_STATUSES,
  STAT_TYPE_MAP,
  type ApiFixture,
  type ApiFixtureStats,
} from "./apiFootball";
import {
  cachedJson,
  getCachedMatchStats,
  saveMatchStats,
  type MatchContext,
} from "./cache";
import {
  CLUB_LEAGUES,
  CURRENT_SEASON,
  EURO_LEAGUE_IDS,
  NATIONAL_LEAGUES,
  PREVIOUS_SEASON,
  getConfederation,
  isNationalLeague,
} from "./catalog";

const LIST_TTL = 60 * 60 * 24; // 24 h pro seznamy (dokončené sezóny jsou stabilní)
const FORM_FIXTURES = 12; // posl. zápasy pro LAST10/LAST5
const BASELINE_SAMPLE = 10; // reprezentativní vzorek baseline sezóny (okno SEASON)
const SEASON_COMPLETE_MIN = 25; // od kolika odehraných je sezóna „v podstatě dohraná"
const NATIONAL_LAST = 25;

type TeamLite = Pick<Team, "id" | "name" | "logoUrl" | "country" | "entityType">;

// ---- Veřejné API repository ----

export function getLeagues(): League[] {
  return [...CLUB_LEAGUES, ...NATIONAL_LEAGUES];
}

/**
 * Předehřeje KATALOG – seznamy týmů všech lig + konfederací (~24 volání, cache).
 * Lehké, vhodné pro denní cron: menu výběru je pak instantní, ale zápasová data
 * zůstávají líná (žádný bulk download).
 */
export async function warmCatalog(): Promise<number> {
  let warmed = 0;
  for (const l of getLeagues()) {
    try {
      await getTeamsByLeague(l.id);
      warmed++;
    } catch {
      // pokračuj i při výpadku jedné ligy
    }
  }
  return warmed;
}

/**
 * Předehřeje ZÁPASOVÁ DATA všech týmů jedné ligy/soutěže (těžké – ~20×22 volání).
 * Jen na vyžádání (`?league=ID`), ne v denním cronu.
 */
export async function warmLeague(leagueId: number): Promise<number> {
  const teams = await getTeamsByLeague(leagueId);
  let warmed = 0;
  for (const t of teams) {
    try {
      await getCompareTeam(t.id, leagueId, false);
      warmed++;
    } catch {
      // pokračuj dál i při výpadku jednoho týmu
    }
  }
  return warmed;
}

export async function getTeamsByLeague(leagueId: number): Promise<TeamLite[]> {
  // Reprezentace: dynamicky z kvalifikační soutěže dané konfederace (cache).
  if (isNationalLeague(leagueId)) {
    const confed = getConfederation(leagueId)!;
    const teams = await cachedJson(
      `natteams:${leagueId}`,
      LIST_TTL,
      () => fetchLeagueTeams(confed.wcQualLeagueId, confed.season)
    );
    return teams
      .filter((t) => t.team.national)
      .map((t) => ({
        id: t.team.id,
        name: t.team.name,
        logoUrl: t.team.logo,
        country: t.team.name,
        entityType: "NATIONAL" as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "cs"));
  }

  const teams = await cachedJson(
    `teams:${leagueId}:${CURRENT_SEASON}`,
    LIST_TTL,
    () => fetchLeagueTeams(leagueId, CURRENT_SEASON)
  );
  return teams
    .map((t) => ({
      id: t.team.id,
      name: t.team.name,
      logoUrl: t.team.logo,
      country: "",
      entityType: "CLUB" as const,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

/**
 * Sestaví tým s reálnými zápasy (přes cache) pro porovnání.
 * `includeEuro` se zapne jen u cross-league dvojic – pro stejnou ligu jsou
 * evropské poháry zbytečné a šetříme tím polovinu volání API.
 */
export async function getCompareTeam(
  teamId: number,
  leagueId: number,
  includeEuro = false
): Promise<Team | null> {
  if (isNationalLeague(leagueId)) {
    return buildNationalTeam(teamId, leagueId);
  }
  return buildClubTeam(teamId, leagueId, includeEuro);
}

// ---- Sestavení reprezentace ----

async function buildNationalTeam(
  teamId: number,
  leagueId: number
): Promise<Team | null> {
  // Název + logo z (cachovaného) seznamu reprezentací dané konfederace.
  const teams = await getTeamsByLeague(leagueId);
  const meta = teams.find((t) => t.id === teamId);
  if (!meta) return null;

  const fixtures = await cachedJson(
    `natfix:${teamId}`,
    LIST_TTL,
    () => fetchLastFixtures(teamId, NATIONAL_LAST)
  );
  const finished = onlyFinished(fixtures);

  const leagueMatches = await assemble(teamId, "national", finished, (f) => ({
    competitive: !isFriendly(f.league.name),
    isNeutral: false, // neutrální půdu API spolehlivě nehlásí (aproximace)
  }));

  return {
    id: teamId,
    name: meta.name,
    logoUrl: meta.logoUrl,
    country: meta.country,
    entityType: "NATIONAL",
    leagueId,
    leagueMatches,
  };
}

// ---- Sestavení klubu ----

async function buildClubTeam(
  teamId: number,
  leagueId: number,
  includeEuro: boolean
): Promise<Team | null> {
  // Název + logo z (cachovaného) seznamu týmů ligy.
  const teams = await getTeamsByLeague(leagueId);
  const meta = teams.find((t) => t.id === teamId);
  if (!meta) return null;

  // „Minulá sezóna" (baseline) = nejnovější DOKONČENÁ sezóna.
  // Je-li aktuální sezóna v podstatě dohraná (mezisezóna), je baseline ona →
  // naplní se i nováčkům a 2024 se vůbec nestahuje.
  const currentFinished = onlyFinished(
    await listClubFixtures(teamId, leagueId, CURRENT_SEASON)
  );
  const currentComplete = currentFinished.length >= SEASON_COMPLETE_MIN;
  const baselineSeason = currentComplete ? CURRENT_SEASON : PREVIOUS_SEASON;

  let formPool = currentFinished;
  let baselinePool = currentFinished;
  if (!currentComplete) {
    const previousFinished = onlyFinished(
      await listClubFixtures(teamId, leagueId, PREVIOUS_SEASON)
    );
    formPool = [...currentFinished, ...previousFinished];
    baselinePool = previousFinished;
  }

  // LAST10/5 = nejnovější zápasy; SEASON = reprezentativní vzorek baseline sezóny.
  const leagueFixtures = dedupeFixtures([
    ...byDateDescFx(formPool).slice(0, FORM_FIXTURES),
    ...spreadSample(baselinePool, BASELINE_SAMPLE),
  ]);
  const leagueMatches = tagBaseline(
    await assemble(teamId, "league", leagueFixtures, () => ({
      competitive: true,
      isNeutral: false,
    })),
    baselineSeason
  );

  // Evropské poháry (UCL/UEL/UECL) – jen pro cross-league porovnání, aktuální sezóna.
  let euroMatches: MatchStat[] | undefined;
  if (includeEuro) {
    const euroLists = await Promise.all(
      EURO_LEAGUE_IDS.map((id) => listClubFixtures(teamId, id, CURRENT_SEASON))
    );
    const euroFixtures = onlyFinished(euroLists.flat());
    euroMatches = euroFixtures.length
      ? tagBaseline(
          await assemble(teamId, "euro", euroFixtures, () => ({
            competitive: true,
            isNeutral: false,
          })),
          baselineSeason
        )
      : undefined;
  }

  return {
    id: teamId,
    name: meta.name,
    logoUrl: meta.logoUrl,
    country: meta.country,
    entityType: "CLUB",
    leagueId,
    leagueMatches,
    euroMatches,
  };
}

function listClubFixtures(
  teamId: number,
  leagueId: number,
  season: number
): Promise<ApiFixture[]> {
  return cachedJson(`fix:${teamId}:${leagueId}:${season}`, LIST_TTL, () =>
    fetchTeamFixtures(teamId, leagueId, season)
  );
}

// ---- Společná agregace přes trvalou cache ----

type FixtureOpts = (f: ApiFixture) => {
  competitive: boolean;
  isNeutral: boolean;
};

async function assemble(
  teamId: number,
  context: MatchContext,
  fixtures: ApiFixture[],
  optsFor: FixtureOpts
): Promise<MatchStat[]> {
  const cache = await getCachedMatchStats(teamId, context);
  const result: MatchStat[] = [];
  const toFetch: ApiFixture[] = [];

  for (const f of fixtures) {
    const cached = cache.get(f.fixture.id);
    if (cached) result.push(cached);
    else toFetch.push(f);
  }

  // Per-zápas statistiky stahuj s nízkou souběžností (edge burst ochrana).
  const fetched: MatchStat[] = [];
  await mapLimit(toFetch, 3, async (f) => {
    let statsTeam: ApiFixtureStats[number] | null = null;
    try {
      const stats = await fetchFixtureStatistics(f.fixture.id);
      statsTeam = stats.find((s) => s.team.id === teamId) ?? null;
    } catch {
      // Statistiky nemusí existovat (časté u reprezentací) – ponech jen góly.
    }
    fetched.push(buildMatchStat(f, teamId, statsTeam, optsFor(f)));
  });

  // Jeden dávkový zápis do cache (mimo kritickou cestu stahování).
  await saveMatchStats(teamId, context, fetched);
  result.push(...fetched);

  return result.sort((a, b) => b.date.localeCompare(a.date));
}

function buildMatchStat(
  f: ApiFixture,
  teamId: number,
  statsTeam: ApiFixtureStats[number] | null,
  opts: ReturnType<FixtureOpts>
): MatchStat {
  const isHome = f.teams.home.id === teamId;
  const gf = isHome ? f.goals.home : f.goals.away;
  const ga = isHome ? f.goals.away : f.goals.home;

  const metrics: Partial<Record<Metric, number>> = {};
  if (gf != null) metrics.GOALS_FOR = gf;
  if (ga != null) metrics.GOALS_AGAINST = ga;
  if (statsTeam) {
    for (const s of statsTeam.statistics) {
      const metric = STAT_TYPE_MAP[s.type];
      if (!metric || s.value == null) continue;
      const num = typeof s.value === "number" ? s.value : parseFloat(s.value);
      if (!Number.isNaN(num)) metrics[metric] = num;
    }
  }

  return {
    fixtureId: f.fixture.id,
    date: f.fixture.date,
    isHome,
    isNeutral: opts.isNeutral,
    competitive: opts.competitive,
    season: f.league.season,
    isBaseline: false, // dopočítá se přes tagBaseline()
    metrics,
  };
}

// ---- Pomocné ----

function onlyFinished(fixtures: ApiFixture[]): ApiFixture[] {
  return fixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short));
}

function byDateDescFx(fixtures: ApiFixture[]): ApiFixture[] {
  return [...fixtures].sort((a, b) =>
    b.fixture.date.localeCompare(a.fixture.date)
  );
}

/** Rovnoměrný vzorek ~n zápasů napříč sezónou (reprezentativní průměr). */
function spreadSample(fixtures: ApiFixture[], n: number): ApiFixture[] {
  const asc = [...fixtures].sort((a, b) =>
    a.fixture.date.localeCompare(b.fixture.date)
  );
  if (asc.length <= n) return asc;
  const out: ApiFixture[] = [];
  const step = asc.length / n;
  for (let i = 0; i < n; i++) out.push(asc[Math.floor(i * step)]);
  return out;
}

function dedupeFixtures(fixtures: ApiFixture[]): ApiFixture[] {
  const seen = new Set<number>();
  return fixtures.filter((f) =>
    seen.has(f.fixture.id) ? false : (seen.add(f.fixture.id), true)
  );
}

/** Označí zápasy nejnovější dokončené sezóny jako baseline (okno SEASON). */
function tagBaseline(matches: MatchStat[], baselineSeason: number): MatchStat[] {
  for (const m of matches) m.isBaseline = m.season === baselineSeason;
  return matches;
}

function isFriendly(leagueName: string): boolean {
  return /friendl/i.test(leagueName);
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
