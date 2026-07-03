import type { Scorer } from "@/lib/types";
import type { ApiTopScorer } from "./apiFootball";

/**
 * Vybere z ligového žebříčku střelců hráče daného týmu (top N dle gólů). Klub hráče
 * bereme z `statistics[0]` (aktuální angažmá). Hráče bez gólů/klubu zahodí. Zachovává
 * pořadí žebříčku (API ho vrací seřazený), pak jistí sestupně dle gólů.
 * Čistá funkce (kvůli testu) – jako `pickTeamStanding` / `selectCurrentInjuries`.
 */
export function pickTeamScorers(
  raw: ApiTopScorer[],
  teamId: number,
  limit = 3
): Scorer[] {
  return raw
    .map((it) => {
      const stat = it.statistics[0];
      return {
        playerId: it.player.id,
        name: it.player.name,
        goals: stat?.goals?.total ?? 0,
        teamId: stat?.team.id ?? null,
      };
    })
    .filter((s) => s.teamId === teamId && s.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .slice(0, limit)
    .map(({ playerId, name, goals }) => ({ playerId, name, goals }));
}
