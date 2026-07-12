import type {
  EntityType,
  MatchStat,
  Metric,
  MetricValue,
  Venue,
  WindowBreakdown,
  WindowKey,
} from "@/lib/types";
import { WINDOW_LABELS } from "@/lib/types";
import { WINDOW_WEIGHTS } from "./weights";

/** Váhy oken pro jeden typ entity (zobrazení vs. predikce – viz `weights.ts`). */
export type WindowWeights = Record<WindowKey, number>;
import { matchWeight } from "./matchWeight";
import { selectWindowMatches, windowsFor } from "./windows";
import { weightedAverage, type WindowValue } from "./weightedAverage";

/** Pod kolik klesne efektivní vzorek, než hodnotu označíme „nízká spolehlivost". §3.4c */
export const LOW_CONFIDENCE_SAMPLE = 4;

export function matchesVenue(m: MatchStat, venue: Venue): boolean {
  if (venue === "TOTAL") return true;
  // Neutrální (turnajové) zápasy nepatří do domácí ani venkovní varianty. §3.4
  if (m.isNeutral) return false;
  return venue === "HOME" ? m.isHome : !m.isHome;
}

interface WindowAgg {
  value: number | null;
  effectiveSample: number; // součet vah zápasů, které metriku obsahovaly
}

/**
 * Hodnota metriky u jednoho zápasu. **Odvozené metriky** (`SCORED`, `CLEAN_SHEET`) se
 * dopočítají z gólů – neukládají se, takže fungují i nad starou cache a nezobrazují se v UI.
 * Vážený průměr přes ně vyjde jako **frekvence jevu** (0–1), ne jako počet gólů.
 */
function metricOf(m: MatchStat, metric: Metric): number | undefined {
  if (metric === "SCORED") {
    const gf = m.metrics.GOALS_FOR;
    return gf === undefined ? undefined : gf >= 1 ? 1 : 0;
  }
  if (metric === "CLEAN_SHEET") {
    const ga = m.metrics.GOALS_AGAINST;
    return ga === undefined ? undefined : ga === 0 ? 1 : 0;
  }
  return m.metrics[metric];
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
    const raw = metricOf(m, metric);
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
  now: Date = new Date(),
  /** Bez nich zobrazovací váhy; predikce si předává vlastní (`PREDICTION_WINDOW_WEIGHTS`). */
  weights: WindowWeights = WINDOW_WEIGHTS[entityType]
): MetricValue {
  const windowValues: WindowValue[] = [];
  const breakdown: WindowBreakdown[] = [];
  let effectiveSample = 0;

  for (const window of windowsFor(entityType)) {
    const selected = selectWindowMatches(matches, window, now).filter((m) =>
      matchesVenue(m, venue)
    );
    const agg = aggregateWindow(selected, metric, entityType);
    const weight = weights[window];
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
  // Zobrazený vzorek i práh spolehlivosti vychází ze stejné zaokrouhlené hodnoty,
  // aby UI neukázalo „4 zápasy" bez hvězdičky u efektivního vzorku 3.8. §3.4c
  const sampleSize = Math.round(effectiveSample);
  return {
    metric,
    venue,
    value: value === null ? null : round2(value),
    sampleSize,
    lowConfidence: value !== null && sampleSize < LOW_CONFIDENCE_SAMPLE,
    breakdown,
  };
}

/** Spočítá všechny metriky × všechny varianty pro jeden tým. */
export function computeAllValues(
  matches: MatchStat[],
  metrics: readonly Metric[],
  entityType: EntityType,
  now: Date = new Date(),
  weights: WindowWeights = WINDOW_WEIGHTS[entityType]
): MetricValue[] {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const out: MetricValue[] = [];
  for (const metric of metrics) {
    for (const venue of venues) {
      out.push(computeMetricValue(matches, metric, venue, entityType, now, weights));
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
