import type { League, Team } from "@/lib/types";
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
