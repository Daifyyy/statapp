import type { CompareResult, Team, TeamComparison } from "@/lib/types";
import { METRICS_BY_ENTITY } from "@/lib/types";
import { computeAllValues } from "./aggregate";
import { computeAllSummaries } from "./summary";
import { predictMatch, type PredictOptions } from "./predict";
import { PREDICTION_METRICS, PREDICTION_WINDOW_WEIGHTS } from "./weights";
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
  now: Date = new Date(),
  /** Ligové měřítko + ladicí parametry λ. Bez nich se použijí produkční defaulty. */
  predictOpts?: PredictOptions
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

  // Predikce má VLASTNÍ vážení oken (`PREDICTION_WINDOW_WEIGHTS`): zobrazené metriky mají
  // popisovat aktuální formu (těžiště na LAST5), λ má odhadovat góly (pět zápasů je z valné
  // části šum – změřeno backtestem). Proto se tři metriky za λ počítají znovu, s jinými
  // vahami; vše ostatní (UI, insights, souhrny) běží na zobrazovacích hodnotách beze změny.
  const forPrediction = (matches: typeof resolved.homeMatches) => ({
    values: computeAllValues(
      matches,
      PREDICTION_METRICS,
      entityType,
      now,
      PREDICTION_WINDOW_WEIGHTS[entityType]
    ),
  });
  const prediction = predictMatch(
    forPrediction(resolved.homeMatches),
    forPrediction(resolved.awayMatches),
    predictOpts
  );

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
