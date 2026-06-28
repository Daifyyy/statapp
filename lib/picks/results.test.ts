import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { summarizeSettled } from "./results";

/** Minimální odehraný řádek; predikce zadána přes 1X2 pravděpodobnosti. */
function row(
  over: Partial<PredictionRow> & {
    homeWin: number;
    draw: number;
    awayWin: number;
    homeGoals: number | null;
    awayGoals: number | null;
  }
): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 39,
    season: 2025,
    kickoff: "2026-06-20T18:00:00.000Z",
    homeTeamId: 10,
    awayTeamId: 20,
    homeName: "Home",
    awayName: "Away",
    homeLogo: "h.png",
    awayLogo: "a.png",
    available: true,
    lambdaHome: 1.5,
    lambdaAway: 1.0,
    bttsYes: 0.5,
    over25: 0.5,
    lowConfidence: false,
    modelVersion: 1,
    status: "FT",
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

describe("summarizeSettled", () => {
  it("trefená predikce: favorit domácí a domácí vyhráli → hit", () => {
    const out = summarizeSettled([
      row({ homeWin: 0.6, draw: 0.25, awayWin: 0.15, homeGoals: 2, awayGoals: 0 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].predictedSide).toBe("home");
    expect(out[0].predictedProb).toBeCloseTo(0.6);
    expect(out[0].outcomeHit).toBe(true);
  });

  it("netrefená predikce: favorit domácí, ale remíza → miss", () => {
    const out = summarizeSettled([
      row({ homeWin: 0.6, draw: 0.25, awayWin: 0.15, homeGoals: 1, awayGoals: 1 }),
    ]);
    expect(out[0].outcomeHit).toBe(false);
  });

  it("vyřadí řádky bez dostupné predikce nebo bez skóre", () => {
    const out = summarizeSettled([
      row({ homeWin: 0.6, draw: 0.25, awayWin: 0.15, homeGoals: null, awayGoals: null }),
      row({ available: false, homeWin: 0.6, draw: 0.25, awayWin: 0.15, homeGoals: 2, awayGoals: 0 }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("klubový zápas → CLUB deep-link s leagueId u obou", () => {
    const out = summarizeSettled([
      row({ leagueId: 39, homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
    ]);
    expect(out[0].compareMode).toBe("CLUB");
    expect(out[0].homeCompareLeagueId).toBe(39);
    expect(out[0].awayCompareLeagueId).toBe(39);
  });

  it("reprezentační turnaj (MS=1) → NATIONAL a konfederace null (dotahuje repo)", () => {
    const out = summarizeSettled([
      row({ leagueId: 1, homeWin: 0.2, draw: 0.2, awayWin: 0.6, homeGoals: 0, awayGoals: 2 }),
    ]);
    expect(out[0].compareMode).toBe("NATIONAL");
    expect(out[0].predictedSide).toBe("away");
    expect(out[0].outcomeHit).toBe(true);
    expect(out[0].homeCompareLeagueId).toBeNull();
    expect(out[0].awayCompareLeagueId).toBeNull();
  });

  it("řadí nejnovější první", () => {
    const out = summarizeSettled([
      row({ fixtureId: 1, kickoff: "2026-06-18T18:00:00.000Z", homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
      row({ fixtureId: 2, kickoff: "2026-06-20T18:00:00.000Z", homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
    ]);
    expect(out.map((r) => r.fixtureId)).toEqual([2, 1]);
  });
});
