import type {
  FixtureDay,
  Injury,
  League,
  LeagueGoalsAvg,
  LeagueTable,
  LiveScore,
  MatchStat,
  Metric,
  Scorer,
  Standing,
  Team,
} from "@/lib/types";
import {
  fetchFixtureStatistics,
  fetchFixturesByDate,
  fetchLastFixtures,
  fetchLeagueTeams,
  fetchLiveFixtures,
  fetchTeamFixtures,
  fetchTeamInjuries,
  fetchLeagueSeasonFixtures,
  fetchLeagueStandings,
  fetchLeagueTopScorers,
  FINISHED_STATUSES,
  LIVE_STATUSES,
  STAT_TYPE_MAP,
  type ApiFixture,
  type ApiFixtureStats,
  type ApiStandingRow,
} from "./apiFootball";
import { normalizeUpcomingFixtures } from "./fixtures";
import {
  cachedJson,
  getCachedMatchStats,
  saveMatchStats,
  CURRENT_CACHE_VERSION,
  type MatchContext,
} from "./cache";
import { prisma } from "@/lib/db";
import { selectCurrentInjuries } from "./injuries";
import {
  computeLeagueBaseline,
  computeLeagueGoalsAvg,
  deriveLeagueAccess,
  normalizeLeagueTable,
  pickTeamStanding,
} from "./standings";
import { DEFAULT_BASELINE, DEFAULT_TUNING, type LeagueBaseline } from "@/lib/stats/predict";
import {
  computeRatings,
  NATIONAL_FRIENDLY_WEIGHT,
  NATIONAL_RATING_OPTIONS,
  RATING_MIN_MATCHES,
  RATING_OPTIONS,
  RATING_WINDOW_DAYS,
  type RatingMatch,
  type TeamStrength,
} from "@/lib/stats/ratings";
import { fullTimeGoals } from "./fixtures";
import { pickTeamScorers } from "./scorers";
import { standingsToTeams } from "@/lib/game/teams";
import type { GameTeam, LeagueAccess } from "@/lib/game/types";
import {
  CLUB_LEAGUES,
  CURRENT_SEASON,
  EURO_LEAGUE_IDS,
  FIXTURE_LIST_LEAGUE_IDS,
  FRIENDLIES_LEAGUE_ID,
  NATIONAL_HISTORY_LEAGUE_IDS,
  NATIONAL_LEAGUES,
  PREVIOUS_SEASON,
  getConfederation,
  isNationalLeague,
  isNeutralNationalLeague,
  teamLogoUrl,
} from "./catalog";

const LIST_TTL = 60 * 60 * 24; // 24 h pro seznamy (dokončené sezóny jsou stabilní)
const INJ_TTL = 60 * 60 * 6; // 6 h pro zranění (soupiska se mění průběžně)
const STANDINGS_TTL = 60 * 60 * 6; // 6 h pro tabulku (mění se jen po odehraném kole)
const SCORERS_TTL = 60 * 60 * 12; // 12 h pro střelce (žebříček se hýbe pomalu)
const FIX_TTL = 60 * 60; // 1 h pro denní rozpis (časy/zápasy se mohou měnit)
const LIVE_TTL = 90; // 90 s pro živé skóre (sdílené mezi všemi klienty → strop nákladů)
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
  // Ligové tabulky klubových lig (levné, ~18 volání) → rank v seznamech Zápasy/Tipy
  // je pak instantní (jinak by je líně tahal cold homepage load).
  await Promise.all(
    CLUB_LEAGUES.map((l) => cachedLeagueStandings(l.id).catch(() => undefined))
  );
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
    const fromQual: TeamLite[] = teams
      .filter((t) => t.team.national)
      .map((t) => ({
        id: t.team.id,
        name: t.team.name,
        logoUrl: t.team.logo,
        country: t.team.name,
        entityType: "NATIONAL" as const,
      }));
    // Doplň ručně vedené týmy (pořadatelé MS bez kvalifikace), ať nechybí ve výběru.
    const extras: TeamLite[] = (confed.extraTeams ?? [])
      .filter((e) => !fromQual.some((t) => t.id === e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        logoUrl: teamLogoUrl(e.id),
        country: e.name,
        entityType: "NATIONAL" as const,
      }));
    return [...fromQual, ...extras].sort((a, b) =>
      a.name.localeCompare(b.name, "cs")
    );
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

