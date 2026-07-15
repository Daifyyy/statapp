import { z } from "zod";
import type { Metric } from "@/lib/types";
import { schedule } from "./rateLimiter";

/**
 * Klient API-Football v3 (přímé API api-sports.io, hlavička x-apisports-key).
 * Klíč drž výhradně na serveru: API_FOOTBALL_KEY v env.
 */

const BASE_URL = "https://v3.football.api-sports.io";
// Rate-limit api-sports je distribuovaný a občas odmítne i pod limitem →
// přechodná chyba, kterou vyřeší rychlý retry (trefí jiný edge node).
const MAX_RETRIES = 6;

function apiKey(): string {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("Chybí API_FOOTBALL_KEY v prostředí.");
  return key;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class RateLimitError extends Error {}

/**
 * Obecný GET. API-Football vrací obálku { errors, results, response }.
 * Prochází globálním rate-limiterem (≤300/min) a při překročení minutového
 * limitu zkouší znovu s odstupem. `response` se validuje schématem.
 */
export async function apiGet<T>(
  path: string,
  params: Record<string, string | number>,
  schema: z.ZodType<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await schedule(() => doFetch(path, params, schema));
    } catch (e) {
      if (e instanceof RateLimitError && attempt < MAX_RETRIES) {
        // Krátký odstup – další pokus zpravidla trefí jiný (volný) node.
        await sleep(250 + attempt * 350);
        continue;
      }
      throw e;
    }
  }
}

