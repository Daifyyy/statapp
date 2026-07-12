import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { evaluateRule, filterPicks } from "./rules";

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

describe("evaluateRule", () => {
  it("nedostupná predikce nikdy nesplní pravidlo", () => {
    const r = row({ available: false, homeWin: 0.9 });
    expect(evaluateRule(r, { market: "win", venue: "home", minProb: 0.5 }).ok).toBe(false);
  });

  it("win/home: respektuje práh (hranice včetně)", () => {
    const r = row({ homeWin: 0.65 });
    expect(evaluateRule(r, { market: "win", venue: "home", minProb: 0.65 }).ok).toBe(true);
    expect(evaluateRule(r, { market: "win", venue: "home", minProb: 0.66 }).ok).toBe(false);
  });

  it("win/away čte awayWin", () => {
    const r = row({ awayWin: 0.7, homeWin: 0.1 });
    const m = evaluateRule(r, { market: "win", venue: "away", minProb: 0.65 });
    expect(m.ok).toBe(true);
    expect(m.side).toBe("away");
    expect(m.prob).toBeCloseTo(0.7);
  });

  it("win/any vybere silnější stranu", () => {
    const r = row({ homeWin: 0.3, awayWin: 0.55 });
    const m = evaluateRule(r, { market: "win", venue: "any", minProb: 0.5 });
    expect(m.side).toBe("away");
    expect(m.prob).toBeCloseTo(0.55);
    expect(m.ok).toBe(true);
  });

  it("over25 a btts čtou své pole, side je null", () => {
    const r = row({ over25: 0.62, bttsYes: 0.58 });
    const o = evaluateRule(r, { market: "over25", venue: "any", minProb: 0.6 });
    expect(o.ok).toBe(true);
    expect(o.side).toBeNull();
    const b = evaluateRule(r, { market: "btts", venue: "any", minProb: 0.6 });
    expect(b.ok).toBe(false);
  });
});

describe("filterPicks", () => {
  it("vrátí jen splňující a seřadí dle nejbližšího výkopu", () => {
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
    const rows = [
      row({ fixtureId: 1, homeWin: 0.66, kickoff: day(3) }),
      row({ fixtureId: 2, homeWin: 0.8, kickoff: day(1) }),
      row({ fixtureId: 3, homeWin: 0.5, kickoff: day(2) }), // pod prahem
      row({ fixtureId: 4, available: false, homeWin: 0.99, kickoff: day(0) }), // nedostupná
    ];
    const picks = filterPicks(rows, { market: "win", venue: "home", minProb: 0.65 });
    expect(picks.map((p) => p.fixtureId)).toEqual([2, 1]);
    expect(picks[0].side).toBe("home");
    expect(picks[0].explanation).toContain("Domácí");
  });

  it("při stejném dni řadí nejvyšší pravděpodobnost první", () => {
    const sameDay = "2026-07-01T18:00:00.000Z";
    const sameDayLater = "2026-07-01T20:00:00.000Z";
    const nextDay = "2026-07-02T15:00:00.000Z";
    const rows = [
      row({ fixtureId: 1, homeWin: 0.7, kickoff: sameDay }),
      row({ fixtureId: 2, homeWin: 0.9, kickoff: sameDayLater }),
      row({ fixtureId: 3, homeWin: 0.95, kickoff: nextDay }),
    ];
    const picks = filterPicks(rows, { market: "win", venue: "home", minProb: 0.65 });
    expect(picks.map((p) => p.fixtureId)).toEqual([2, 1, 3]);
  });

  it("klubový tip → CLUB deep-link s leagueId u obou stran", () => {
    const picks = filterPicks([row({ leagueId: 39, homeWin: 0.8 })], {
      market: "win",
      venue: "home",
      minProb: 0.65,
    });
    expect(picks[0].compareMode).toBe("CLUB");
    expect(picks[0].homeCompareLeagueId).toBe(39);
    expect(picks[0].awayCompareLeagueId).toBe(39);
  });

  it("reprezentační turnaj (MS=1) → NATIONAL mód a konfederace null (dotahuje route)", () => {
    const picks = filterPicks([row({ leagueId: 1, homeWin: 0.8 })], {
      market: "win",
      venue: "home",
      minProb: 0.65,
    });
    expect(picks[0].compareMode).toBe("NATIONAL");
    expect(picks[0].homeCompareLeagueId).toBeNull();
    expect(picks[0].awayCompareLeagueId).toBeNull();
  });
});