/**
 * Aktuálně zranění/absentující hráči týmu. Data v API jsou nekonzistentní
 * (závisí na lize/plánu) → při nedostupnosti vrací prázdný seznam, ne chybu.
 * Dedup dle hráče (nejnovější záznam), TTL cache (soupiska se mění).
 */
export async function getTeamInjuries(
  teamId: number,
  leagueId: number
): Promise<Injury[]> {
  const season = isNationalLeague(leagueId)
    ? (getConfederation(leagueId)?.season ?? CURRENT_SEASON)
    : CURRENT_SEASON;
  try {
    const raw = await cachedJson(`inj:${teamId}:${season}`, INJ_TTL, () =>
      fetchTeamInjuries(teamId, season)
    );
    // Filtr stáří + dedup (čistá funkce): API vrací zranění napříč celou sezónou,
    // tak vyřadíme zastaralá (uzdravená) i záznamy bez data – viz injuries.ts.
    return selectCurrentInjuries(raw);
  } catch {
    return [];
  }
}

/**
 * Postavení týmu v ligové tabulce (FREE kontext, mimo compareTeams i predikci).
 * Reprezentace tabulku spolehlivě nemají → `null` (UI sekci skryje). Cache je **per
 * liga** (`standings:<liga>:<sezóna>`) → jedno volání pokryje oba týmy stejné ligy.
 * Při nedostupnosti (jiná soutěž, výpadek) vrací `null`, ne chybu.
 */
export async function getLeagueStanding(
  teamId: number,
  leagueId: number
): Promise<{ standing: Standing | null; leagueAvg: LeagueGoalsAvg | null }> {
  if (isNationalLeague(leagueId)) return { standing: null, leagueAvg: null };
  try {
    const raw = await cachedLeagueStandings(leagueId);
    return {
      standing: pickTeamStanding(raw, teamId),
      leagueAvg: computeLeagueGoalsAvg(raw),
    };
  } catch {
    return { standing: null, leagueAvg: null };
  }
}

/**
 * Ligové měřítko pro λ (⌀ góly domácích/hostů v této lize). Sdílí `standings:` cache
 * (per liga, TTL) → **0 API volání navíc**. Reprezentace tabulku nemají a mezisezónní
 * tabulka je prázdná → `null` = predikce použije typický default (`DEFAULT_BASELINE`).
 */
export async function getLeagueBaseline(
  leagueId: number
): Promise<LeagueBaseline | null> {
  if (isNationalLeague(leagueId)) return null;
  try {
    return computeLeagueBaseline(await cachedLeagueStandings(leagueId));
  } catch {
    return null;
  }
}

/**
 * Síly týmů ligy s **korekcí na soupeře a časovým útlumem** (`computeRatings`, C2) –
 * to, z čeho se staví λ. Zdrojem jsou **už cachované zápasy** (`MatchStatCache`), takže
 * **0 volání API**: jeden řádek nese góly obou stran (`goalsFor`/`goalsAgainst`) i xG obou
 * stran (`xg`/`xgAgainst`), takže zápas jde zrekonstruovat i z poloviny dvojice.
 *
 * Výsledek se cachuje per liga (TTL 6 h) – síly se mezi koly nemění. Málo dat (nová liga,
 * studená cache) → `null` a predikce spadne na okenní model.
 */
export async function getLeagueRatings(
  leagueId: number
): Promise<Map<number, TeamStrength> | null> {
  if (isNationalLeague(leagueId)) return null;
  try {
    // Síly se mezi koly nemění → cachuj hotový výsledek (TTL 6 h jako tabulka). Map se
    // do JSON neuloží, proto pole dvojic. `null` (málo dat) se necachuje – ať se to samo
    // spraví, jakmile cache zápasů naroste.
    const cached = await cachedJson<[number, TeamStrength][] | null>(
      `ratings:${leagueId}:${CURRENT_SEASON}`,
      STANDINGS_TTL,
      async () => {
        const table = await computeLeagueRatings(leagueId);
        return table ? [...table.entries()] : null;
      }
    );
    return cached && cached.length > 0 ? new Map(cached) : null;
  } catch {
    return null;
  }
}