async function doFetch<T>(
  path: string,
  params: Record<string, string | number>,
  schema: z.ZodType<T>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { "x-apisports-key": apiKey() },
    // ŽÁDNÁ Next data cache. Cachovací vrstva je Postgres (`ApiCache` s TTL per
    // endpoint + trvalá `MatchStatCache`) – tenhle fetch je to, co se volá, teprve
    // když ta vrstva chce čerstvá data. Next fetch cache s pevnou revalidací tu
    // seděla NAD ní a přebíjela každý kratší TTL: `cachedJson` po hodině správně
    // sáhl pro nový denní rozpis, ale dostal 24 h starou odpověď a uložil si ji
    // s čerstvou expirací → dohraný zápas (Argentina–Švýcarsko, status AET) se
    // v Programu dál tvářil jako nadcházející. Totéž tiše potkávalo tabulky (6 h),
    // zranění (6 h) i střelce (12 h).
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API-Football ${path} HTTP ${res.status}`);
  }
  const json = await res.json();

  // API vrací 200 i při chybě klíče/limitu — chyby jsou v `errors`.
  const errors = json?.errors;
  const hasErrors =
    errors &&
    ((Array.isArray(errors) && errors.length > 0) ||
      (typeof errors === "object" && Object.keys(errors).length > 0));
  if (hasErrors) {
    const msg = JSON.stringify(errors);
    if (/rate|minute|too many/i.test(msg)) {
      console.error(
        `[ratelimit] ${path} min-remaining=${res.headers.get("x-ratelimit-remaining")}/${res.headers.get("x-ratelimit-limit")} day-remaining=${res.headers.get("x-ratelimit-requests-remaining")}`
      );
      throw new RateLimitError(`API-Football ${path}: ${msg}`);
    }
    throw new Error(`API-Football ${path}: ${msg}`);
  }
  if (process.env.API_DEBUG) {
    console.error(
      `[apicall] ${path} min-remaining=${res.headers.get("x-ratelimit-remaining")} @${new Date().toISOString().slice(11, 23)}`
    );
  }

  return schema.parse(json.response);
}

// ---- Schémata (tolerantní – jen pole, která používáme) ----

const statusSchema = z.object({
  account: z.object({ firstname: z.string().optional() }).partial().optional(),
  subscription: z
    .object({ plan: z.string().optional(), active: z.boolean().optional() })
    .partial()
    .optional(),
  requests: z
    .object({ current: z.number().optional(), limit_day: z.number().optional() })
    .partial()
    .optional(),
});

const teamItemSchema = z.object({
  team: z.object({
    id: z.number(),
    name: z.string(),
    logo: z.string(),
    national: z.boolean().optional(),
  }),
});

const fixtureItemSchema = z.object({
  fixture: z.object({
    id: z.number(),
    date: z.string(),
    status: z.object({
      short: z.string(),
      // uplynulé minuty (jen u živých zápasů; jinak null/chybí)
      elapsed: z.number().nullable().optional(),
    }),
    venue: z
      .object({ id: z.number().nullable(), name: z.string().nullable() })
      .partial()
      .optional(),
  }),
  league: z.object({ id: z.number(), season: z.number(), name: z.string() }),
  teams: z.object({
    // name/logo vrací /fixtures u obou týmů – potřebné pro meta reprezentací
    // v predikci turnaje (tým z libovolné konfederace, mimo konfederační seznam).
    home: z.object({ id: z.number(), name: z.string(), logo: z.string() }),
    away: z.object({ id: z.number(), name: z.string(), logo: z.string() }),
  }),
  // `goals` je KONCOVÉ skóre – u AET/PEN tedy včetně prodloužení. Náš model predikuje
  // 90 minut, proto settle/kalibrace berou `score.fulltime` (viz `fullTimeGoals`).
  goals: z.object({
    home: z.number().nullable(),
    away: z.number().nullable(),
  }),
  score: z
    .object({
      fulltime: z
        .object({
          home: z.number().nullable().optional(),
          away: z.number().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
});

const statItemSchema = z.object({
  type: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
});
const fixtureStatsSchema = z.array(
  z.object({
    team: z.object({ id: z.number() }),
    statistics: z.array(statItemSchema),
  })
);

const injuryItemSchema = z.object({
  player: z.object({ id: z.number(), name: z.string() }),
  type: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  fixture: z.object({ date: z.string().nullable().optional() }).optional(),
});
const injuriesSchema = z.array(injuryItemSchema);

// /standings vrací per liga+sezóna vnořené pole tabulek (běžně 1, u skupin víc).
// Bereme jen pole, která zobrazujeme: pozice, body, rozdíl skóre, forma + rozpad
// celkově/doma/venku. Tolerantní – chybějící část = ošetří se čistá funkce.
const standingSplitSchema = z.object({
  played: z.number().nullable().optional(),
  win: z.number().nullable().optional(),
  draw: z.number().nullable().optional(),
  lose: z.number().nullable().optional(),
  goals: z
    .object({
      for: z.number().nullable().optional(),
      against: z.number().nullable().optional(),
    })
    .partial()
    .optional(),
});
const standingRowSchema = z.object({
  rank: z.number(),
  team: z.object({ id: z.number(), name: z.string(), logo: z.string() }),
  points: z.number().nullable().optional(),
  goalsDiff: z.number().nullable().optional(),
  form: z.string().nullable().optional(),
  // Popis místa přímo od API-Football (např. "Promotion - Champions League (Group
  // Stage)", "Relegation - Relegation Play-offs") – zdroj pravdy pro odvození reálného
  // UEFA/sestupového klíče, viz `deriveLeagueAccess` v standings.ts.
  description: z.string().nullable().optional(),
  all: standingSplitSchema.optional(),
  home: standingSplitSchema.optional(),
  away: standingSplitSchema.optional(),
});
export type ApiStandingRow = z.infer<typeof standingRowSchema>;

// /players/topscorers vrací seřazený žebříček střelců ligy; `statistics[0]` je aktuální
// klub + góly. Tolerantní – bereme jen jméno, klub a počet gólů.
const topScorerSchema = z.object({
  player: z.object({ id: z.number(), name: z.string() }),
  statistics: z
    .array(
      z.object({
        team: z.object({ id: z.number(), name: z.string(), logo: z.string() }),
        goals: z
          .object({ total: z.number().nullable().optional() })
          .partial()
          .optional(),
      })
    )
    .default([]),
});
export type ApiTopScorer = z.infer<typeof topScorerSchema>;
const topScorersSchema = z.array(topScorerSchema);
const standingsSchema = z.array(
  z.object({
    league: z.object({
      // standings = pole tabulek (skupiny) po řádcích; sloučíme je při zpracování.
      standings: z.array(z.array(standingRowSchema)).default([]),
    }),
  })
);

// /transfers vrací per hráče pole jeho přestupů (teams.in = kam přišel, out = odkud).
// `type` je volný text (částka „€ 20M" / „Loan" / „Free" / „N/A" / null) – nespolehlivý.
const transferTeamSchema = z.object({
  id: z.number().nullable(), // protistrana může být neznámá (null)
  name: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
});
const transferPlayerSchema = z.object({
  player: z.object({ id: z.number(), name: z.string() }),
  transfers: z
    .array(
      z.object({
        date: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        teams: z
          .object({
            in: transferTeamSchema.nullable().optional(),
            out: transferTeamSchema.nullable().optional(),
          })
          .optional(),
      })
    )
    .default([]),
});
const transfersSchema = z.array(transferPlayerSchema);

// Predikce API-Footballu (interní benchmark). `percent` jsou řetězce „45%"; bereme
// jen 1X2, zbytek (goals/advice/winner) ignorujeme. Tolerantní – chybějící pole = null.
const predictionItemSchema = z.object({
  predictions: z
    .object({
      percent: z
        .object({
          home: z.string().nullable().optional(),
          draw: z.string().nullable().optional(),
          away: z.string().nullable().optional(),
        })
        .partial()
        .optional(),
    })
    .partial()
    .optional(),
});
const predictionsSchema = z.array(predictionItemSchema);

// Kurzy sázkovek (/odds). Bereme jen tři trhy: Match Winner (bet 1), Goals
// Over/Under (bet 5 → „Over 2.5"), Both Teams Score (bet 8 → „Yes"). Tolerantní –
// chybějící sázkovka/trh/hodnota = null. `odd` jsou řetězce desetinného kurzu („1.90").
const oddsValueSchema = z.object({
  value: z.string(),
  odd: z.string(),
});
const oddsBetSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  values: z.array(oddsValueSchema).default([]),
});
const oddsBookmakerSchema = z.object({
  id: z.number(),
  name: z.string(),
  bets: z.array(oddsBetSchema).default([]),
});
const oddsItemSchema = z.object({
  bookmakers: z.array(oddsBookmakerSchema).default([]),
});
const oddsSchema = z.array(oddsItemSchema);

export type ApiTeam = z.infer<typeof teamItemSchema>;
export type ApiFixture = z.infer<typeof fixtureItemSchema>;
export type ApiFixtureStats = z.infer<typeof fixtureStatsSchema>;
export type ApiInjury = z.infer<typeof injuryItemSchema>;
export type ApiTransferPlayer = z.infer<typeof transferPlayerSchema>;

// ---- Veřejné fetchery ----

/** Ověří klíč a vrátí stav účtu (plán, spotřeba kvóty). */
export function fetchStatus() {
  return apiGet("/status", {}, statusSchema);
}

/** Týmy dané ligy a sezóny. */
export function fetchLeagueTeams(league: number, season: number) {
  return apiGet("/teams", { league, season }, z.array(teamItemSchema));
}

/** Zápasy týmu v dané lize a sezóně (jen odehrané se hodí k agregaci). */
export function fetchTeamFixtures(
  team: number,
  league: number,
  season: number
) {
  return apiGet(
    "/fixtures",
    { team, league, season },
    z.array(fixtureItemSchema)
  );
}

/**
 * VŠECHNY zápasy ligy a sezóny – **1 volání na ligu+sezónu** (levné). Nese skóre, takže
 * z toho jde postavit historii pro offline backtest (`lib/picks/backtest.ts`) bez
 * per-zápasových statistik (ty stojí 1 volání za zápas → pro tisíce zápasů neúnosné).
 */
export function fetchLeagueSeasonFixtures(league: number, season: number) {
  return apiGet("/fixtures", { league, season }, z.array(fixtureItemSchema));
}

/** Posledních N zápasů týmu (napříč soutěžemi) – pro formu. */
export function fetchLastFixtures(team: number, last: number) {
  return apiGet("/fixtures", { team, last }, z.array(fixtureItemSchema));
}

/** Nejbližších N nadcházejících zápasů ligy (status NS/TBD; goals jsou null). */
export function fetchLeagueUpcomingFixtures(league: number, next: number) {
  return apiGet("/fixtures", { league, next }, z.array(fixtureItemSchema));
}

/** Zápasy dle ID (batch, max ~20 ID) – pro dotažení výsledků odehraných predikcí. */
export function fetchFixturesByIds(ids: number[]) {
  return apiGet("/fixtures", { ids: ids.join("-") }, z.array(fixtureItemSchema));
}

/**
 * Jen **živé** zápasy zadaných lig – `/fixtures?live=<id-id-…>`. Malý payload (živých je
 * v jeden okamžik pár), levné → snese krátký TTL a klientský poll. Nese `status.elapsed`
 * (minuta) i `goals` (živé skóre). Prázdné `leagueIds` → prázdný výsledek bez volání.
 */
export function fetchLiveFixtures(leagueIds: number[]) {
  if (leagueIds.length === 0) return Promise.resolve([] as ApiFixture[]);
  return apiGet(
    "/fixtures",
    { live: leagueIds.join("-") },
    z.array(fixtureItemSchema)
  );
}

/**
 * Všechny zápasy daného dne (`date` = `YYYY-MM-DD`) napříč ligami – 1 volání. `timezone`
 * zajistí správné hranice dne (jinak bere zónu účtu). Filtr na naše ligy se dělá u nás.
 */
export function fetchFixturesByDate(date: string) {
  return apiGet(
    "/fixtures",
    { date, timezone: "Europe/Prague" },
    z.array(fixtureItemSchema)
  );
}

/** Per-zápas statistiky (rohy, fauly, střely, xG). */
export function fetchFixtureStatistics(fixture: number) {
  return apiGet("/fixtures/statistics", { fixture }, fixtureStatsSchema);
}

/** „45%" → 0.45; null/„N/A"/prázdno → null. */
function parsePercent(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace("%", "").trim());
  return Number.isFinite(n) ? n / 100 : null;
}

/**
 * Predikce 1X2 od API-Footballu (interní benchmark). Vrací pravděpodobnosti
 * normalizované na součet 1, nebo `null` když API predikci nemá (časté mimo top-5)
 * či je neúplná. Mimo `compareTeams` – jen offline srovnání přesnosti.
 */
export async function fetchPrediction(
  fixture: number
): Promise<{ home: number; draw: number; away: number } | null> {
  const res = await apiGet("/predictions", { fixture }, predictionsSchema);
  const pct = res[0]?.predictions?.percent;
  if (!pct) return null;
  const home = parsePercent(pct.home);
  const draw = parsePercent(pct.draw);
  const away = parsePercent(pct.away);
  if (home == null || draw == null || away == null) return null;
  const sum = home + draw + away;
  if (sum <= 0) return null;
  return { home: home / sum, draw: draw / sum, away: away / sum };
}

/**
 * Preferované sázkovky pro referenční kurz (priorita = stabilita + široké pokrytí
 * top-5 lig). ID dle API-Football: 8 Bet365, 6 Bwin, 11 1xBet, 2 Marathonbet.
 * Není-li žádná dostupná, vezme se první vrácená.
 */
const PREFERRED_BOOKMAKERS = [8, 6, 11, 2];

/**
 * Preference pro tipovačku (ROI deník): Pinnacle (id 4) první – ostré, nízkomaržní
 * kurzy jsou nejférovější benchmark „porazil bys trh". Zbytek jako fallback.
 */
export const PINNACLE_FIRST_BOOKMAKERS = [4, 8, 6, 11, 2];

/** Referenční kurzy jednoho zápasu (decimal odds; null = trh u sázkovky chybí). */
export interface MatchOdds {
  bookmaker: string;
  home: number | null;
  draw: number | null;
  away: number | null;
  over25: number | null;
  btts: number | null;
  // Opačné strany over/under a BTTS – pro ROI deník tipovačky (0 volání navíc, jen
  // druhá hodnota z už stažené odpovědi). Predikční pipeline je nepoužívá (ukládá jen
  // Over 2.5 / BTTS Yes), proto volitelné.
  under25?: number | null;
  bttsNo?: number | null;
}

/** Desetinný kurz z hodnoty daného labelu (case-insensitive); platný jen > 1. */
function oddOf(
  values: { value: string; odd: string }[],
  label: string
): number | null {
  const v = values.find((x) => x.value.toLowerCase() === label.toLowerCase());
  const n = v ? parseFloat(v.odd) : NaN;
  return Number.isFinite(n) && n > 1 ? n : null;
}

/**
 * Referenční kurzy zápasu (1X2 + Over 2.5 + BTTS) od jedné sázkovky pro výpočet
 * EV/value tipů. Vybere preferovanou sázkovku (fallback první dostupná). Vrací `null`,
 * když API kurzy nemá (časté mimo top-5 / daleko před výkopem) nebo je řádek prázdný.
 * Stejně jako benchmark: mimo `compareTeams`, fetch 1×/zápas, jen klubové ligy.
 */
export async function fetchOdds(
  fixture: number,
  preferred: number[] = PREFERRED_BOOKMAKERS
): Promise<MatchOdds | null> {
  const res = await apiGet("/odds", { fixture }, oddsSchema);
  const books = res[0]?.bookmakers ?? [];
  if (books.length === 0) return null;
  const book =
    preferred.map((id) => books.find((b) => b.id === id)).find(
      (b): b is (typeof books)[number] => b != null
    ) ?? books[0];
  const betValues = (betId: number) =>
    book.bets.find((b) => b.id === betId)?.values ?? [];
  const mw = betValues(1);
  const goals = betValues(5);
  const btts = betValues(8);
  const out: MatchOdds = {
    bookmaker: book.name,
    home: oddOf(mw, "Home"),
    draw: oddOf(mw, "Draw"),
    away: oddOf(mw, "Away"),
    over25: oddOf(goals, "Over 2.5"),
    btts: oddOf(btts, "Yes"),
    under25: oddOf(goals, "Under 2.5"),
    bttsNo: oddOf(btts, "No"),
  };
  // Bez jediného použitelného kurzu nemá smysl řádek ukládat.
  if (out.home == null && out.over25 == null && out.btts == null) return null;
  return out;
}

/** Zranění/absence týmu v dané sezóně (pokrytí v API je nekonzistentní). */
export function fetchTeamInjuries(team: number, season: number) {
  return apiGet("/injuries", { team, season }, injuriesSchema);
}

/**
 * Ligová tabulka (`/standings?league&season`). Vrací syrové řádky napříč skupinami;
 * výběr řádku týmu + normalizaci dělá čistá funkce (`pickTeamStanding` ve `standings.ts`).
 * Reprezentační soutěže tabulku spolehlivě nemají → voláme jen pro kluby.
 */
export async function fetchLeagueStandings(
  league: number,
  season: number
): Promise<ApiStandingRow[]> {
  const res = await apiGet("/standings", { league, season }, standingsSchema);
  // Sloučí případné skupiny (běžná liga = jedna tabulka) do jednoho pole.
  return res.flatMap((l) => l.league.standings.flat());
}

/**
 * Žebříček střelců ligy (`/players/topscorers?league&season`). Výběr hráčů daného týmu
 * dělá čistá funkce (`pickTeamScorers` ve `scorers.ts`). Jen klubové ligy.
 */
export function fetchLeagueTopScorers(
  league: number,
  season: number
): Promise<ApiTopScorer[]> {
  return apiGet(
    "/players/topscorers",
    { league, season },
    topScorersSchema
  );
}

/**
 * Přestupy hráčů týmu (příchody i odchody). `/transfers` neumí filtr podle ligy ani
 * sezóny – vrací celou historii přestupů hráčů týmu, filtrovat dle data se musí u nás.
 */
export function fetchTeamTransfers(team: number) {
  return apiGet("/transfers", { team }, transfersSchema);
}

/** Mapuje názvy statistik API-Football na naše metriky. */
export const STAT_TYPE_MAP: Record<string, Metric> = {
  "Total Shots": "SHOTS",
  "Shots on Goal": "SHOTS_ON_TARGET",
  "Shots off Goal": "SHOTS_OFF_TARGET",
  "Blocked Shots": "BLOCKED_SHOTS",
  "Shots insidebox": "SHOTS_INSIDE_BOX",
  "Shots outsidebox": "SHOTS_OUTSIDE_BOX",
  "Corner Kicks": "CORNERS",
  Offsides: "OFFSIDES",
  "Ball Possession": "POSSESSION", // string "65%"
  Fouls: "FOULS",
  "Yellow Cards": "YELLOW_CARDS",
  "Red Cards": "RED_CARDS",
  "Goalkeeper Saves": "SAVES",
  "Total passes": "PASSES_TOTAL",
  "Passes accurate": "PASSES_ACCURATE",
  "Passes %": "PASS_ACCURACY", // string "87%"
  expected_goals: "XG",
};

/** Stav „odehráno" pro API-Football (full time / after ET / penalties). */
export const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

/**
 * Stavy, kdy zápas **právě běží** (1./2. poločas, poločasová pauza, prodloužení, penalty,
 * přerušení). Živý zápas z Programu nemizí – svítí s minutou a skóre.
 */
export const LIVE_STATUSES = new Set([
  "1H", // první poločas
  "HT", // poločasová přestávka
  "2H", // druhý poločas
  "ET", // prodloužení
  "BT", // přestávka před prodloužením
  "P", // penaltový rozstřel
  "SUSP", // dočasně pozastaveno
  "INT", // přerušeno
  "LIVE", // obecně živě
]);
