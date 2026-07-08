// Kondice týmu (0–100, start 100). Náročné zápasové plány unavují víc, než stihne
// regenerace doplnit; pasivní plány kondici vracejí. Čisté funkce.
//
// Smysl: bez zdroje je „vždycky presuj" zadarmo nejlepší tah. S kondicí má intenzita
// cenu → volba plánu se stává rozpočtem přes celou sezónu, ne rozhodnutím per zápas.
// Kondice je JEN postih (plná = neutrální, nikdy bonus), takže neinflatuje λ.

import { FITNESS_PENALTY, FITNESS_RECOVERY, PLAN_FATIGUE } from "./balance";
import type { Plan } from "./types";

/**
 * λ modifikátor z kondice: 100 → 1.0 (bez postihu), 0 → 1 − `FITNESS_PENALTY` (0.9).
 * Aplikuje se jako morálka: útok × factor, obdržené ÷ factor.
 */
export function fitnessFactor(fitness: number): number {
  const f = clamp(fitness, 0, 100);
  return 1 - FITNESS_PENALTY * ((100 - f) / 100);
}

/** Kondice po odehraném kole daným plánem (únava plánu − regenerace). */
export function updateFitness(prev: number, plan: Plan): number {
  return Math.round(clamp(prev - PLAN_FATIGUE[plan] + FITNESS_RECOVERY, 0, 100));
}

/** Čistá změna kondice za kolo při daném plánu (kladná = regeneruje). */
export function fitnessDelta(plan: Plan): number {
  return FITNESS_RECOVERY - PLAN_FATIGUE[plan];
}

/** Slovní stav kondice pro UI. */
export function fitnessLabel(fitness: number): string {
  if (fitness >= 85) return "Svěží";
  if (fitness >= 65) return "V pořádku";
  if (fitness >= 45) return "Znavení";
  return "Vyčerpaní";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
