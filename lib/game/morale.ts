// Morálka / momentum týmu (0–100, start 50). Ovlivňuje λ tvého týmu (moraleFactor) a
// vyvíjí se po každém kole dle výsledku a toho, zda šlo o překvapení. Čisté funkce.

import { MORALE_SWING } from "./balance";

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
  let d = outcome === "W" ? 8 : outcome === "L" ? -8 : 1;
  if (outcome === "W" && oppStronger) d += 5; // překvapivá výhra
  if (outcome === "L" && !oppStronger) d -= 5; // ostudná prohra
  const drifted = prev + (50 - prev) * 0.05;
  return Math.round(clamp(drifted + d, 0, 100));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
