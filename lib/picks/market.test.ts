import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { computeMarketBenchmark, devig, marketProbs, overround } from "./market";

/** Minimální odehraný řádek; kurzy a liga volitelně. */
function row(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 39, // Premier League = klub
    season: 2025,
    kickoff: "2026-08-20T18:00:00.000Z",
    homeTeamId: 10,
    awayTeamId: 20,
    homeName: "Home",
    awayName: "Away",
    homeLogo: "h.png",
    awayLogo: "a.png",
    available: true,
    lambdaHome: 1.6,
    lambdaAway: 1.1,
    homeWin: 0.5,
    draw: 0.25,
    awayWin: 0.25,
    bttsYes: 0.5,
    over25: 0.5,
    lowConfidence: false,
    readinessSample: 10,
    modelVersion: 1,
    rho: -0.13,
    sharpen: 1,
    calibA: 1,
    calibB: 0,
    status: "FT",
    homeGoals: 2,
    awayGoals: 0,
    benchAvailable: false,
    benchHomeWin: null,
    benchDraw: null,
    benchAwayWin: null,
    oddsBookmaker: "Bookie",
    oddsHome: 2.0,
    oddsDraw: 3.5,
    oddsAway: 4.0,
    oddsOver25: null,
    oddsBtts: null,
    ...over,
  };
}

describe("devig", () => {
  it("odmaržované pravděpodobnosti dají součet 1", () => {
    const p = devig(2.0, 3.5, 4.0)!;
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 10);
    // Favorit (nejnižší kurz) má nejvyšší pravděpodobnost.
    expect(p.home).toBeGreaterThan(p.draw);
    expect(p.draw).toBeGreaterThan(p.away);
  });

  it("férové kurzy bez marže projdou beze změny", () => {
    // 1/2 + 1/4 + 1/4 = 1 → overround 1.0, de-vig nic nemění.
    expect(overround(2, 4, 4)).toBeCloseTo(1, 10);
    const p = devig(2, 4, 4)!;
    expect(p.home).toBeCloseTo(0.5, 10);
    expect(p.draw).toBeCloseTo(0.25, 10);
  });

  it("marže se odečte: implikované 1/kurz je vždy vyšší než de-vigované", () => {
    const p = devig(2.0, 3.5, 4.0)!;
    expect(overround(2.0, 3.5, 4.0)).toBeGreaterThan(1);
    expect(p.home).toBeLessThan(1 / 2.0);
  });

  it("nesmyslné kurzy (≤ 1) → null", () => {
    expect(devig(1, 3.5, 4)).toBeNull();
    expect(devig(2, 3.5, 0.9)).toBeNull();
  });

  it("marketProbs: bez kurzů → null", () => {
    expect(marketProbs(row({ oddsHome: null }))).toBeNull();
    expect(marketProbs(row())).not.toBeNull();
  });
});

describe("computeMarketBenchmark", () => {
  it("skóruje oba modely na stejné podmnožině", () => {
    const b = computeMarketBenchmark([row()]);
    expect(b.n).toBe(1);
    expect(b.our?.n).toBe(1);
    expect(b.market?.n).toBe(1);
    expect(b.avgOverround).toBeCloseTo(overround(2.0, 3.5, 4.0), 10);
  });

  it("vynechá reprezentační zápasy (nesrovnatelné napříč konfederacemi, bez kurzů)", () => {
    const b = computeMarketBenchmark([
      row({ leagueId: 1, fixtureId: 2 }), // MS
      row({ leagueId: 5, fixtureId: 3 }), // Liga národů
    ]);
    expect(b.n).toBe(0);
    expect(b.our).toBeNull();
  });

  it("vynechá řádky bez kurzů, bez výsledku i bez naší predikce", () => {
    const b = computeMarketBenchmark([
      row({ fixtureId: 2, oddsHome: null }),
      row({ fixtureId: 3, homeGoals: null, awayGoals: null }),
      row({ fixtureId: 4, available: false }),
    ]);
    expect(b.n).toBe(0);
  });
});
