import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { fitCalibration, outcomeScoreAtCalibration } from "./fit";

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
    homeWin: 0.7,
    draw: 0.15,
    awayWin: 0.15,
    bttsYes: 0.5,
    over25: 0.5,
    lowConfidence: false,
    modelVersion: 1,
    rho: -0.03,
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

/**
 * 100 zápasů s predikcí 70/15/15, ale skutečnost je míň extrémní (55/25/20) –
 * simuluje diagnostikované přesebevědomí modelu na favoritech.
 */
function overconfidentRows(): PredictionRow[] {
  const outcomes: Array<[number, number]> = []; // [homeGoals, awayGoals]
  for (let i = 0; i < 55; i++) outcomes.push([1, 0]); // home
  for (let i = 0; i < 25; i++) outcomes.push([0, 0]); // draw
  for (let i = 0; i < 20; i++) outcomes.push([0, 1]); // away
  return outcomes.map(([hg, ag], i) =>
    row({ fixtureId: i, homeGoals: hg, awayGoals: ag })
  );
}

describe("outcomeScoreAtCalibration", () => {
  it("a=1, b=0 souhlasí s log-lossem přímo z uložených pravděpodobností", () => {
    const rows = overconfidentRows();
    const score = outcomeScoreAtCalibration(rows, 1, 0);
    expect(score.n).toBe(100);
    expect(score.logloss).toBeGreaterThan(0);
  });

  it("ignoruje řádky bez výsledku/nedostupné", () => {
    const rows = [row({ available: false }), row({ homeGoals: null })];
    expect(outcomeScoreAtCalibration(rows, 1, 0)).toEqual({ logloss: 0, brier: 0, n: 0 });
  });
});

describe("fitCalibration", () => {
  it("na přesebevědomých datech najde a < 1 (stlačení k 1/3) a zlepší log-loss", () => {
    const rows = overconfidentRows();
    const fit = fitCalibration(rows);
    expect(fit.a).toBeLessThan(1);
    expect(fit.bestScore.logloss).toBeLessThan(fit.baseline.logloss);
  });

  it("baseline v CalibFit odpovídá outcomeScoreAtCalibration(rows, 1, 0)", () => {
    const rows = overconfidentRows();
    const fit = fitCalibration(rows);
    const direct = outcomeScoreAtCalibration(rows, 1, 0);
    expect(fit.baseline).toEqual(direct);
  });

  it("na dobře kalibrovaných datech (predikce = skutečná četnost) zůstává blízko no-opu", () => {
    // 70/15/15 predikce a skutečnost přesně 70/15/15 → kalibrace nemá co zlepšovat.
    const outcomes: Array<[number, number]> = [];
    for (let i = 0; i < 70; i++) outcomes.push([1, 0]);
    for (let i = 0; i < 15; i++) outcomes.push([0, 0]);
    for (let i = 0; i < 15; i++) outcomes.push([0, 1]);
    const rows = outcomes.map(([hg, ag], i) => row({ fixtureId: i, homeGoals: hg, awayGoals: ag }));
    const fit = fitCalibration(rows);
    expect(fit.a).toBeCloseTo(1, 1);
    expect(fit.b).toBeCloseTo(0, 1);
  });
});
