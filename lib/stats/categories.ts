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
      // Obě strany na nule (typicky červené karty 0 : 0) → dělení nulou; remíza 5/5.
      // Jinak podíl, u `LOWER_IS_BETTER` obrácený (míň obdržených gólů = lepší).
      const homeShare = sum === 0 ? 0.5 : lowerBetter ? av / sum : hv / sum;

      // Sleduje se JEN domácí strana; hostující je doplněk do 10 a dopočítá se až
      // ze zaokrouhleného výsledku (viz níže), aby se strany nemohly rozejít.
      weightedHome += homeShare * 10 * weight;
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

    // Druhá strana se dopočítá až ze ZAOKROUHLENÉ první, ne zaokrouhlením vlastní
    // hodnoty. Skóre je podíl (`hs + as_ === 10` pro každou metriku, takže i vážený
    // průměr dá přesně 10), ale nezávislé zaokrouhlení obou stran umí dát 3.8 + 6.3
    // = 10.1 – a UI ty dvě čísla ukazuje vedle sebe a kreslí z nich pruh
    // (`homeScore / total`). Reálných dvojic jsou v běžných rozsazích stovky:
    // držení 30:50, fauly 8.5:11.5, góly 0.51:0.69. Táž konvence jako v `matchReport.ts`.
    const home = Math.round(homeScore * 10) / 10;
    const away = Math.round((10 - home) * 10) / 10;

    return {
      key: cat.key,
      label: cat.label,
      homeScore: home,
      awayScore: away,
      lowConfidence: anyLowConf,
      available,
    };
  });
}
