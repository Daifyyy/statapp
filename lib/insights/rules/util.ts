import type { Metric, MetricValue } from "@/lib/types";
import { lowConfidenceOf, valueOf } from "@/lib/stats/metricLookup";

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

/** Příznak malého vzorku pro metriku (TOTAL). */
export function lowConf(values: MetricValue[], metric: Metric): boolean {
  return lowConfidenceOf(values, metric, "TOTAL");
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
