import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { buildDigest } from "./digest";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function row(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 39,
    season: 2026,
    kickoff: new Date(NOW.getTime() + 2 * 86400000).toISOString(),
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

describe("buildDigest", () => {
  it("bez kurzů → prázdno (edge nelze spočítat)", () => {
    expect(buildDigest([row()], { now: NOW })).toEqual([]);
  });

  it("vybere jen kladný edge", () => {
    // homeWin 0.5 × kurz 1.8 = 0.9 → edge −0.1 (žádná value).
    const noValue = row({ fixtureId: 1, homeWin: 0.5, oddsHome: 1.8 });
    // homeWin 0.6 × kurz 2.0 = 1.2 → edge +0.2 (value).
    const value = row({ fixtureId: 2, homeWin: 0.6, oddsHome: 2.0 });
    const d = buildDigest([noValue, value], { now: NOW });
    expect(d.map((p) => p.fixtureId)).toEqual([2]);
    expect(d[0].value!.edge).toBeCloseTo(0.2);
    expect(d[0].side).toBe("home");
  });

  it("per zápas vybere trh s nejvyšším edge", () => {
    // home win edge +0.1; over25 edge +0.3 → vybere over25.
    const r = row({ homeWin: 0.55, oddsHome: 2.0, over25: 0.65, oddsOver25: 2.0 });
    const d = buildDigest([r], { now: NOW });
    expect(d[0].market).toBe("over25");
    expect(d[0].value!.edge).toBeCloseTo(0.3);
  });

  it("řadí dle edge sestupně a omezí na limit", () => {
    const rows = [
      row({ fixtureId: 1, homeWin: 0.6, oddsHome: 2.0 }), // edge 0.2
      row({ fixtureId: 2, homeWin: 0.7, oddsHome: 2.0 }), // edge 0.4
      row({ fixtureId: 3, homeWin: 0.55, oddsHome: 2.0 }), // edge 0.1
    ];
    const d = buildDigest(rows, { now: NOW, limit: 2 });
    expect(d.map((p) => p.fixtureId)).toEqual([2, 1]);
  });

  it("ignoruje zápasy mimo okno dní a nedostupné predikce", () => {
    const past = row({ fixtureId: 1, kickoff: new Date(NOW.getTime() - 86400000).toISOString(), homeWin: 0.7, oddsHome: 2.0 });
    const farAway = row({ fixtureId: 2, kickoff: new Date(NOW.getTime() + 30 * 86400000).toISOString(), homeWin: 0.7, oddsHome: 2.0 });
    const unavailable = row({ fixtureId: 3, available: false, homeWin: 0.7, oddsHome: 2.0 });
    const ok = row({ fixtureId: 4, homeWin: 0.7, oddsHome: 2.0 });
    const d = buildDigest([past, farAway, unavailable, ok], { now: NOW });
    expect(d.map((p) => p.fixtureId)).toEqual([4]);
  });
});