/**
 * **Globální ratingy reprezentací** – jeden pool všech národů (ne per konfederace, viz
 * `NATIONAL_RATING_OPTIONS`). Zdrojem jsou zápasy reprezentačních soutěží včetně přáteláků
 * (`NATIONAL_HISTORY_LEAGUE_IDS`), stažené **1 voláním na soutěž a sezónu** a cachované
 * (TTL 24 h; dohrané sezóny se nemění). Hotové síly se cachují taky (TTL 12 h).
 *
 * Tohle je oprava **strukturální** chyby: dosud se góly Portugalska (nastřílené v UEFA)
 * srovnávaly s góly Uzbekistánu (v AFC), jako by pocházely ze stejného rozdělení. V jednom
 * poolu se konfederace propojí a síla se propaguje přes mezikontinentální zápasy.
 * Backtest: log-loss 1.0182 → 0.9352, přesnost 49.5 → 55.3 %.
 */
export async function getNationalRatings(): Promise<Map<
  number,
  TeamStrength
> | null> {
  try {
    const cached = await cachedJson<[number, TeamStrength][] | null>(
      `natratings:${CURRENT_SEASON}`,
      STANDINGS_TTL,
      computeNationalRatings
    );
    return cached && cached.length > 0 ? new Map(cached) : null;
  } catch {
    return null;
  }
}

async function computeNationalRatings(): Promise<[number, TeamStrength][] | null> {
  const seasons = [CURRENT_SEASON - 3, CURRENT_SEASON - 2, CURRENT_SEASON - 1, CURRENT_SEASON];
  const matches: RatingMatch[] = [];

  for (const leagueId of NATIONAL_HISTORY_LEAGUE_IDS) {
    for (const season of seasons) {
      let raw: ApiFixture[] = [];
      try {
        // Dohraná sezóna se už nezmění → drž ji v cache měsíc; jen běžící se obnovuje denně.
        const ttl = season < CURRENT_SEASON ? LIST_TTL * 30 : LIST_TTL;
        raw = await cachedJson(`natfix:${leagueId}:${season}`, ttl, () =>
          fetchLeagueSeasonFixtures(leagueId, season)
        );
      } catch {
        continue; // soutěž se v té sezóně nekonala / výpadek → nezastaví ostatní
      }
      const neutral = isNeutralNationalLeague(leagueId);
      const friendly = leagueId === FRIENDLIES_LEAGUE_ID;
      for (const f of raw) {
        if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
        const ft = fullTimeGoals(f); // skóre po 90 min (turnaje mají prodloužení)
        if (!ft) continue;
        matches.push({
          date: f.fixture.date,
          homeId: f.teams.home.id,
          awayId: f.teams.away.id,
          homeGoals: ft.home,
          awayGoals: ft.away,
          neutral,
          weight: friendly ? NATIONAL_FRIENDLY_WEIGHT : 1,
        });
      }
    }
  }
  if (matches.length < RATING_MIN_MATCHES) return null;

  const home = matches.reduce((a, m) => a + m.homeGoals, 0) / matches.length;
  const away = matches.reduce((a, m) => a + m.awayGoals, 0) / matches.length;
  const table = computeRatings(matches, new Date().toISOString(), {
    ...NATIONAL_RATING_OPTIONS,
    home,
    away,
  });
  return [...table.entries()];
}

