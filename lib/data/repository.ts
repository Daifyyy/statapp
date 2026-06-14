import type { Injury, League, Team } from "@/lib/types";
import { isRealDataConfigured } from "@/lib/db";
import { LEAGUES, buildTeams } from "./mock/seed";
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
  includeEuro = false
): Promise<Team | null> {
  if (useReal) return real.getCompareTeam(teamId, leagueId, includeEuro);
  return allMockTeams().find((t) => t.id === teamId) ?? null;
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
