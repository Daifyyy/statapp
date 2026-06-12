import type {
  EntityType,
  MatchStat,
  Metric,
  MetricValue,
  Venue,
  WindowBreakdown,
} from "@/lib/types";
import { WINDOW_LABELS } from "@/lib/types";
import { WINDOW_WEIGHTS } from "./weights";
import { matchWeight } from "./matchWeight";
import { selectWindowMatches, windowsFor } from "./windows";
import { weightedAverage, type WindowValue } from "./weightedAverage";

/** Pod kolik klesne efektivní vzorek, než hodnotu označíme „nízká spolehlivost". §3.4c */
export const LOW_CONFIDENCE_SAMPLE = 4;

function matchesVenue(m: MatchStat, venue: Venue): boolean {
  if (venue === "TOTAL") return true;
  // Neutrální (turnajové) zápasy nepatří do domácí ani venkovní varianty. §3.4
  if (m.isNeutral) return false;
  return venue === "HOME" ? m.isHome : !m.isHome;
}

interface WindowAgg {
  value: number | null;
  effectiveSample: number; // součet vah zápasů, které metriku obsahovaly
}

/** Vážený průměr metriky přes zápasy jednoho okna (váha = důležitost zápasu). */
function aggregateWindow(
  matches: MatchStat[],
  metric: Metric,
  entityType: EntityType
): WindowAgg {
  let weightSum = 0;
  let valueSum = 0;
  for (const m of matches) {
    const raw = m.metrics[metric];
    if (raw === undefined) continue; // např. chybějící xG
    const w = matchWeight(m, entityType);
    weightSum += w;
    valueSum += w * raw;
  }
  return {
    value: weightSum > 0 ? valueSum / weightSum : null,
    effectiveSample: weightSum,
  };
}

/** Spočítá výslednou hodnotu jedné metriky v jedné variantě (vážený průměr oken). */
export function computeMetricValue(
  matches: MatchStat[],
  metric: Metric,
  venue: Venue,
  entityType: EntityType,
  now: Date = new Date()
): MetricValue {
  const windowValues: WindowValue[] = [];
  const breakdown: WindowBreakdown[] = [];
  let effectiveSample = 0;

  for (const window of windowsFor(entityType)) {
    const selected = selectWindowMatches(matches, window, now).filter((m) =>
      matchesVenue(m, venue)
    );
    const agg = aggregateWindow(selected, metric, entityType);
    const weight = WINDOW_WEIGHTS[entityType][window];
    windowValues.push({ weight, value: agg.value });
    breakdown.push({
      window,
      label: WINDOW_LABELS[window],
      value: agg.value === null ? null : round2(agg.value),
      weight,
    });
    effectiveSample += agg.effectiveSample;
  }

  const value = weightedAverage(windowValues);
  return {
    metric,
    venue,
    value: value === null ? null : round2(value),
    sampleSize: Math.round(effectiveSample),
    lowConfidence: value !== null && effectiveSample < LOW_CONFIDENCE_SAMPLE,
    breakdown,
  };
}

/** Spočítá všechny metriky × všechny varianty pro jeden tým. */
export function computeAllValues(
  matches: MatchStat[],
  metrics: Metric[],
  entityType: EntityType,
  now: Date = new Date()
): MetricValue[] {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const out: MetricValue[] = [];
  for (const metric of metrics) {
    for (const venue of venues) {
      out.push(computeMetricValue(matches, metric, venue, entityType, now));
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
