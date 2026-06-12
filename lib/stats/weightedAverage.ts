/** Hodnota jednoho okna vstupující do váženého průměru (§3.1). */
export interface WindowValue {
  weight: number;
  value: number | null; // null = okno nemá data
}

export interface WeightedResult {
  value: number | null;
}

/**
 * Vážený průměr napříč okny s re-normalizací vah.
 * Okna bez dat (value === null) se vynechají a jejich váha se poměrově
 * přerozdělí mezi zbývající okna (součet vah = 1). Pokud nemá data žádné
 * okno, vrací null.
 */
export function weightedAverage(windows: WindowValue[]): number | null {
  const present = windows.filter(
    (w): w is { weight: number; value: number } =>
      w.value !== null && w.weight > 0
  );
  if (present.length === 0) return null;

  const totalWeight = present.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) return null;

  const weighted = present.reduce(
    (sum, w) => sum + (w.weight / totalWeight) * w.value,
    0
  );
  return weighted;
}
