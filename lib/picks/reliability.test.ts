import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { computeReliability } from "./reliability";

function row(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 39,
    season: 2025,
    kickoff: new Date(Date.now() - 86400000).toISOString(),
    homeTeamId: 10,
    awayTeamId: 20,
    homeName: "Domácí",
    awayName: "Hosté",
    homeLogo: "",
    awayLogo: "",
    available: true,
    lambdaHome: 1.6,
    lambdaAway: 1.0,
    homeWin: 0.5,
    draw: 0.25,
    awayWin: 0.25,
    bttsYes: 0.5,
    over25: 0.5,
    lowConfidence: false,
    modelVersion: 1,
    rho: -0.13,
    sharpen: 1,
    calibA: 1,
    calibB: 0,
    status: "FT",
    homeGoals: 1,
    awayGoals: 0,
    benchAvailable: false,
    benchHomeWin: null,
    benchDraw: null,
    benchAwayWin: null,
    oddsBookmaker: null,
    oddsHome: null,
    oddsDraw: null,
    oddsAway: null,
    oddsOver25: null,
    oddsBtts: null,
    readinessSample: 10,
    ...over,
  };
}

describe("computeReliability", () => {
  it("prázdný vstup → n=0, ece null", () => {
    const r = computeReliability([]);
    expect(r.outcome.n).toBe(0);
    expect(r.outcome.ece).toBeNull();
    expect(r.over25.n).toBe(0);
  });

  it("ignoruje nedostupné a neodehrané řádky", () => {
    const rows = [
      row({ available: false }),
      row({ homeGoals: null, awayGoals: null }),
    ];
    expect(computeReliability(rows).outcome.n).toBe(0);
  });

  it("1X2 dává 3 body na zápas", () => {
    const rows = [row(), row(), row()];
    expect(computeReliability(rows).outcome.n).toBe(9);
    expect(computeReliability(rows).over25.n).toBe(3);
    expect(computeReliability(rows).btts.n).toBe(3);
  });

  it("p=1 spadne do posledního koše (ne mimo rozsah)", () => {
    // Over 2.5 predikováno 1.0, padlo 5 gólů → poslední koš, observed 1.
    const r = computeReliability([row({ over25: 1, homeGoals: 3, awayGoals: 2 })]);
    const last = r.over25.bins[r.over25.bins.length - 1];
    expect(last.count).toBe(1);
    expect(last.avgPredicted).toBe(1);
    expect(last.observed).toBe(1);
  });

  it("dokonalá kalibrace → ECE ≈ 0", () => {
    // 10 zápasů s over25=0.5; přesně polovina padne přes 2.5 → pozorováno 0.5.
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({
        over25: 0.5,
        homeGoals: i < 5 ? 2 : 1,
        awayGoals: i < 5 ? 1 : 0, // i<5 → 3 góly (over), jinak 1 (under)
      })
    );
    const c = computeReliability(rows).over25;
    const bin = c.bins.find((b) => b.lower === 0.5)!;
    expect(bin.count).toBe(10);
    expect(bin.observed).toBeCloseTo(0.5);
    expect(bin.avgPredicted).toBeCloseTo(0.5);
    expect(c.ece).toBeCloseTo(0);
  });

  it("špatná kalibrace → vysoké ECE", () => {
    // over25=0.9, ale nikdy nepadne přes → observed 0, |0-0.9|=0.9.
    const rows = Array.from({ length: 8 }, () =>
      row({ over25: 0.9, homeGoals: 0, awayGoals: 0 })
    );
    const c = computeReliability(rows).over25;
    expect(c.ece).toBeCloseTo(0.9);
    const bin = c.bins.find((b) => b.lower === 0.9)!;
    expect(bin.observed).toBe(0);
  });

  it("počet košů je konfigurovatelný", () => {
    const r = computeReliability([row()], 5);
    expect(r.outcome.bins.length).toBe(5);
  });
});
