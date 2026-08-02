import { describe, expect, it, vi } from "vitest";
import { MODEL_VERSION } from "./modelVersion";

/**
 * `getSettledPredictionRows` **musí filtrovat na aktuální verzi modelu.**
 *
 * Bump `MODEL_VERSION` vynuluje dataset (stará λ vznikla jiným výpočtem), což
 * `npm run calibrate` respektuje odjakživa – ale cesta do UI ne: volalo se
 * `getSettledPredictions()` bez argumentu, takže track-record, kalibrace, benchmark
 * i CLV na `/predikce` počítaly z 69 řádků, ze kterých bylo **62 z verze 1**.
 * Test drží ten default: kdo funkci zavolá bez parametru, dostane jen aktuální verzi.
 *
 * Prisma ani síť se netestují – jen se odchytí, s čím se `getSettledPredictions` volá.
 */

const { store } = vi.hoisted(() => ({
  store: { lastModelVersion: undefined as number | undefined, calls: 0 },
}));

vi.mock("@/lib/db", () => ({
  prisma: {},
  isRealDataConfigured: () => true,
}));

vi.mock("./predictionStore", () => ({
  getSettledPredictions: async (modelVersion?: number) => {
    store.calls++;
    store.lastModelVersion = modelVersion;
    return [];
  },
  getUpcomingPredictionRows: async () => [],
  getRecentSettledPredictions: async () => [],
  getPredictionByFixture: async () => null,
}));

describe("getSettledPredictionRows", () => {
  it("bez argumentu filtruje na aktuální MODEL_VERSION", async () => {
    const { getSettledPredictionRows } = await import("./repository");
    await getSettledPredictionRows();
    expect(store.calls).toBe(1);
    expect(store.lastModelVersion).toBe(MODEL_VERSION);
  });

  it("explicitní verze přebije default (zkoumání historické verze)", async () => {
    const { getSettledPredictionRows } = await import("./repository");
    await getSettledPredictionRows(1);
    expect(store.lastModelVersion).toBe(1);
  });

  it("nikdy nevolá store bez verze – to byl přesně ten bug", async () => {
    const { getSettledPredictionRows } = await import("./repository");
    await getSettledPredictionRows();
    expect(store.lastModelVersion).not.toBeUndefined();
  });
});
