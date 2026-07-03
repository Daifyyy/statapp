import type { Standing, StandingSplit } from "@/lib/types";
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
