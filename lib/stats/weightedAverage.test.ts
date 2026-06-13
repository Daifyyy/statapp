import { describe, expect, it } from "vitest";
import { weightedAverage } from "./weightedAverage";

describe("weightedAverage", () => {
  it("spočítá vážený průměr 15/30/55", () => {
    const v = weightedAverage([
      { weight: 0.15, value: 1 },
      { weight: 0.3, value: 2 },
      { weight: 0.55, value: 3 },
    ]);
    expect(v).toBeCloseTo(0.15 * 1 + 0.3 * 2 + 0.55 * 3, 6);
  });

  it("re-normalizuje váhy při chybějícím okně", () => {
    // Chybí okno s váhou 0.15 → zbylé váhy 0.3 a 0.55 se přeškálují na součet 1.
    const v = weightedAverage([
      { weight: 0.15, value: null },
      { weight: 0.3, value: 2 },
      { weight: 0.55, value: 4 },
    ]);
    const expected = (0.3 * 2 + 0.55 * 4) / (0.3 + 0.55);
    expect(v).toBeCloseTo(expected, 6);
  });

  it("vrací null, když nemá data žádné okno", () => {
    expect(
      weightedAverage([
        { weight: 0.15, value: null },
        { weight: 0.3, value: null },
        { weight: 0.55, value: null },
      ])
    ).toBeNull();
  });

  it("ignoruje okna s nulovou váhou", () => {
    const v = weightedAverage([
      { weight: 0, value: 100 },
      { weight: 1, value: 5 },
    ]);
    expect(v).toBe(5);
  });

  it("re-normalizuje při dvou chybějících oknech (zbyde jediné)", () => {
    const v = weightedAverage([
      { weight: 0.15, value: null },
      { weight: 0.3, value: null },
      { weight: 0.55, value: 7 },
    ]);
    expect(v).toBe(7);
  });

  it("kombinace null + nulová váha → počítá jen z platného okna", () => {
    const v = weightedAverage([
      { weight: 0.15, value: null },
      { weight: 0, value: 100 },
      { weight: 0.55, value: 4 },
    ]);
    expect(v).toBe(4);
  });
});
