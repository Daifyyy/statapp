import { describe, expect, it } from "vitest";
import type { FixtureDay, PlayedFixture, PredictionRow } from "@/lib/types";
import { mergeTips, summarizeSettled } from "./results";

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
    rho: -0.13,
    sharpen: 1,
    calibA: 1,
    calibB: 0,
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
    oddsUnder25: null,
    oddsBttsNo: null,
    oddsCloseHome: null,
    oddsCloseDraw: null,
    oddsCloseAway: null,
    oddsCloseOver25: null,
    oddsCloseUnder25: null,
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

  it("AET/PEN → afterExtraTime (uložené skóre je stav po 90 min)", () => {
    const out = summarizeSettled([
      row({ status: "AET", homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 1 }),
      row({ fixtureId: 2, homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
    ]);
    expect(out.find((r) => r.fixtureId === 1)?.afterExtraTime).toBe(true);
    expect(out.find((r) => r.fixtureId === 2)?.afterExtraTime).toBe(false);
  });

  it("řadí nejnovější první", () => {
    const out = summarizeSettled([
      row({ fixtureId: 1, kickoff: "2026-06-18T18:00:00.000Z", homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
      row({ fixtureId: 2, kickoff: "2026-06-20T18:00:00.000Z", homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
    ]);
    expect(out.map((r) => r.fixtureId)).toEqual([2, 1]);
  });
});

/** Odehraný zápas z rozpisu (bez tipu) – vstup pro `mergeTips`. */
function playedFixture(fixtureId: number): PlayedFixture {
  return {
    fixtureId,
    leagueId: 345,
    leagueName: "Fortuna Liga",
    leagueLogoUrl: "l.png",
    kickoff: "2026-08-01T15:00:00.000Z",
    home: { id: 10, name: "Home", logoUrl: "h.png" },
    away: { id: 20, name: "Away", logoUrl: "a.png" },
    homeGoals: 0,
    awayGoals: 4,
    afterExtraTime: false,
    national: false,
    compareMode: "CLUB",
    homeCompareLeagueId: 345,
    awayCompareLeagueId: 345,
  };
}

const day = (played: PlayedFixture[]): FixtureDay => ({
  date: "2026-08-01",
  fixtures: [],
  played,
});

describe("mergeTips", () => {
  it("přiřadí tip zápasu podle fixtureId", () => {
    const settled = summarizeSettled([
      row({ fixtureId: 7, homeWin: 0.2, draw: 0.25, awayWin: 0.55, homeGoals: 0, awayGoals: 4 }),
    ]);
    const [d] = mergeTips([day([playedFixture(7)])], settled);
    expect(d.played[0].tip).toEqual({ side: "away", prob: 0.55, hit: true });
  });

  it("zápas bez predikce projde beze změny – tip je překryv, ne filtr", () => {
    const settled = summarizeSettled([
      row({ fixtureId: 7, homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
    ]);
    const [d] = mergeTips([day([playedFixture(7), playedFixture(8)])], settled);
    expect(d.played).toHaveLength(2);
    expect(d.played[1].tip).toBeUndefined();
  });

  it("bez predikcí vrátí dny beze změny", () => {
    const days = [day([playedFixture(7)])];
    expect(mergeTips(days, [])).toBe(days);
  });

  it("nemutuje vstupní dny (server je sdílí mezi requesty ISR snapshotu)", () => {
    const input = day([playedFixture(7)]);
    const settled = summarizeSettled([
      row({ fixtureId: 7, homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
    ]);
    mergeTips([input], settled);
    expect(input.played[0].tip).toBeUndefined();
  });

  it("predikce k zápasu, který v ten den není, nic nerozbije", () => {
    const settled = summarizeSettled([
      row({ fixtureId: 999, homeWin: 0.6, draw: 0.2, awayWin: 0.2, homeGoals: 1, awayGoals: 0 }),
    ]);
    const [d] = mergeTips([day([playedFixture(7)])], settled);
    expect(d.played[0].tip).toBeUndefined();
  });
});
