import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { edge, impliedProb, rowValue, valueOf } from "./value";

function row(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 39,
    season: 2025,
    kickoff: new Date(Date.now() + 86400000).toISOString(),
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
    status: "NS",
    homeGoals: null,
    awayGoals: null,
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

describe("impliedProb / edge", () => {
  it("impliedProb = 1/kurz", () => {
    expect(impliedProb(2)).toBeCloseTo(0.5);
    expect(impliedProb(4)).toBeCloseTo(0.25);
  });

  it("edge = p×kurz − 1 (kladný = value)", () => {
    expect(edge(0.6, 2)).toBeCloseTo(0.2); // 0.6 vs implied 0.5 → +20 %
    expect(edge(0.5, 2)).toBeCloseTo(0); // férový kurz → nulová hrana
    expect(edge(0.4, 2)).toBeCloseTo(-0.2); // pod trhem → záporná hrana
  });
});

describe("valueOf", () => {
  it("spočítá implied a edge z platného kurzu", () => {
    const v = valueOf(0.6, 2.0);
    expect(v).not.toBeNull();
    expect(v!.impliedProb).toBeCloseTo(0.5);
    expect(v!.edge).toBeCloseTo(0.2);
  });

  it("null kurz / kurz ≤ 1 / nekladná pravděpodobnost → null", () => {
    expect(valueOf(0.6, null)).toBeNull();
    expect(valueOf(0.6, undefined)).toBeNull();
    expect(valueOf(0.6, 1)).toBeNull();
    expect(valueOf(0.6, 0.8)).toBeNull();
    expect(valueOf(0, 2)).toBeNull();
  });
});

describe("rowValue", () => {
  it("win/home páruje homeWin s oddsHome", () => {
    const v = rowValue(row({ homeWin: 0.55, oddsHome: 2.0 }), "win", "home");
    expect(v!.prob).toBeCloseTo(0.55);
    expect(v!.edge).toBeCloseTo(0.1);
  });

  it("win/away páruje awayWin s oddsAway", () => {
    const v = rowValue(row({ awayWin: 0.4, oddsAway: 3.0 }), "win", "away");
    expect(v!.edge).toBeCloseTo(0.2);
  });

  it("over25 a btts berou svůj kurz, side se ignoruje", () => {
    expect(rowValue(row({ over25: 0.6, oddsOver25: 1.9 }), "over25", null)!.edge).toBeCloseTo(0.14);
    expect(rowValue(row({ bttsYes: 0.55, oddsBtts: 2.0 }), "btts", null)!.edge).toBeCloseTo(0.1);
  });

  it("chybějící kurz → null (value nelze posoudit)", () => {
    expect(rowValue(row({ homeWin: 0.7 }), "win", "home")).toBeNull();
  });
});
