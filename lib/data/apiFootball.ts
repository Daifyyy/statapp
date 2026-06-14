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
    // Historická data jsou neměnná → dlouhá revalidace (§1.1).
    next: { revalidate: 60 * 60 * 24 },
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
    status: z.object({ short: z.string() }),
    venue: z
      .object({ id: z.number().nullable(), name: z.string().nullable() })
      .partial()
      .optional(),
  }),
  league: z.object({ id: z.number(), season: z.number(), name: z.string() }),
  teams: z.object({
    home: z.object({ id: z.number() }),
    away: z.object({ id: z.number() }),
  }),
  goals: z.object({
    home: z.number().nullable(),
    away: z.number().nullable(),
  }),
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

export type ApiTeam = z.infer<typeof teamItemSchema>;
export type ApiFixture = z.infer<typeof fixtureItemSchema>;
export type ApiFixtureStats = z.infer<typeof fixtureStatsSchema>;
export type ApiInjury = z.infer<typeof injuryItemSchema>;

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

/** Posledních N zápasů týmu (napříč soutěžemi) – pro formu. */
export function fetchLastFixtures(team: number, last: number) {
  return apiGet("/fixtures", { team, last }, z.array(fixtureItemSchema));
}

/** Per-zápas statistiky (rohy, fauly, střely, xG). */
export function fetchFixtureStatistics(fixture: number) {
  return apiGet("/fixtures/statistics", { fixture }, fixtureStatsSchema);
}

/** Zranění/absence týmu v dané sezóně (pokrytí v API je nekonzistentní). */
export function fetchTeamInjuries(team: number, season: number) {
  return apiGet("/injuries", { team, season }, injuriesSchema);
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
