import type {
  EntityType,
  Insight,
  MatchStat,
  MetricValue,
  WindowKey,
} from "@/lib/types";
import { selectWindowMatches, windowsFor } from "@/lib/stats/windows";
import { matchWeight } from "@/lib/stats/matchWeight";

/** Prahy pravidel (§3.3) – snadno laditelné na jednom místě. */
const THRESHOLDS = {
  venueDiffRatio: 0.35, // rozdíl doma vs venku
  formDrop: 0.7, // forma pod 70 % baseline
  formRise: 1.3, // forma nad 130 % baseline
  weakDefenseGoals: 1.6, // obdržené góly / zápas
  weakAttackGoals: 0.9, // vstřelené góly / zápas
};

function valueOf(
  values: MetricValue[],
  metric: MetricValue["metric"],
  venue: MetricValue["venue"]
): number | null {
  return (
    values.find((v) => v.metric === metric && v.venue === venue)?.value ?? null
  );
}

/** Prostý vážený průměr metriky přes zápasy jednoho okna (pro detekci formy). */
function windowAvg(
  matches: MatchStat[],
  metric: MetricValue["metric"],
  window: WindowKey,
  entityType: EntityType,
  now: Date
): number | null {
  const selected = selectWindowMatches(matches, window, now);
  let w = 0;
  let v = 0;
  for (const m of selected) {
    const raw = m.metrics[metric];
    if (raw === undefined) continue;
    const mw = matchWeight(m, entityType);
    w += mw;
    v += mw * raw;
  }
  return w > 0 ? v / w : null;
}

/**
 * Vygeneruje insights o jednom týmu z jeho spočítaných hodnot a zápasů.
 */
export function runInsights(
  matches: MatchStat[],
  values: MetricValue[],
  entityType: EntityType,
  now: Date = new Date()
): Insight[] {
  const insights: Insight[] = [];
  const windows = windowsFor(entityType);
  const baseWindow = windows[0]; // SEASON / BASE
  const formWindow = windows[windows.length - 1]; // LAST5 / LAST6

  // 1) Výrazný rozdíl domácího a venkovního výkonu (vstřelené góly).
  const gfHome = valueOf(values, "GOALS_FOR", "HOME");
  const gfAway = valueOf(values, "GOALS_FOR", "AWAY");
  if (gfHome !== null && gfAway !== null) {
    const max = Math.max(gfHome, gfAway);
    if (max > 0 && Math.abs(gfHome - gfAway) / max > THRESHOLDS.venueDiffRatio) {
      const strongerHome = gfHome > gfAway;
      insights.push({
        type: "venue_diff",
        severity: "info",
        metric: "GOALS_FOR",
        text: strongerHome
          ? "Výrazně silnější doma než venku"
          : "Výrazně silnější venku než doma",
      });
    }
  }

  // 2) Pokles / vzestup formy (vstřelené góly: aktuální okno vs baseline).
  const baseGf = windowAvg(matches, "GOALS_FOR", baseWindow, entityType, now);
  const formGf = windowAvg(matches, "GOALS_FOR", formWindow, entityType, now);
  if (baseGf !== null && formGf !== null && baseGf > 0) {
    const ratio = formGf / baseGf;
    if (ratio < THRESHOLDS.formDrop) {
      insights.push({
        type: "form_drop",
        severity: "warning",
        metric: "GOALS_FOR",
        text: "Pokles formy v posledních zápasech",
      });
    } else if (ratio > THRESHOLDS.formRise) {
      insights.push({
        type: "form_rise",
        severity: "positive",
        metric: "GOALS_FOR",
        text: "Stoupající forma",
      });
    }
  }

  // 3) Defenzivní slabina (obdržené góly celkově).
  const gaTotal = valueOf(values, "GOALS_AGAINST", "TOTAL");
  if (gaTotal !== null && gaTotal > THRESHOLDS.weakDefenseGoals) {
    insights.push({
      type: "weak_defense",
      severity: "warning",
      metric: "GOALS_AGAINST",
      text: "Vysoký počet obdržených gólů",
    });
  }

  // 4) Ofenzivní slabina (vstřelené góly celkově).
  const gfTotal = valueOf(values, "GOALS_FOR", "TOTAL");
  if (gfTotal !== null && gfTotal < THRESHOLDS.weakAttackGoals) {
    insights.push({
      type: "weak_attack",
      severity: "warning",
      metric: "GOALS_FOR",
      text: "Nízká produktivita v útoku",
    });
  }

  return insights;
}
