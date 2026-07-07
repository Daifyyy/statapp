import type { LeagueGoalsAvg, Standing, StandingSplit } from "@/lib/types";
import type { EuropeSpot, LeagueAccess } from "@/lib/game/types";
import type { ApiStandingRow } from "./apiFootball";

/**
 * Vybere řádek daného týmu z hrubé ligové tabulky a normalizuje ho na {@link Standing}.
 * - Chybí-li tým v tabulce (nováček mimo tabulku / jiná soutěž) → `null` (UI sekci skryje).
 * - Chybějící číselná pole se doplní na 0 (tolerantní vůči neúplné odpovědi API).
 * Čistá funkce (kvůli testu) – jako `selectCurrentInjuries` v `injuries.ts`.
 */
export function pickTeamStanding(
  raw: ApiStandingRow[],
  teamId: number
): Standing | null {
  const row = raw.find((r) => r.team.id === teamId);
  if (!row) return null;
  return {
    rank: row.rank,
    points: row.points ?? 0,
    goalsDiff: row.goalsDiff ?? 0,
    form: row.form ?? null,
    all: split(row.all),
    home: split(row.home),
    away: split(row.away),
  };
}

/**
 * Odvodí skutečný evropský/sestupový access key ligy z reálného pole `description`
 * u každého řádku (API-Football, např. "Promotion - Champions League (Group Stage)",
 * "Promotion - Europa League (Play Offs)", "Relegation - Relegation Play-offs") –
 * náhrada za ručně udržovanou `LEAGUE_ACCESS` v lib/game/leagues.ts, sezónně přesná bez
 * ruční údržby. Vrací `null`, pokud žádný řádek nemá rozpoznatelný popis (chybějící
 * data / neznámá soutěž) → volající pak spadne na kurátorovaný fallback.
 */
export function deriveLeagueAccess(raw: ApiStandingRow[]): LeagueAccess | null {
  const slots: { rank: number; spot: EuropeSpot }[] = [];
  let relegBottom = 0;
  for (const row of raw) {
    const desc = row.description?.toLowerCase() ?? "";
    if (!desc) continue;
    const isQualifier = /qualif|play.?off|preliminary/.test(desc);
    let spot: EuropeSpot | null = null;
    if (desc.includes("champions league")) spot = isQualifier ? "UCL_Q" : "UCL";
    else if (desc.includes("europa league")) spot = isQualifier ? "UEL_Q" : "UEL";
    else if (desc.includes("conference league")) spot = isQualifier ? "UECL_Q" : "UECL";
    if (spot) slots.push({ rank: row.rank, spot });
    if (desc.includes("relegation")) relegBottom++;
  }
  if (slots.length === 0 && relegBottom === 0) return null;
  slots.sort((a, b) => a.rank - b.rank);
  return { slots, relegBottom };
}

/** Průměr vstřelených a obdržených gólů na zápas přes celou ligu (z cachované tabulky). */
export function computeLeagueGoalsAvg(standings: ApiStandingRow[]): LeagueGoalsAvg | null {
  const totalPlayed = standings.reduce((s, r) => s + (r.all?.played ?? 0), 0);
  if (!totalPlayed) return null;
  return {
    goalsFor: standings.reduce((s, r) => s + (r.all?.goals?.for ?? 0), 0) / totalPlayed,
    goalsAgainst: standings.reduce((s, r) => s + (r.all?.goals?.against ?? 0), 0) / totalPlayed,
  };
}

function split(s: ApiStandingRow["all"]): StandingSplit {
  return {
    played: s?.played ?? 0,
    win: s?.win ?? 0,
    draw: s?.draw ?? 0,
    lose: s?.lose ?? 0,
    goalsFor: s?.goals?.for ?? 0,
    goalsAgainst: s?.goals?.against ?? 0,
  };
}
