import type { Metric, MetricValue, Readiness, ReadinessLevel, Venue } from "@/lib/types";

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
 * Efektivní vzorek metriky ve variantě s fallbackem na TOTAL (stejná logika jako
 * `lowConfidenceOf`: prázdná venue varianta → rozhoduje TOTAL pro neutrální reprezentace).
 */
function effSample(values: MetricValue[], metric: Metric, venue: Venue): number {
  const at = values.find((x) => x.metric === metric && x.venue === venue);
  const v =
    at && at.sampleSize > 0
      ? at
      : (values.find((x) => x.metric === metric && x.venue === "TOTAL") ?? at);
  return v?.sampleSize ?? 0;
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
    effSample(home.values, "GOALS_FOR", "HOME"),
    effSample(away.values, "GOALS_AGAINST", "AWAY"),
    effSample(away.values, "GOALS_FOR", "AWAY"),
    effSample(home.values, "GOALS_AGAINST", "HOME")
  );
  return readinessOf(sample);
}
