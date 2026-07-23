import { describe, expect, it } from "vitest";
import type { MatchStat } from "@/lib/types";
import { computeSummary } from "./summary";

const NOW = new Date("2026-06-12T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** Zápas s daným skóre (gf:ga); `daysAgo` řídí pořadí (nejnovější = malé číslo). */
function match(
  id: number,
  daysAgo: number,
  gf: number,
  ga: number,
  opts: Partial<MatchStat> = {}
): MatchStat {
  return {
    fixtureId: id,
    date: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    isHome: true,
    isNeutral: false,
    competitive: true,
    season: 2025,
    isBaseline: false,
    metrics: { GOALS_FOR: gf, GOALS_AGAINST: ga },
    ...opts,
  };
}

describe("computeSummary – forma", () => {
  it("vrátí W/D/L v pořadí od nejnovějšího, max 5", () => {
    const matches = [
      match(1, 1, 3, 0), // W (nejnovější)
      match(2, 2, 1, 1), // D
      match(3, 3, 0, 2), // L
      match(4, 4, 2, 1), // W
      match(5, 5, 0, 0), // D
      match(6, 6, 5, 0), // W (mimo top 5)
    ];
    const s = computeSummary(matches, "TOTAL");
    expect(s.form).toEqual(["W", "D", "L", "W", "D"]);
    expect(s.formSampleSize).toBe(5);
  });

  it("vrátí kratší formu, když je zápasů méně než 5", () => {
    const s = computeSummary([match(1, 1, 1, 0), match(2, 2, 0, 1)], "TOTAL");
    expect(s.form).toEqual(["W", "L"]);
    expect(s.formSampleSize).toBe(2);
  });

  it("formOpponents je zarovnané s form (stejné pořadí/délka, správný soupeř na indexu)", () => {
    const opp1 = { id: 100, name: "Rival A", logoUrl: "a.png" };
    const opp2 = { id: 200, name: "Rival B", logoUrl: "b.png" };
    const matches = [
      match(1, 1, 3, 0, { opponent: opp1 }), // nejnovější
      match(2, 2, 1, 1, { opponent: opp2 }),
      match(3, 3, 0, 2), // bez opponent → null
    ];
    const s = computeSummary(matches, "TOTAL");
    expect(s.formOpponents).toEqual([opp1, opp2, null]);
    expect(s.formOpponents.length).toBe(s.form.length);
  });
});

describe("computeSummary – CS % / FTS %", () => {
  it("počítá procenta z posledních 10 zápasů", () => {
    // 10 zápasů: 4× čisté konto (ga=0), 2× bez gólu (gf=0)
    const matches = [
      match(1, 1, 1, 0),
      match(2, 2, 2, 0),
      match(3, 3, 0, 0), // CS i FTS
      match(4, 4, 3, 0),
      match(5, 5, 1, 2),
      match(6, 6, 0, 1), // FTS
      match(7, 7, 2, 2),
      match(8, 8, 1, 1),
      match(9, 9, 3, 1),
      match(10, 10, 2, 3),
    ];
    const s = computeSummary(matches, "TOTAL");
    expect(s.sampleSize).toBe(10);
    expect(s.cleanSheetPct).toBe(40); // zápasy 1,2,3,4
    expect(s.failedToScorePct).toBe(20); // zápasy 3,6
  });

  it("bere jen 10 nejnovějších, i když je zápasů víc", () => {
    const matches = Array.from({ length: 14 }, (_, i) =>
      match(i, i, 1, 0)
    ); // všech 14 je čisté konto
    const s = computeSummary(matches, "TOTAL");
    expect(s.sampleSize).toBe(10);
    expect(s.cleanSheetPct).toBe(100);
  });
});

describe("computeSummary – venue filtr", () => {
  it("HOME bere jen domácí, AWAY jen venkovní; neutrální nikam", () => {
    const matches = [
      match(1, 1, 1, 0, { isHome: true }),
      match(2, 2, 0, 1, { isHome: false }),
      match(3, 3, 2, 2, { isNeutral: true }), // mimo HOME i AWAY
    ];
    expect(computeSummary(matches, "HOME").sampleSize).toBe(1);
    expect(computeSummary(matches, "HOME").form).toEqual(["W"]);
    expect(computeSummary(matches, "AWAY").sampleSize).toBe(1);
    expect(computeSummary(matches, "AWAY").form).toEqual(["L"]);
    expect(computeSummary(matches, "TOTAL").sampleSize).toBe(3);
  });
});

describe("computeSummary – prázdný vstup", () => {
  it("vrátí prázdnou formu a null procenta", () => {
    const s = computeSummary([], "TOTAL");
    expect(s.form).toEqual([]);
    expect(s.formSampleSize).toBe(0);
    expect(s.sampleSize).toBe(0);
    expect(s.cleanSheetPct).toBeNull();
    expect(s.failedToScorePct).toBeNull();
  });
});
