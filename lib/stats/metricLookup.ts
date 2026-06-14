import type { Metric, MetricValue, Venue } from "@/lib/types";

/** Najde spočítanou hodnotu metriky v dané variantě (null, když chybí). */
export function valueOf(
  values: MetricValue[],
  metric: Metric,
  venue: Venue
): number | null {
  return (
    values.find((v) => v.metric === metric && v.venue === venue)?.value ?? null
  );
}

/** Hodnota pro danou variantu s fallbackem na TOTAL (reprezentace / neutrál). */
export function valueOrTotal(
  values: MetricValue[],
  metric: Metric,
  venue: Venue
): number | null {
  return valueOf(values, metric, venue) ?? valueOf(values, metric, "TOTAL");
}

/** Příznak nízké spolehlivosti metriky v dané variantě (s fallbackem na TOTAL). */
export function lowConfidenceOf(
  values: MetricValue[],
  metric: Metric,
  venue: Venue
): boolean {
  const v =
    values.find((x) => x.metric === metric && x.venue === venue) ??
    values.find((x) => x.metric === metric && x.venue === "TOTAL");
  return v?.lowConfidence ?? true;
}