/** Vlastní výpočet sil ligy z cachovaných zápasů (bez cache vrstvy – tu řeší volající). */
async function computeLeagueRatings(
  leagueId: number
): Promise<Map<number, TeamStrength> | null> {
  {
    const baseline = await getLeagueBaseline(leagueId);
    const teams = await getTeamsByLeague(leagueId);
    if (teams.length === 0) return null;

    // JEDEN dotaz na všechny zápasy ligy; domácí a hostující řádek se spáruje podle
    // `fixtureId` v paměti (dotaz na soupeře po jednom by byl N+1).
    const since = new Date(Date.now() - RATING_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await prisma.matchStatCache.findMany({
      where: {
        teamId: { in: teams.map((t) => t.id) },
        context: "league",
        schemaVersion: CURRENT_CACHE_VERSION,
        date: { gte: since },
      },
      select: {
        teamId: true,
        fixtureId: true,
        date: true,
        isHome: true,
        goalsFor: true,
        goalsAgainst: true,
        xg: true,
        xgAgainst: true,
      },
    });

    // Domácí řádek nese skóre i xG OBOU stran (`goalsAgainst`/`xgAgainst`) → k sestavení
    // zápasu stačí; hostující řádek dodá jen id soupeře.
    const awayIdOf = new Map<number, number>();
    for (const r of rows) if (!r.isHome) awayIdOf.set(r.fixtureId, r.teamId);

    const matches: RatingMatch[] = [];
    for (const r of rows) {
      if (!r.isHome || r.goalsFor == null || r.goalsAgainst == null) continue;
      const awayId = awayIdOf.get(r.fixtureId);
      if (awayId == null || awayId === r.teamId) continue;
      matches.push({
        date: r.date.toISOString(),
        homeId: r.teamId,
        awayId,
        homeGoals: r.goalsFor,
        awayGoals: r.goalsAgainst,
        homeXg: r.xg ?? undefined,
        awayXg: r.xgAgainst ?? undefined,
      });
    }
    if (matches.length < RATING_MIN_MATCHES) return null;

    return computeRatings(matches, new Date().toISOString(), {
      ...RATING_OPTIONS,
      xgWeight: DEFAULT_TUNING.xgWeight, // stejná váha xG jako v λ (jeden zdroj pravdy)
      home: baseline?.home ?? DEFAULT_BASELINE.home,
      away: baseline?.away ?? DEFAULT_BASELINE.away,
    });
  }
}

/**
 * Celá ligová tabulka pro záložku Tabulky (FREE). Sdílí `standings:` cache (per liga,
 * TTL) s Porovnáním/Programem/Hrou → **0 API volání navíc**, když je liga zahřátá.
 * Reprezentace tabulku nemají → `null` (UI zvolí jinou ligu). Mezisezóna (0 odehraných)
 * → prázdné řádky, UI ukáže „zatím bez zápasů" (na rozdíl od Hry zde NEfallbackujeme na
 * minulou sezónu – uživatel chce vidět rozehranou aktuální tabulku, i když je prázdná).
 */
export async function getLeagueTable(leagueId: number): Promise<LeagueTable | null> {
  if (isNationalLeague(leagueId)) return null;
  const raw = await cachedLeagueStandings(leagueId);
  return { rows: normalizeLeagueTable(raw), leagueAvg: computeLeagueGoalsAvg(raw) };
}

/**
 * Reálné týmy ligy s herními ratingy útoku/obrany (herní modul „Manažer"). Odvozeno
 * z ligové tabulky (góly na zápas + home split) přes **1 cachované volání** (sdílí
 * `standings:` cache se záložkou Tabulka). Žádné drahé per-zápas fetche.
 */
export async function getLeagueGameTeams(
  leagueId: number
): Promise<{ teams: GameTeam[]; leagueAccess: LeagueAccess | null }> {
  let raw = await cachedLeagueStandings(leagueId);
  // Mezisezóna: aktuální tabulka je prázdná (0 odehraných) → ratingy by byly všechny
  // stejné (ligový průměr). Spadni na PŘEDCHOZÍ sezónu, ať mají týmy reálné síly.
  const totalPlayed = raw.reduce((s, r) => s + (r.all?.played ?? 0), 0);
  if (totalPlayed === 0) {
    const prev = await cachedLeagueStandingsFor(leagueId, PREVIOUS_SEASON).catch(
      () => [] as ApiStandingRow[]
    );
    if (prev.length) raw = prev;
  }
  const avg = computeLeagueGoalsAvg(raw);
  const teams = standingsToTeams(
    raw.map((r) => ({
      teamId: r.team.id,
      name: r.team.name,
      logo: r.team.logo,
      played: r.all?.played ?? 0,
      goalsFor: r.all?.goals?.for ?? 0,
      goalsAgainst: r.all?.goals?.against ?? 0,
      homePlayed: r.home?.played ?? 0,
      homeGoalsFor: r.home?.goals?.for ?? 0,
    })),
    avg
  );
  return { teams, leagueAccess: deriveLeagueAccess(raw) };
}

/** Syrová ligová tabulka dané sezóny přes per-liga TTL cache. */
function cachedLeagueStandingsFor(
  leagueId: number,
  season: number
): Promise<ApiStandingRow[]> {
  return cachedJson(
    `standings:${leagueId}:${season}`,
    STANDINGS_TTL,
    () => fetchLeagueStandings(leagueId, season)
  );
}

/** Syrová ligová tabulka aktuální sezóny (`standings:<liga>:<sezóna>`). */
function cachedLeagueStandings(leagueId: number): Promise<ApiStandingRow[]> {
  return cachedLeagueStandingsFor(leagueId, CURRENT_SEASON);
}

/**
 * Nejlepší střelci ligy patřící k danému týmu (FREE kontext v Porovnání). Žebříček se
 * tahá **per liga přes sdílenou cache** → jedno (cachované) volání pokryje oba týmy.
 * Reprezentace přeskočí (jiná soutěžní struktura); při nedostupnosti vrací `[]`, ne chybu.
 */
export async function getTeamTopScorers(
  teamId: number,
  leagueId: number
): Promise<Scorer[]> {
  if (isNationalLeague(leagueId)) return [];
  try {
    const raw = await cachedJson(
      `topscorers:${leagueId}:${CURRENT_SEASON}`,
      SCORERS_TTL,
      () => fetchLeagueTopScorers(leagueId, CURRENT_SEASON)
    );
    return pickTeamScorers(raw, teamId);
  } catch {
    return [];
  }
}

/**
 * Mapa `teamId → pozice` pro dané týmy (FREE kontext do seznamů Zápasy/Tipy). Reprezentace
 * přeskočí (nemají tabulku). Standings se tahá **per liga přes sdílenou cache** → jedno
 * (cachované) volání na distinktní klubovou ligu, ne per zápas. Výpadek ligy ji jen vynechá.
 */
export async function getRanks(
  teams: { id: number; leagueId: number; national: boolean }[]
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const leagueIds = [
    ...new Set(teams.filter((t) => !t.national).map((t) => t.leagueId)),
  ].filter((id) => !isNationalLeague(id));
  const byLeague = new Map<number, ApiStandingRow[]>();
  await Promise.all(
    leagueIds.map(async (id) => {
      try {
        byLeague.set(id, await cachedLeagueStandings(id));
      } catch {
        // výpadek jedné ligy nezhasne ostatní
      }
    })
  );
  for (const t of teams) {
    if (t.national) continue;
    const row = byLeague.get(t.leagueId)?.find((r) => r.team.id === t.id);
    if (row) map.set(t.id, row.rank);
  }
  return map;
}

/**
 * Reverzní mapa `teamId → konfederace` z cachovaných reprezentačních seznamů. Slouží
 * k deep-linku reprezentačních zápasů do NATIONAL módu Porovnání (tým z libovolné
 * konfederace, např. na MS). Lazy – staví se jen když jsou v rozpisu reprezentační zápasy.
 */
export async function getNationalConfedMap(): Promise<Map<number, number>> {
  return buildNationalConfedMap();
}

async function buildNationalConfedMap(): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  await Promise.all(
    NATIONAL_LEAGUES.map(async (l) => {
      try {
        const teams = await getTeamsByLeague(l.id); // cachované (natteams)
        for (const t of teams) if (!map.has(t.id)) map.set(t.id, l.id);
      } catch {
        // výpadek jedné konfederace nezhasne ostatní (méně klikacích řádků)
      }
    })
  );
  return map;
}

