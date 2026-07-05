import type { CategoryScore, EntityType, Metric, MetricValue, Venue } from "@/lib/types";
import { LOWER_IS_BETTER, METRICS_BY_ENTITY } from "@/lib/types";
import { valueOrTotal, lowConfidenceOf } from "./metricLookup";

interface MetricWeight {
  metric: Metric;
  weight: number;
}

interface CategoryDef {
  key: CategoryScore["key"];
  label: string;
  metrics: MetricWeight[];
}

const CATEGORY_DEFS: CategoryDef[] = [
  {
    key: "attack",
    label: "Útok",
    metrics: [
      { metric: "GOALS_FOR", weight: 3 },
      { metric: "XG", weight: 3 },
      { metric: "SHOTS_ON_TARGET", weight: 2 },
      { metric: "SHOTS_INSIDE_BOX", weight: 2 },
    ],
  },
  {
    key: "defense",
    label: "Obrana",
    metrics: [
      { metric: "GOALS_AGAINST", weight: 3 },
      // SAVES záměrně vynecháno: zákroky měří vytížení brankáře, ne defenzivní kvalitu.
      // Tým s 22 zákroky (3 góly) by skóroval výše než tým s 4 zákroky (1 gól), což je paradox.
    ],
  },
  {
    key: "ball_control",
    label: "Hra s míčem",
    metrics: [
      { metric: "POSSESSION", weight: 3 },
      { metric: "PASS_ACCURACY", weight: 2 },
      { metric: "PASSES_ACCURATE", weight: 1 },
    ],
  },
  {
    key: "chance_creation",
    label: "Tvorba šancí",
    metrics: [
      { metric: "SHOTS", weight: 2 },
      { metric: "CORNERS", weight: 1.5 },
      { metric: "SHOTS_OUTSIDE_BOX", weight: 0.5 },
    ],
  },
  {
    key: "discipline",
    label: "Disciplína",
    metrics: [
      { metric: "FOULS", weight: 2 },
      { metric: "YELLOW_CARDS", weight: 2 },
      { metric: "RED_CARDS", weight: 1 },
    ],
  },
];

/**
 * Spočítá 5 kategoriových skóre (0–10) z metrických hodnot obou týmů.
 * Normalizace je relativní (home vs. away), takže nepotřebuje ligový benchmark.
 * Kategorie bez dostupných dat pro daný mód (reprezentace bez POSSESSION atd.)
 * mají `available: false` a skóre 5/5.
 */
export function computeCategoryScores(
  homeValues: MetricValue[],
  awayValues: MetricValue[],
  venue: Venue,
  mode: EntityType
): CategoryScore[] {
  const allowed = new Set<Metric>(METRICS_BY_ENTITY[mode]);

  return CATEGORY_DEFS.map((cat) => {
    let weightedHome = 0;
    let weightedAway = 0;
    let totalWeight = 0;
    let anyLowConf = false;
    let dataCount = 0;

    for (const { metric, weight } of cat.metrics) {
      if (!allowed.has(metric)) continue;

      const hv = valueOrTotal(homeValues, metric, venue);
      const av = valueOrTotal(awayValues, metric, venue);

      if (hv === null || av === null) continue;
      dataCount++;

      const lowerBetter = LOWER_IS_BETTER.has(metric);
      const sum = hv + av;
      let hs: number;
      let as_: number;

      if (sum === 0) {
        hs = 5;
        as_ = 5;
      } else {
        const homeShare = lowerBetter ? av / sum : hv / sum;
        hs = homeShare * 10;
        as_ = (1 - homeShare) * 10;
      }

      weightedHome += hs * weight;
      weightedAway += as_ * weight;
      totalWeight += weight;

      if (
        lowConfidenceOf(homeValues, metric, venue) ||
        lowConfidenceOf(awayValues, metric, venue)
      ) {
        anyLowConf = true;
      }
    }

    const available = dataCount > 0;
    const homeScore = available ? weightedHome / totalWeight : 5;
    const awayScore = available ? weightedAway / totalWeight : 5;

    return {
      key: cat.key,
      label: cat.label,
      homeScore: Math.round(homeScore * 10) / 10,
      awayScore: Math.round(awayScore * 10) / 10,
      lowConfidence: anyLowConf,
      available,
    };
  });
}
