import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { clvSideOf, rowClv, summarizeClv } from "./clv";

function row(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 39,
    season: 2024,
    kickoff: "2024-08-16T19:00:00.000Z",
    homeTeamId: 1,
    awayTeamId: 2,
    homeName: "A",
    awayName: "B",
    homeLogo: null,
    awayLogo: null,
    available: true,
    lambdaHome: 1.5,
    lambdaAway: 1.1,
    homeWin: 0.5,
    draw: 0.25,
    awayWin: 0.25,
    bttsYes: 0.5,
    over25: 0.5,
    lowConfidence: false,
    readinessSample: 10,
    modelVersion: 7,
    rho: -0.03,
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
    oddsBookmaker: "Pinnacle",
    oddsHome: 2.0,
    oddsDraw: 3.5,
    oddsAway: 4.0,
    oddsOver25: 1.9,
    oddsBtts: null,
    oddsUnder25: 2.0,
    oddsBttsNo: null,
    oddsCloseHome: null,
    oddsCloseDraw: null,
    oddsCloseAway: null,
    oddsCloseOver25: null,
    oddsCloseUnder25: null,
    ...over,
  } as PredictionRow;
}

describe("clvSideOf", () => {
  it("mapuje trh a stranu; BTTS se nesleduje", () => {
    expect(clvSideOf("win", "home")).toBe("home");
    expect(clvSideOf("win", "away")).toBe("away");
    expect(clvSideOf("over25", null)).toBe("over25");
    expect(clvSideOf("btts", null)).toBeNull();
  });
});

describe("rowClv", () => {
  it("kladné CLV, když linie zkrátí naši stranu (trh se pohnul k nám)", () => {
    // Domácí z 2.00 na 1.80 → pravděpodobnost vzrostla.
    const r = rowClv(
      row({ oddsCloseHome: 1.8, oddsCloseDraw: 3.6, oddsCloseAway: 4.5 }),
      "home"
    )!;
    expect(r.closeProb).toBeGreaterThan(r.openProb);
    expect(r.clv).toBeGreaterThan(0);
  });

  it("záporné CLV, když se linie pohnula proti nám", () => {
    const r = rowClv(
      row({ oddsCloseHome: 2.3, oddsCloseDraw: 3.4, oddsCloseAway: 3.4 }),
      "home"
    )!;
    expect(r.clv).toBeLessThan(0);
  });

  // Zásadní: CLV má měřit názor trhu, ne to, jak si sázkovka nastavila marži.
  it("samotná změna marže (při stejném názoru trhu) dá CLV nula", () => {
    // Zdvojnásobení marže napříč všemi stranami – poměry zůstanou stejné.
    const r = rowClv(
      row({
        oddsHome: 2.0,
        oddsDraw: 3.5,
        oddsAway: 4.0,
        oddsCloseHome: 2.0 / 1.05,
        oddsCloseDraw: 3.5 / 1.05,
        oddsCloseAway: 4.0 / 1.05,
      }),
      "home"
    )!;
    expect(r.clv).toBeCloseTo(0, 10);
  });

  it("Over/Under se počítá z obou stran totalu", () => {
    const r = rowClv(
      row({ oddsCloseOver25: 1.7, oddsCloseUnder25: 2.2 }),
      "over25"
    )!;
    expect(r.clv).toBeGreaterThan(0);
  });

  it("bez zavíracího snímku → null (starší řádky)", () => {
    expect(rowClv(row(), "home")).toBeNull();
    expect(rowClv(row({ oddsCloseHome: 1.8 }), "home")).toBeNull(); // neúplný 1X2
  });
});

describe("summarizeClv", () => {
  it("spočítá průměr i podíl tipů, které trh předběhly", () => {
    const good = row({ oddsCloseHome: 1.8, oddsCloseDraw: 3.6, oddsCloseAway: 4.5 });
    const bad = row({ oddsCloseHome: 2.3, oddsCloseDraw: 3.4, oddsCloseAway: 3.4 });
    const s = summarizeClv([
      { row: good, side: "home" },
      { row: good, side: "home" },
      { row: bad, side: "home" },
    ]);
    expect(s.n).toBe(3);
    expect(s.beatRate).toBeCloseTo(2 / 3, 6);
    expect(s.avgClv).toBeGreaterThan(0);
  });

  it("tipy bez zavíracího snímku se do souhrnu nepočítají", () => {
    expect(summarizeClv([{ row: row(), side: "home" }])).toEqual({
      n: 0,
      avgClv: 0,
      beatRate: 0,
    });
  });
});