/**
 * Nadcházející zápasy našich lig pro zadané dny (`YYYY-MM-DD`). 1 volání `/fixtures?date=`
 * na den (přes TTL cache) → levné. Výpadek jednoho dne nezhasne ostatní (vrátí prázdno).
 * Reprezentační zápasy obohatí o konfederaci každého týmu (deep-link do NATIONAL módu).
 */
export async function getFixturesByDates(dates: string[]): Promise<FixtureDay[]> {
  const days = await Promise.all(
    dates.map(async (date) => {
      try {
        const raw = await cachedJson(`fixdate:${date}`, FIX_TTL, () =>
          fetchFixturesByDate(date)
        );
        return { date, fixtures: normalizeUpcomingFixtures(raw) };
      } catch {
        return { date, fixtures: [] };
      }
    })
  );

  // Konfederace dotahuj jen když jsou v rozpisu reprezentační zápasy (jinak 0 volání navíc).
  const hasNational = days.some((d) => d.fixtures.some((f) => f.national));
  if (!hasNational) return days;
  const confed = await buildNationalConfedMap();
  for (const day of days) {
    for (const f of day.fixtures) {
      if (!f.national) continue;
      f.homeCompareLeagueId = confed.get(f.home.id) ?? null;
      f.awayCompareLeagueId = confed.get(f.away.id) ?? null;
    }
  }
  return days;
}

