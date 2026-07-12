import type { MetricValue, Readiness, ReadinessLevel } from "@/lib/types";
import { sampleOrTotal } from "./metricLookup";

export type { Readiness, ReadinessLevel };

/**
 * Připravenost predikce = kolik dat reálně stojí za očekávanými góly. λ se skládá
 * z útoku a obrany obou týmů; **nejslabší vstup** určuje, nakolik predikci věřit
 * (na startu sezóny je LAST5/LAST10 tenké → predikce stojí hlavně na baseline
 * minulé sezóny). Vrací efektivní vzorek nejslabšího vstupu + skóre 0–1 + úroveň
 * pro odznak. Čistá funkce nad výstupem `compareTeams` – žádná nová data.
 */

/** Pod tímto efektivním vzorkem je predikce „málo dat" (gate na tipy + červený odznak). */
export const PREDICTION_READY_SAMPLE = 4;
/** Vzorek, od kterého je skóre připravenosti plné (1.0). */
const READINESS_FULL_SAMPLE = 6;

export function readinessLevel(sample: number): ReadinessLevel {
  if (sample < PREDICTION_READY_SAMPLE) return "low";
  if (sample < READINESS_FULL_SAMPLE) return "medium";
  return "ok";
}

/** Readiness z hotového vzorku – rekonstrukce z uloženého `readinessSample`. */
export function readinessOf(sample: number): Readiness {
  const s = Math.max(0, sample);
  return {
    sample: s,
    score: Math.min(s / READINESS_FULL_SAMPLE, 1),
    level: readinessLevel(s),
  };
}

/**
 * Připravenost predikce zápasu = nejslabší ze čtyř vstupů λ (útok × obrana obou týmů
 * ve venue relevantní pro zápas; HOME/AWAY s fallbackem na TOTAL u neutrálních
 * reprezentací). Mapuje přesně to, co `predict.ts` skládá do očekávaných gólů.
 */
export function computeReadiness(
  home: { values: MetricValue[] },
  away: { values: MetricValue[] }
): Readiness {
  const sample = Math.min(
    sampleOrTotal(home.values, "GOALS_FOR", "HOME"),
    sampleOrTotal(away.values, "GOALS_AGAINST", "AWAY"),
    sampleOrTotal(away.values, "GOALS_FOR", "AWAY"),
    sampleOrTotal(home.values, "GOALS_AGAINST", "HOME")
  );
  return readinessOf(sample);
}
