import type { CompareResult, Team, TeamComparison } from "@/lib/types";
import { METRICS_BY_ENTITY } from "@/lib/types";
import { computeAllValues } from "./aggregate";
import { computeAllSummaries } from "./summary";
import { predictMatch } from "./predict";
import { resolveSource } from "./resolveSource";
import { buildTeamContext } from "@/lib/insights/context";
import { runInsightEngine } from "@/lib/insights/engine";

/**
 * Sestaví kompletní porovnání dvou týmů: zvolí zdroj dat, spočítá vážené
 * průměry všech metrik ve všech variantách, predikci a insights report.
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
  ): TeamComparison => ({
    team: {
      id: team.id,
      name: team.name,
      logoUrl: team.logoUrl,
      country: team.country,
    },
    values: computeAllValues(matches, metrics, entityType, now),
    summary: computeAllSummaries(matches),
  });

  const homeComparison = build(home, resolved.homeMatches);
  const awayComparison = build(away, resolved.awayMatches);
  const prediction = predictMatch(homeComparison, awayComparison);

  const insightReport = runInsightEngine({
    home: buildTeamContext("home", homeComparison, resolved.homeMatches, entityType, now),
    away: buildTeamContext("away", awayComparison, resolved.awayMatches, entityType, now),
    prediction,
    entityType,
  });

  return {
    source: resolved.source,
    sourceNote: resolved.sourceNote,
    metrics,
    home: homeComparison,
    away: awayComparison,
    prediction,
    insightReport,
  };
}
