import type { CompareResult, Team, TeamComparison } from "@/lib/types";
import { METRICS_BY_ENTITY } from "@/lib/types";
import { computeAllValues } from "./aggregate";
import { resolveSource } from "./resolveSource";
import { runInsights } from "@/lib/insights/runInsights";

/**
 * Sestaví kompletní porovnání dvou týmů: zvolí zdroj dat, spočítá vážené
 * průměry všech metrik ve všech variantách a vygeneruje insights.
 */
export function compareTeams(
  home: Team,
  away: Team,
  now: Date = new Date()
): CompareResult {
  const entityType = home.entityType;
  const metrics = METRICS_BY_ENTITY[entityType];
  const resolved = resolveSource(home, away);

  const build = (
    team: Team,
    matches: typeof resolved.homeMatches
  ): TeamComparison => {
    const values = computeAllValues(matches, metrics, entityType, now);
    return {
      team: {
        id: team.id,
        name: team.name,
        logoUrl: team.logoUrl,
        country: team.country,
      },
      values,
      insights: runInsights(matches, values, entityType, now),
    };
  };

  return {
    source: resolved.source,
    sourceNote: resolved.sourceNote,
    metrics,
    home: build(home, resolved.homeMatches),
    away: build(away, resolved.awayMatches),
  };
}
