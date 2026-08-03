import { describe, expect, it } from "vitest";
import { ALL_METRICS, METRIC_HINTS, METRIC_LABELS } from "./types";

/**
 * `METRIC_HINTS` je `Partial<Record<Metric, string>>`, protože odvozené metriky mimo
 * `ALL_METRICS` se v UI nezobrazují a vysvětlivku nepotřebují. Typ tedy neuhlídá, že
 * **zobrazovaná** metrika nápovědu má – dřív jich devět z devatenácti nemělo žádnou.
 * Tenhle test to hlídá místo typu: nová metrika v `ALL_METRICS` bez hintu shodí testy.
 */
describe("METRIC_HINTS", () => {
  it("pokrývá každou zobrazovanou metriku", () => {
    const missing = ALL_METRICS.filter((m) => !METRIC_HINTS[m]);
    expect(missing).toEqual([]);
  });

  it("nápověda nese víc než jen popisek metriky", () => {
    for (const m of ALL_METRICS) {
      const hint = METRIC_HINTS[m] ?? "";
      expect(hint.length, m).toBeGreaterThan(METRIC_LABELS[m].length);
    }
  });

  it("nevysvětluje metriky, které se v UI nezobrazují", () => {
    const shown = new Set<string>(ALL_METRICS);
    const extra = Object.keys(METRIC_HINTS).filter((m) => !shown.has(m));
    expect(extra).toEqual([]);
  });
});
