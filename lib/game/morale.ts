// Morálka / momentum týmu (0–100, start 50). Ovlivňuje λ tvého týmu (moraleFactor) a
// vyvíjí se po každém kole dle výsledku a toho, zda šlo o překvapení. Čisté funkce.

import {
  MORALE_DRIFT,
  MORALE_OUTCOME_DELTA,
  MORALE_SURPRISE_BONUS,
  MORALE_SWING,
} from "./balance";

/** λ modifikátor z morálky: 1 ± MORALE_SWING (morálka 0 → 0.94, 100 → 1.06). */
export function moraleFactor(morale: number): number {
  const m = clamp(morale, 0, 100);
  return 1 + MORALE_SWING * ((m - 50) / 50);
}

/**
 * Nová morálka po tvém zápase. Výhra zvedá, prohra sráží; překvapení (výhra nad silnějším
 * / prohra se slabším) efekt zesiluje. Pomalá regrese ke středu 50, aby se nezasekla.
 */
export function updateMorale(
  prev: number,
  outcome: "W" | "D" | "L",
  oppStronger: boolean
): number {
  let d =
    outcome === "W"
      ? MORALE_OUTCOME_DELTA.win
      : outcome === "L"
        ? MORALE_OUTCOME_DELTA.loss
        : MORALE_OUTCOME_DELTA.draw;
  if (outcome === "W" && oppStronger) d += MORALE_SURPRISE_BONUS; // překvapivá výhra
  if (outcome === "L" && !oppStronger) d -= MORALE_SURPRISE_BONUS; // ostudná prohra
  const drifted = prev + (50 - prev) * MORALE_DRIFT;
  return Math.round(clamp(drifted + d, 0, 100));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
