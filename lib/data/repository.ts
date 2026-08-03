import type {
  ClubTransferBalance,
  FixtureDay,
  Injury,
  League,
  LeagueGoalsAvg,
  LeagueRound,
  LeagueScorer,
  LeagueTable,
  LeagueTableRow,
  LiveScore,
  MatchPick,
  PredictionRow,
  Scorer,
  SettledMatch,
  Standing,
  Team,
  Transfer,
} from "@/lib/types";
import type { Metric } from "@/lib/types";
import { buildMatchReport, type MatchReport } from "@/lib/stats/matchReport";
import type { MatchEvent } from "@/lib/stats/matchEvents";
import { buildLiveReport, type LiveReport } from "@/lib/stats/liveReport";
import type { LeagueBaseline } from "@/lib/stats/predict";
import type { TeamStrength } from "@/lib/stats/ratings";
import { isRealDataConfigured } from "@/lib/db";
import { generateLeague } from "@/lib/game/teams";
import type { GameTeam, LeagueAccess } from "@/lib/game/types";
import { LEAGUES, buildTeams } from "./mock/seed";
import { mockUpcomingPredictions, mockSettledPredictions } from "./mock/predictions";
import { mockFixturesByDates, MOCK_LIVE } from "./mock/fixtures";
import { mockLeagueTransfers, mockClubBalances } from "./mock/transfers";
import {
  getUpcomingPredictionRows,
  getSettledPredictions,
  getRecentSettledPredictions,
  getPredictionByFixture,
} from "./predictionStore";
import { MODEL_VERSION } from "./modelVersion";
import { summarizeSettled } from "@/lib/picks/results";
import {
  buildMatchReview,
  type ActualCounts,
  type MatchReview,
} from "@/lib/picks/matchReview";
import { logError } from "@/lib/logError";
import { getLeagueTransfers, getClubBalances } from "./transferStore";
import {
  ALL_NATIONAL_PREDICTION_LEAGUE_IDS,
  PROGRAM_CLUB_LEAGUE_IDS,
  isProgramClubLeague,
} from "./catalog";
import * as real from "./realRepository";

/**
 * Datová vrstva aplikace. Při nakonfigurovaném API klíči + DB čte reálná data
 * z API-Football přes read-through cache (Postgres); jinak běží na mock datech.
 * Výpočetní jádro (lib/stats) je na zdroji nezávislé.
 */

type TeamLite = Pick<Team, "id" | "name" | "logoUrl" | "country" | "entityType">;

const useReal = isRealDataConfigured();

export function getLeagues(): League[] {
  return useReal ? real.getLeagues() : LEAGUES;
}

// ---- Mock fallback ----

let mockTeams: Team[] | null = null;
function allMockTeams(): Team[] {
  if (!mockTeams) mockTeams = buildTeams();
  return mockTeams;
}

