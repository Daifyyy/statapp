import type { Metric, MetricValue } from "@/lib/types";
import { lowConfidenceOf, valueOf, valueOrTotal } from "@/lib/stats/metricLookup";
import type { TeamContext } from "../context";

/** Jedno desetinné místo (góly, střely…). */
export function fmt(v: number): string {
  return v.toFixed(1);
}

/** Procenta zaokrouhlená na celé. */
export function pct(v: number): string {
  return `${Math.round(v)} %`;
}

/** Síla signálu (0–1) pro hodnotu NAD prahem; `scale` = rozsah „od prahu k max síle". */
export function strengthAbove(
  value: number,
  threshold: number,
  scale: number
): number {
  return clamp01((value - threshold) / scale);
}

/** Síla signálu (0–1) pro hodnotu POD prahem. */
export function strengthBelow(
  value: number,
  threshold: number,
  scale: number
): number {
  return clamp01((threshold - value) / scale);
}

/** Hodnota metriky v TOTAL (null = chybí, pravidlo se přeskočí). */
export function total(values: MetricValue[], metric: Metric): number | null {
  return valueOf(values, metric, "TOTAL");
}

/** Hodnota metriky v perspektivní variantě týmu (HOME/AWAY/TOTAL, fallback TOTAL). */
export function mv(ctx: TeamContext, metric: Metric): number | null {
  return valueOrTotal(ctx.values, metric, ctx.venue);
}

/** Příznak malého vzorku pro metriku v perspektivní variantě (fallback TOTAL). */
export function lc(ctx: TeamContext, metric: Metric): boolean {
  return lowConfidenceOf(ctx.values, metric, ctx.venue);
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
