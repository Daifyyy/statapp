import { describe, expect, it } from "vitest";
import type { MatchStat } from "@/lib/types";
import { leadingStreak, pointsPerGame, resultsTimeline } from "./streaks";

const NOW = new Date("2026-06-12T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function m(id: number, daysAgo: number, gf: number, ga: number): MatchStat {
  return {
    fixtureId: id,
    date: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    isHome: true,
    isNeutral: false,
    competitive: true,
    season: 2025,
    isBaseline: false,
    metrics: { GOALS_FOR: gf, GOALS_AGAINST: ga },
  };
}

describe("resultsTimeline", () => {
  it("seřadí od nejnovějšího a určí W/D/L", () => {
    const tl = resultsTimeline([m(1, 3, 0, 1), m(2, 1, 2, 0), m(3, 2, 1, 1)]);
    expect(tl.map((e) => e.result)).toEqual(["W", "D", "L"]);
  });
});

describe("leadingStreak", () => {
  it("spočítá vedoucí sérii bez prohry", () => {
    const tl = resultsTimeline([
      m(1, 1, 2, 0), // W (nejnovější)
      m(2, 2, 1, 1), // D
      m(3, 3, 0, 2), // L → přeruší
      m(4, 4, 3, 0), // W
    ]);
    expect(leadingStreak(tl, (e) => e.result !== "L")).toBe(2);
  });

  it("série čistých kont", () => {
    const tl = resultsTimeline([m(1, 1, 1, 0), m(2, 2, 2, 0), m(3, 3, 1, 1)]);
    expect(leadingStreak(tl, (e) => e.ga === 0)).toBe(2);
  });
});

describe("pointsPerGame", () => {
  it("vážené body na zápas v okně LAST5", () => {
    // 5 výher → 3 body/zápas
    const wins = Array.from({ length: 5 }, (_, i) => m(i, i, 2, 0));
    expect(pointsPerGame(wins, "LAST5", "CLUB", NOW)).toBeCloseTo(3, 5);
  });
});