/**
 * Živé skóre našich lig – 1 sdílené upstream volání za `LIVE_TTL` (nezávisle na počtu
 * uživatelů). Malý payload (živých je pár), proto krátký TTL snese klientský poll.
 * Výpadek/chyba → prázdné pole (UI se schová). Filtr na `LIVE_STATUSES` je pojistka
 * (API by mělo vrátit jen živé), `elapsed`/`goals` nesou minutu a skóre.
 */
export async function getLiveFixtures(): Promise<LiveScore[]> {
  try {
    const raw = await cachedJson("fixlive", LIVE_TTL, () =>
      fetchLiveFixtures(FIXTURE_LIST_LEAGUE_IDS)
    );
    return raw
      .filter((f) => LIVE_STATUSES.has(f.fixture.status.short))
      .map((f) => ({
        fixtureId: f.fixture.id,
        status: f.fixture.status.short,
        elapsed: f.fixture.status.elapsed ?? null,
        homeGoals: f.goals.home,
        awayGoals: f.goals.away,
      }));
  } catch {
    return [];
  }
}

// ---- Sestavení reprezentace ----

type NationalMeta = { name: string; logoUrl: string; country: string };

/**
 * Sestaví reprezentaci pro predikci **finálového turnaje** (MS/EURO/…), kde meta
 * (název/logo) nese sama fixture – tým může pocházet z libovolné konfederace, takže
 * konfederační lookup (`getTeamsByLeague`) by ho nenašel. Forma z `fetchLastFixtures`
 * (nezávislé na konfederaci). **Venue-neutrální** (turnaje na neutrální půdě → vše
 * do TOTAL, bez domácí výhody). `leagueId` = id soutěže (jen pro `Team.leagueId`).
 */
export function getCompareNationalTeamFromFixture(
  teamId: number,
  leagueId: number,
  meta: NationalMeta
): Promise<Team | null> {
  return buildNationalTeam(teamId, leagueId, meta, true);
}

/**
 * Jako výše, ale pro soutěže s **reálným domácí/venku** (Liga národů) → build s venue
 * splitem (HOME/AWAY z fixtures), aby predikce zachytila domácí výhodu přes běžnou
 * venue-specific mašinerii. (Pár turnajových zápasů v poolu na neutrální půdě dostane
 * nominální home/away – přijatelný šum proti reálné home-away historii týmu.)
 */
export function getCompareNationalHomeAwayTeamFromFixture(
  teamId: number,
  leagueId: number,
  meta: NationalMeta
): Promise<Team | null> {
  return buildNationalTeam(teamId, leagueId, meta, false);
}