export async function getTeamsByLeague(
  leagueId: number
): Promise<TeamLite[]> {
  if (useReal) return real.getTeamsByLeague(leagueId);
  return allMockTeams()
    .filter((t) => t.leagueId === leagueId)
    .map(({ id, name, logoUrl, country, entityType }) => ({
      id,
      name,
      logoUrl,
      country,
      entityType,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export async function getCompareTeam(
  teamId: number,
  leagueId: number,
  includeEuro = false,
  meta?: real.ClubMeta
): Promise<Team | null> {
  if (useReal) return real.getCompareTeam(teamId, leagueId, includeEuro, meta);
  return allMockTeams().find((t) => t.id === teamId) ?? null;
}

/** Nadcházející zápasy našich lig na zadané dny (real = API+cache, mock = generátor). */
export async function getFixturesByDates(dates: string[]): Promise<FixtureDay[]> {
  const days = useReal
    ? await real.getFixturesByDates(dates)
    : mockFixturesByDates(dates);
  await enrichFixtureRanks(days);
  return days;
}

/**
 * Živé skóre našich lig (real = sdílené API+cache; mock = pevná sada `MOCK_LIVE`).
 * Mock schválně **není prázdný**: bez něj se živý režim v `npm run dev` nedá zobrazit
 * a mimo zápasové okno by se na něm nedalo nic ověřit.
 */
export async function getLiveFixtures(): Promise<LiveScore[]> {
  if (useReal) return real.getLiveFixtures();
  return MOCK_LIVE.map((l) => ({
    fixtureId: l.fixtureId,
    status: l.status,
    elapsed: l.elapsed,
    homeGoals: l.homeGoals,
    awayGoals: l.awayGoals,
    halftimeHome: l.halftimeHome,
    halftimeAway: l.halftimeAway,
  }));
}

/**
 * **Přehled probíhajícího zápasu.** Stejná dělba jako u `getMatchReport`: repozitář dodá
 * data, čisté jádro (`buildLiveReport`) rozhoduje. Vrací i `reason`, aby UI umělo rozlišit
 * „ještě je brzy" od „statistiky nedorazily" – a aby se tiché selhání parsování nedalo
 * splést s legitimně chybějícími daty.
 */
export async function getLiveMatchReport(input: {
  fixtureId: number;
  home: { id: number; name: string };
  away: { id: number; name: string };
  goals: { home: number; away: number } | null;
  elapsed: number | null;
  status: string;
  halftime?: { home: number; away: number } | null;
}): Promise<{
  report: LiveReport | null;
  reason: string | null;
  events: MatchEvent[];
}> {
  // Statistiky a průběh jedou paralelně a **oba pod týmž denním rozpočtem**
  // (`tryConsumeLiveStats`), takže poll otevřeného panelu nemůže vyžrat kvótu.
  const [stats, events] = await Promise.all([
    useReal
      ? real.getLiveMatchStatsPair(
          input.fixtureId,
          input.home.id,
          input.away.id,
          input.status,
          input.elapsed
        )
      : Promise.resolve({
          ok: true,
          ...mockLiveMatchStats(input.fixtureId, input.elapsed),
        } as const),
    useReal
      ? real.getMatchEvents(input.fixtureId, true, input.status, input.elapsed)
      : Promise.resolve(mockLiveMatchEvents(input.fixtureId, input.elapsed)),
  ]);

  // Průběh přežije i výpadek statistik: „padl gól v 12. minutě" je použitelná informace
  // sama o sobě a nemá důvod mizet jen proto, že nedorazily střely a držení.
  const timeline = events ?? [];
  if (!stats.ok) return { report: null, reason: stats.reason, events: timeline };

  const report = buildLiveReport({
    home: stats.home,
    away: stats.away,
    teams: { home: input.home.name, away: input.away.name },
    goals: input.goals,
    elapsed: input.elapsed,
    status: input.status,
    halftime: input.halftime ?? null,
  });
  return { report, reason: report.reason, events: timeline };
}

/**
 * Mock průběhu běžícího zápasu: události dohraného zápasu **oříznuté uplynulou minutou**
 * (stejný princip jako `mockLiveMatchStats`). Bez toho by v mock režimu časová osa buď
 * chyběla, nebo by ve 12. minutě ukazovala gól z 80. – a to by se odladit nedalo.
 */
function mockLiveMatchEvents(fixtureId: number, elapsed: number | null): MatchEvent[] {
  const minute = elapsed ?? 0;
  return mockMatchEvents(fixtureId).filter((e) => e.minute <= minute);
}

/**
 * Mock živých statistik: tytéž deterministické hodnoty jako u dohraného zápasu, jen
 * **zkrácené poměrem odehraného času**. Díky tomu se dá offline proklikat i to, jak se
 * přehled v čase mění (ve 12. minutě mlčí, v 72. mluví).
 */
function mockLiveMatchStats(
  fixtureId: number,
  elapsed: number | null
): { home: Partial<Record<Metric, number>>; away: Partial<Record<Metric, number>> } {
  const full = mockMatchStats(fixtureId);
  const share = Math.min(1, Math.max(0, (elapsed ?? 0) / 90));
  // Držení je podíl, ne objem – to se časem nekrátí.
  const scale = (side: Partial<Record<Metric, number>>) => {
    const out: Partial<Record<Metric, number>> = {};
    for (const [k, v] of Object.entries(side) as [Metric, number][]) {
      out[k] = k === "POSSESSION" ? v : k === "XG" ? Number((v * share).toFixed(2)) : Math.round(v * share);
    }
    return out;
  };
  return { home: scale(full.home), away: scale(full.away) };
}

/** Doplní klubovým zápasům pozici obou týmů v tabulce (FREE kontext; reprezentace přeskočí). */
async function enrichFixtureRanks(days: FixtureDay[]): Promise<void> {
  const teams = days.flatMap((d) =>
    d.fixtures
      .filter((f) => !f.national)
      .flatMap((f) => [
        { id: f.home.id, leagueId: f.leagueId, national: false },
        { id: f.away.id, leagueId: f.leagueId, national: false },
      ])
  );
  if (teams.length === 0) return;
  const ranks = await getRanks(teams);
  for (const d of days) {
    for (const f of d.fixtures) {
      if (f.national) continue;
      f.homeRank = ranks.get(f.home.id) ?? null;
      f.awayRank = ranks.get(f.away.id) ?? null;
    }
  }
}

/**
 * Mapa `teamId → pozice v tabulce` pro dané týmy (real = API+cache per liga; mock =
 * deterministický řádek). Reprezentace se přeskočí (nemají tabulku).
 */
export async function getRanks(
  teams: { id: number; leagueId: number; national: boolean }[]
): Promise<Map<number, number>> {
  if (useReal) return real.getRanks(teams);
  const map = new Map<number, number>();
  for (const t of teams) {
    if (t.national) continue;
    const s = mockStanding(t.id);
    if (s) map.set(t.id, s.rank);
  }
  return map;
}

/**
 * Doplní klubovým tipům pozici obou týmů v tabulce (FREE kontext do `PickRow`).
 * Reprezentační tipy nechá být (nemají tabulku). Sdílí `/api/picks` i `/api/digest`.
 */
export async function stampPickRanks(picks: MatchPick[]): Promise<MatchPick[]> {
  const teams = picks
    .filter((p) => p.compareMode === "CLUB")
    .flatMap((p) => [
      { id: p.home.id, leagueId: p.leagueId, national: false },
      { id: p.away.id, leagueId: p.leagueId, national: false },
    ]);
  if (teams.length === 0) return picks;
  const ranks = await getRanks(teams);
  return picks.map((p) =>
    p.compareMode === "CLUB"
      ? {
          ...p,
          homeRank: ranks.get(p.home.id) ?? null,
          awayRank: ranks.get(p.away.id) ?? null,
        }
      : p
  );
}

/** Nadcházející predikce pro záložku (real = DB store, mock = generátor). */
export async function getUpcomingPredictions(): Promise<PredictionRow[]> {
  if (useReal) return getUpcomingPredictionRows();
  return mockUpcomingPredictions();
}

/**
 * Reverzní mapa `teamId → konfederace` pro deep-link reprezentačních řádků
 * (Tipy/Výsledky → NATIONAL Porovnání). Real = z cachovaných reprezentačních
 * seznamů; mock = prázdná (národní mock řádky zůstanou neklikací, bez pádu).
 */
export async function getNationalConfedMap(): Promise<Map<number, number>> {
  if (useReal) return real.getNationalConfedMap();
  return new Map();
}

/**
 * Odehrané predikce s výsledkem pro track-record (real = DB, mock = generátor).
 *
 * **Filtruje na aktuální `MODEL_VERSION`, a to defaultně.** Bump verze vynuluje dataset
 * (stará λ vznikla jiným výpočtem, takže se nedá srovnávat) – tenhle invariant respektuje
 * `npm run calibrate` odjakživa, ale cesta do UI ne: volalo se `getSettledPredictions()`
 * bez argumentu, takže track-record, kalibrace, benchmark i CLV na `/predikce` počítaly
 * z **69 řádků, ze kterých bylo 62 z verze 1** a jen 7 z aktuální. Čísla tedy neměřila
 * model, který běží.
 *
 * Verze je **parametr s defaultem**, ne volitelný filtr, který si volající zapne:
 * volitelnost je přesně to, co tuhle chybu umožnilo. Přepsat ho má smysl jen tam, kde
 * někdo vědomě zkoumá historickou verzi.
 */
export async function getSettledPredictionRows(
  modelVersion: number = MODEL_VERSION
): Promise<PredictionRow[]> {
  if (useReal) return getSettledPredictions(modelVersion);
  return mockSettledPredictions();
}

/**
 * Nedávno dohrané zápasy s vyhodnocenou predikcí – **překryv „náš tip" pro záložku
 * „Výsledky"**. Real = posledních `days` dní z DB + dohledání konfederací pro
 * reprezentační deep-link; mock = generátor. FREE (jen historie, žádný budoucí tip).
 *
 * **Tohle už není zdroj samotného seznamu Výsledků** – ten staví denní rozpis
 * (`getFixturesByDates` → `PlayedFixture`), takže zápas se zobrazí i bez predikce a hned
 * po dohrání, ne až po nočním settle. Odtud jde jen odznak ✓/✗ a „Tip: …", který
 * `mergeTips` napáruje po `fixtureId`.
 *
 * **Filtruje klubové ligy na `isProgramClubLeague`** (Top 8 + ČR) – `PREDICTION_LEAGUES`
 * (odkud řádky pocházejí) běží nad všemi 18 `CLUB_LEAGUES`, ale Výsledky mají zrcadlit
 * jen to, co appka nabízí v Programu (jinak by tam prosakovaly ligy, které Program
 * vůbec neukazuje – nekonzistentní řádek bez odpovídajícího zápasu v Programu).
 * Reprezentace filtr neřeší (jiný seznam, `ALL_NATIONAL_PREDICTION_LEAGUE_IDS`).
 *
 * Filtr jde **do dotazu** (`leagueIds`), ne až nad načtenými řádky – limit v DB by jinak
 * padl na nejnovější zápasy napříč všemi 18 ligami a ve dnech menších lig by ze záložky
 * zbylo pár řádků. Filtr níže zůstává jako pojistka (a kvůli mock větvi).
 *
 * `days` musí pokrýt celé okno, které Výsledky ukazují, a `limit` **počet zápasů v tom
 * okně, ne velikost stránky** – překryv se nestránkuje a chybějící řádek se v UI projeví
 * jako „u tohohle zápasu jsme netipovali", což je tiché a nepravdivé.
 */
export async function getRecentResults(days = 4): Promise<SettledMatch[]> {
  const rows = useReal
    ? await getRecentSettledPredictions({
        days,
        limit: 400,
        leagueIds: [
          ...PROGRAM_CLUB_LEAGUE_IDS,
          ...ALL_NATIONAL_PREDICTION_LEAGUE_IDS,
        ],
      })
    : mockSettledPredictions();
  const matches = summarizeSettled(rows).filter(
    (m) => m.compareMode === "NATIONAL" || isProgramClubLeague(m.leagueId)
  );

  // Reprezentačním řádkům dohledej konfederaci každého týmu (deep-link do NATIONAL).
  if (useReal && matches.some((m) => m.compareMode === "NATIONAL")) {
    const confed = await real.getNationalConfedMap();
    for (const m of matches) {
      if (m.compareMode !== "NATIONAL") continue;
      m.homeCompareLeagueId = confed.get(m.home.id) ?? null;
      m.awayCompareLeagueId = confed.get(m.away.id) ?? null;
    }
  }
  return matches;
}

/** Aktuální přestupy vybraných lig (real = DB store, mock = generátor). */
export async function getTransfers(
  leagueIds: number[],
  limit = 200
): Promise<Transfer[]> {
  if (useReal) return getLeagueTransfers(leagueIds, limit);
  return mockLeagueTransfers(leagueIds);
}

/** Bilance přestupů klubů vybraných lig (real = DB agregace, mock = generátor). */
export async function getTransferBalances(
  leagueIds: number[]
): Promise<ClubTransferBalance[]> {
  if (useReal) return getClubBalances(leagueIds);
  return mockClubBalances(leagueIds);
}

/**
 * Postavení týmu v ligové tabulce (FREE kontext). Real = API+cache (per liga);
 * mock = deterministický řádek dle teamId, ať jde UI zkoušet bez DB/API.
 * Reprezentace tabulku nemají → null (UI sekci skryje).
 */
export async function getStanding(
  teamId: number,
  leagueId: number
): Promise<{ standing: Standing | null; leagueAvg: LeagueGoalsAvg | null }> {
  if (useReal) return real.getLeagueStanding(teamId, leagueId);
  return { standing: mockStanding(teamId), leagueAvg: mockLeagueGoalsAvg() };
}

function mockLeagueGoalsAvg(): LeagueGoalsAvg {
  return { goalsFor: 1.35, goalsAgainst: 1.35 };
}

/**
 * Ligové měřítko pro λ (⌀ góly domácích/hostů). Real = z cachované tabulky (0 API navíc);
 * mock/reprezentace/mezisezóna → `null` = predikce sáhne po typickém defaultu.
 */
export async function getLeagueBaseline(
  leagueId: number
): Promise<LeagueBaseline | null> {
  if (useReal) return real.getLeagueBaseline(leagueId);
  return null;
}

/**
 * Síly týmů ligy s korekcí na soupeře a časovým útlumem (C2) – z už cachovaných zápasů,
 * **0 volání API**. `null` (mock, reprezentace, studená cache) → predikce použije okenní model.
 */
export async function getLeagueRatings(
  leagueId: number
): Promise<Map<number, TeamStrength> | null> {
  if (useReal) return real.getLeagueRatings(leagueId);
  return null;
}

/**
 * Globální ratingy reprezentací (jeden pool všech národů) – opravují srovnávání sil
 * napříč konfederacemi. `null` v mocku / při výpadku → padne se na okenní model.
 */
export async function getNationalRatings(): Promise<Map<
  number,
  TeamStrength
> | null> {
  if (useReal) return real.getNationalRatings();
  return null;
}

/**
 * **Kategorický přehled odehraného zápasu** (kdo dominoval, typ zápasu, jak kdo zahrál)
 * plus **model a trh vs. skutečnost**, pokud k zápasu máme uloženou predikci.
 *
 * Líný a na vyžádání: statistiky se tahají až při rozkliknutí (`getMatchStatsPair`,
 * 1 volání na zápas, pak trvale z `MatchStatCache`). Samotné vyhodnocení jsou čisté
 * funkce (`buildMatchReport`, `buildMatchReview`) – tedy stejná dělba jako všude jinde:
 * repozitář dodá data, jádro rozhoduje.
 *
 * **Obě části jsou nezávislé.** `report: null` = nemáme statistiky (API je u části zápasů
 * nemá); `review: null` = k zápasu nemáme predikci (cron nemusel ligu stihnout) nebo
 * neznáme skóre. Ani jedno není chyba a jedno nesmí shodit druhé – zápas bez predikce má
 * pořád smysl ukázat a zápas bez statistik pořád nese „řekli jsme 2:1, padlo 0:4".
 *
 * Predikční řádek je **jeden dotaz do DB, 0 volání API**; ceny za něj se neplatí v kvótě.
 */
export async function getMatchReport(input: {
  fixtureId: number;
  home: { id: number; name: string };
  away: { id: number; name: string };
  goals: { home: number; away: number } | null;
}): Promise<{
  report: MatchReport | null;
  review: MatchReview | null;
  events: MatchEvent[];
}> {
  // Statistiky a průběh jsou dvě nezávislá volání – paralelně, ať se doba načtení
  // panelu nesečte. Dohraný zápas se navíc nemění, takže obojí jde z dlouhé cache.
  const [stats, events] = await Promise.all([
    useReal
      ? real.getMatchStatsPair(input.fixtureId, input.home.id, input.away.id)
      : Promise.resolve(mockMatchStats(input.fixtureId)),
    useReal
      ? real.getMatchEvents(input.fixtureId, false)
      : Promise.resolve(mockMatchEvents(input.fixtureId)),
  ]);

  let report: MatchReport | null = null;
  if (stats) {
    const built = buildMatchReport(
      stats.home,
      stats.away,
      { home: input.home.name, away: input.away.name },
      input.goals
    );
    report = built.available ? built : null;
  }

  return {
    report,
    review: await matchReviewOf(input.fixtureId, input.goals, stats),
    events: events ?? [],
  };
}

/**
 * „Model a trh vs. skutečnost" k jednomu zápasu. Skutečné rohy a karty bere z **týchž**
 * statistik, které si přehled hry stáhl – žádné volání navíc. Výpadek DB nesmí shodit
 * přehled hry, ale nesmí ani mlčet (viz rok bez kurzů).
 */
async function matchReviewOf(
  fixtureId: number,
  goals: { home: number; away: number } | null,
  stats: { home: Partial<Record<Metric, number>>; away: Partial<Record<Metric, number>> } | null
): Promise<MatchReview | null> {
  if (!useReal || !goals) return null;
  try {
    const row = await getPredictionByFixture(fixtureId);
    if (!row) return null;
    return buildMatchReview(row, goals, actualCountsOf(stats));
  } catch (e) {
    logError("repository.getMatchReport.review", e, { fixtureId });
    return null;
  }
}

/** Skutečné rohy a karty ze statistik zápasu; `null` u metriky, kterou zápas nemá. */
function actualCountsOf(
  stats: { home: Partial<Record<Metric, number>>; away: Partial<Record<Metric, number>> } | null
): ActualCounts {
  if (!stats) return { corners: null, cards: null };
  const pair = (metric: Metric) => {
    const h = stats.home[metric];
    const a = stats.away[metric];
    return h != null && a != null ? { home: h, away: a } : null;
  };
  const corners = pair("CORNERS");
  // Karty = žluté + červené, shodně s tím, co modeluje `predictCards` (`cardCount`).
  // Červené můžou v zápase chybět úplně → chybějící hodnota je nula, ne „neznámo“;
  // u žlutých to naopak znamená, že statistiku nemáme vůbec.
  const hy = stats.home.YELLOW_CARDS;
  const ay = stats.away.YELLOW_CARDS;
  const cards =
    hy != null && ay != null
      ? {
          home: hy + (stats.home.RED_CARDS ?? 0),
          away: ay + (stats.away.RED_CARDS ?? 0),
        }
      : null;
  return { corners, cards };
}

/**
 * Deterministický mock průběhu zápasu. Bez něj by v `npm run dev` (mock režim) byla
 * časová osa vždycky prázdná a nedalo by se na ní nic odladit – přesně jako u
 * `mockLiveMatchStats`, které existuje ze stejného důvodu.
 *
 * Týmy jsou označené `0`/`1`; volající je páruje podle pořadí, ne podle skutečných id
 * (mock je nezná).
 */
function mockMatchEvents(fixtureId: number): MatchEvent[] {
  const r = (n: number, lo: number, hi: number) =>
    lo + (((fixtureId * 7919 + n * 104729) % 233280) / 233280) * (hi - lo);
  const events: MatchEvent[] = [
    {
      minute: Math.round(r(1, 5, 40)),
      extra: null,
      kind: "goal",
      teamId: 0,
      player: "M. Novák",
      assist: "P. Dvořák",
    },
    {
      minute: Math.round(r(2, 35, 60)),
      extra: null,
      kind: "yellow",
      teamId: 1,
      player: "J. Svoboda",
      assist: null,
    },
    {
      minute: Math.round(r(3, 55, 75)),
      extra: null,
      kind: "sub",
      teamId: 0,
      player: "T. Černý",
      assist: "L. Procházka",
    },
    {
      minute: Math.round(r(4, 70, 90)),
      extra: null,
      kind: "goal",
      teamId: 1,
      player: "R. Veselý",
      assist: null,
    },
  ];
  return events.sort((a, b) => a.minute - b.minute);
}

/**
 * Deterministické mock statistiky odvozené z `fixtureId` – přehled tak funguje bez DB
 * i bez API a jde na něm ladit UI (různá `fixtureId` dají různě vypadající zápasy).
 */
function mockMatchStats(fixtureId: number): {
  home: Partial<Record<Metric, number>>;
  away: Partial<Record<Metric, number>>;
} {
  const r = (n: number, lo: number, hi: number) =>
    lo + (((fixtureId * 9301 + n * 49297) % 233280) / 233280) * (hi - lo);
  const possession = Math.round(r(1, 38, 62));
  return {
    home: {
      POSSESSION: possession,
      XG: Number(r(2, 0.4, 2.6).toFixed(2)),
      SHOTS_ON_TARGET: Math.round(r(3, 1, 9)),
      SHOTS_INSIDE_BOX: Math.round(r(4, 3, 14)),
      FOULS: Math.round(r(5, 7, 18)),
      YELLOW_CARDS: Math.round(r(6, 0, 4)),
      RED_CARDS: r(7, 0, 12) > 11.5 ? 1 : 0,
      SAVES: Math.round(r(8, 1, 7)),
    },
    away: {
      POSSESSION: 100 - possession,
      XG: Number(r(9, 0.4, 2.6).toFixed(2)),
      SHOTS_ON_TARGET: Math.round(r(10, 1, 9)),
      SHOTS_INSIDE_BOX: Math.round(r(11, 3, 14)),
      FOULS: Math.round(r(12, 7, 18)),
      YELLOW_CARDS: Math.round(r(13, 0, 4)),
      RED_CARDS: 0,
      SAVES: Math.round(r(14, 1, 7)),
    },
  };
}

/**
 * Celá ligová tabulka pro záložku Tabulky. Real = sdílená `standings:` cache
 * (0 API navíc); mock = deterministická tabulka z mock týmů ligy (offline).
 * Reprezentace tabulku nemají → `null`.
 */
export async function getLeagueTable(leagueId: number): Promise<LeagueTable | null> {
  if (useReal) return real.getLeagueTable(leagueId);
  return mockLeagueTable(leagueId);
}

function mockLeagueTable(leagueId: number): LeagueTable | null {
  const teams = allMockTeams().filter(
    (t) => t.leagueId === leagueId && t.entityType !== "NATIONAL"
  );
  if (teams.length === 0) return null;
  const rows: LeagueTableRow[] = teams
    .map((t, i) => {
      const rank = i + 1;
      const wins = Math.max(0, teams.length - rank);
      const losses = Math.max(0, rank - 1);
      const draws = 5;
      const played = wins + draws + losses;
      const goalsFor = 45 - rank;
      const goalsAgainst = 12 + rank;
      const zone =
        rank <= 2
          ? ("champions" as const)
          : rank === 3
            ? ("europa" as const)
            : rank > teams.length - 2
              ? ("relegation" as const)
              : null;
      return {
        rank,
        teamId: t.id,
        name: t.name,
        logoUrl: t.logoUrl,
        played,
        win: wins,
        draw: draws,
        lose: losses,
        goalsFor,
        goalsAgainst,
        goalsDiff: goalsFor - goalsAgainst,
        points: wins * 3 + draws,
        form: "WWDLW",
        zone,
      };
    })
    .sort((a, b) => a.rank - b.rank);
  return { rows, leagueAvg: mockLeagueGoalsAvg() };
}

/**
 * Týmy ligy s herními ratingy pro modul „Manažer". Reálně z ligové tabulky
 * (1 cachované volání); v mocku fiktivní liga (offline, bez DB/API).
 */
export async function getGameLeague(
  leagueId: number
): Promise<{ teams: GameTeam[]; leagueAccess: LeagueAccess | null }> {
  if (useReal) return real.getLeagueGameTeams(leagueId);
  return { teams: generateLeague(12345), leagueAccess: null };
}

function mockStanding(teamId: number): Standing | null {
  const team = allMockTeams().find((t) => t.id === teamId);
  if (!team || team.entityType === "NATIONAL") return null;
  const rank = (teamId % 18) + 1;
  const wins = 20 - rank;
  const losses = rank - 1;
  const draws = 6;
  const played = wins + draws + losses;
  const gf = 40 - rank;
  const ga = 10 + rank;
  const half = (n: number) => Math.round(n / 2);
  return {
    rank,
    points: wins * 3 + draws,
    goalsDiff: gf - ga,
    form: ["W", "W", "D", "L", "W"].slice(0, 5).join(""),
    all: { played, win: wins, draw: draws, lose: losses, goalsFor: gf, goalsAgainst: ga },
    home: {
      played: half(played),
      win: half(wins),
      draw: half(draws),
      lose: half(losses),
      goalsFor: half(gf),
      goalsAgainst: half(ga),
    },
    away: {
      played: played - half(played),
      win: wins - half(wins),
      draw: draws - half(draws),
      lose: losses - half(losses),
      goalsFor: gf - half(gf),
      goalsAgainst: ga - half(ga),
    },
  };
}

/**
 * Nejlepší střelci ligy patřící k týmu (FREE kontext). Real = API+cache per liga;
 * mock = deterministických 0–2 hráčů dle teamId. Reprezentace → prázdné.
 */
export async function getTopScorers(
  teamId: number,
  leagueId: number
): Promise<Scorer[]> {
  if (useReal) return real.getTeamTopScorers(teamId, leagueId);
  const team = allMockTeams().find((t) => t.id === teamId);
  if (!team || team.entityType === "NATIONAL") return [];
  const count = teamId % 3; // 0–2 střelci
  return Array.from({ length: count }, (_, i) => ({
    playerId: teamId * 1000 + i,
    name: `Střelec #${i + 1}`,
    goals: 15 - i * 4 - (teamId % 3),
  }));
}

function mockLeagueClubTeams(leagueId: number): Team[] {
  return allMockTeams().filter(
    (t) => t.leagueId === leagueId && t.entityType !== "NATIONAL"
  );
}

/** Nejlepší střelci CELÉ ligy (Tabulky). Real = sdílená cache; mock = deterministický žebříček. */
export async function getLeagueScorers(
  leagueId: number,
  limit = 10
): Promise<LeagueScorer[]> {
  if (useReal) return real.getLeagueScorers(leagueId, limit);
  return mockLeagueClubTeams(leagueId)
    .slice(0, limit)
    .map((t, i) => ({
      playerId: t.id * 1000,
      name: `Střelec ${t.name}`,
      value: 20 - i * 2,
      teamId: t.id,
      teamName: t.name,
      teamLogo: t.logoUrl,
    }));
}

/** Nejlepší nahrávači CELÉ ligy (Tabulky). Real = API+cache; mock = deterministický žebříček. */
export async function getLeagueAssists(
  leagueId: number,
  limit = 10
): Promise<LeagueScorer[]> {
  if (useReal) return real.getLeagueAssists(leagueId, limit);
  return mockLeagueClubTeams(leagueId)
    .slice(0, limit)
    .map((t, i) => ({
      playerId: t.id * 1000 + 1,
      name: `Nahrávač ${t.name}`,
      value: 15 - i * 2,
      teamId: t.id,
      teamName: t.name,
      teamLogo: t.logoUrl,
    }));
}

/** Poslední + příští kolo vybrané ligy (Tabulky). Real = API+cache; mock = pár fiktivních dvojic. */
export async function getLeagueRound(leagueId: number): Promise<LeagueRound | null> {
  if (useReal) return real.getLeagueRound(leagueId);
  const teams = mockLeagueClubTeams(leagueId);
  if (teams.length < 4) return null;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const pair = (
    a: Team,
    b: Team,
    offsetDays: number,
    played: boolean
  ) => ({
    fixtureId: a.id * 100000 + b.id,
    kickoff: new Date(now + offsetDays * day).toISOString(),
    home: { id: a.id, name: a.name, logoUrl: a.logoUrl },
    away: { id: b.id, name: b.name, logoUrl: b.logoUrl },
    homeGoals: played ? 2 : null,
    awayGoals: played ? 1 : null,
  });
  return {
    last: [pair(teams[0], teams[1], -7, true), pair(teams[2], teams[3], -7, true)],
    next: [pair(teams[1], teams[0], 7, false), pair(teams[3], teams[2], 7, false)],
  };
}

const MOCK_INJURY_REASONS = [
  "Zranění kolene",
  "Natažený sval",
  "Trest za karty",
  "Zranění kotníku",
  "Nemoc",
];

/** Aktuálně zranění/absentující hráči (líně načítané, mimo zápasové statistiky). */
export async function getInjuries(
  teamId: number,
  leagueId: number
): Promise<Injury[]> {
  if (useReal) return real.getTeamInjuries(teamId, leagueId);
  // Deterministický mock (0–3 položky dle teamId), ať jde UI zkoušet bez API.
  const count = teamId % 4;
  return Array.from({ length: count }, (_, i) => {
    const pid = teamId * 100 + i;
    return {
      playerId: pid,
      name: `Hráč #${i + 1}`,
      reason: MOCK_INJURY_REASONS[(teamId + i) % MOCK_INJURY_REASONS.length],
    };
  });
}