async function buildNationalTeam(
  teamId: number,
  leagueId: number,
  metaOverride?: NationalMeta,
  neutral = true
): Promise<Team | null> {
  // Název + logo: buď z (cachovaného) konfederačního seznamu (běžný režim), nebo
  // přímo z fixture (predikce turnaje – tým může být z libovolné konfederace).
  let meta: NationalMeta | undefined = metaOverride;
  if (!meta) {
    const teams = await getTeamsByLeague(leagueId);
    meta = teams.find((t) => t.id === teamId);
  }
  if (!meta) return null;

  const fixtures = await cachedJson(
    `natfix:${teamId}`,
    LIST_TTL,
    () => fetchLastFixtures(teamId, NATIONAL_LAST)
  );
  const finished = onlyFinished(fixtures);

  const assembled = await assemble(teamId, "national", finished, (f) => ({
    competitive: !isFriendly(f.league.name),
    isNeutral: neutral,
  }));
  // `isNeutral` přepíšeme po načtení: kontext "national" v MatchStatCache je sdílený
  // mezi venue-neutrálním (turnaj) i home/away (Liga národů) buildem téhož týmu, takže
  // build nesmí záviset na tom, kterým režimem se cache zrovna naplnila. Venue-neutrální
  // → vše do TOTAL; home/away → HOME/AWAY z `isHome` (dopočteno v buildMatchStat).
  const leagueMatches = assembled.map((m) => ({ ...m, isNeutral: neutral }));

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
  // `/fixtures/statistics` vrací v JEDNÉ odpovědi **oba týmy**. Dřív jsme si z ní vzali
  // jen svou půlku a druhou zahodili → týž zápas se stáhl podruhé, až přišel na řadu
  // soupeř. Teď ho rovnou uložíme i jemu (kontext i příznaky zápasu jsou společné)
  // → **polovina volání pryč** (v sezóně to je nejdražší opakující se položka).
  const opponentStats = new Map<number, MatchStat[]>();

  await mapLimit(toFetch, 3, async (f) => {
    let stats: ApiFixtureStats | null = null;
    try {
      stats = await fetchFixtureStatistics(f.fixture.id);
    } catch (e) {
      // U reprezentací statistiky běžně chybí (jen tichý log pod API_DEBUG);
      // u klubů jde o výpadek/částečná data → vždy logni pro diagnostiku.
      const msg = e instanceof Error ? e.message : String(e);
      if (context !== "national") {
        console.error(`[stats-miss] fixture=${f.fixture.id} team=${teamId} ctx=${context}: ${msg}`);
      } else if (process.env.API_DEBUG) {
        console.error(`[stats-miss] fixture=${f.fixture.id} team=${teamId} ctx=national: ${msg}`);
      }
    }
    const opts = optsFor(f);
    const oppId =
      f.teams.home.id === teamId ? f.teams.away.id : f.teams.home.id;
    const mine = stats?.find((s) => s.team.id === teamId) ?? null;
    const oppStats = stats?.find((s) => s.team.id === oppId) ?? null;

    // Soupeřova půlka odpovědi dává i **inkasované xG** (`XG_AGAINST`) – kvalita obrany
    // bez šumu z proměňování. Zadarmo, protože odpověď máme celou.
    fetched.push(buildMatchStat(f, teamId, mine, oppStats, opts));
    if (oppStats) {
      const list = opponentStats.get(oppId) ?? [];
      list.push(buildMatchStat(f, oppId, oppStats, mine, opts));
      opponentStats.set(oppId, list);
    }
  });

  // Jeden dávkový zápis do cache (mimo kritickou cestu stahování).
  await saveMatchStats(teamId, context, fetched);
  // Soupeřovy řádky jsou bonus zadarmo – jejich zápis nesmí shodit porovnání.
  await Promise.all(
    [...opponentStats].map(([oppId, list]) =>
      saveMatchStats(oppId, context, list).catch(() => {})
    )
  );
  result.push(...fetched);

  return result.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Statistiky jednoho týmu z `/fixtures/statistics` → mapa metrik (`STAT_TYPE_MAP`
 * + `parseStatValue`). Čistá funkce; sdílí ji `buildMatchStat` i `npm run backfill-stats`.
 */
export function statsToMetrics(
  statsTeam: ApiFixtureStats[number] | null
): Partial<Record<Metric, number>> {
  const metrics: Partial<Record<Metric, number>> = {};
  if (!statsTeam) return metrics;
  for (const s of statsTeam.statistics) {
    const metric = STAT_TYPE_MAP[s.type];
    if (!metric) continue;
    const num = parseStatValue(s.value);
    if (num !== null) metrics[metric] = num;
  }
  return metrics;
}

function buildMatchStat(
  f: ApiFixture,
  teamId: number,
  statsTeam: ApiFixtureStats[number] | null,
  /** Statistiky soupeře z téže odpovědi – jen kvůli `XG_AGAINST` (inkasované xG). */
  statsOpponent: ApiFixtureStats[number] | null,
  opts: ReturnType<FixtureOpts>
): MatchStat {
  const isHome = f.teams.home.id === teamId;
  const gf = isHome ? f.goals.home : f.goals.away;
  const ga = isHome ? f.goals.away : f.goals.home;

  const metrics: Partial<Record<Metric, number>> = {
    ...statsToMetrics(statsTeam),
  };
  const xgAgainst = statsToMetrics(statsOpponent).XG;
  if (xgAgainst != null) metrics.XG_AGAINST = xgAgainst;
  if (gf != null) metrics.GOALS_FOR = gf;
  if (ga != null) metrics.GOALS_AGAINST = ga;

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

/**
 * Převede hodnotu statistiky z API na číslo. API posílá čísla, ale i řetězce
 * s jednotkou („65%" pro držení/přesnost přihrávek) nebo placeholdery
 * („N/A", „-", „−"). Vrací null, když hodnota není smysluplné číslo.
 */
export function parseStatValue(value: number | string | null): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = value
    .replace(/%/g, "")
    .replace(/ /g, "") // NBSP
    .replace(",", ".")
    .trim();
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

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
