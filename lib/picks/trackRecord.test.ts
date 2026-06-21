import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { backtestRule, computeBenchmarkTrackRecord } from "./trackRecord";

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
    status: "FT",
    homeGoals: 1,
    awayGoals: 0,
    benchAvailable: false,
    benchHomeWin: null,
    benchDraw: null,
    benchAwayWin: null,
    ...over,
  };
}

describe("backtestRule", () => {
  it("win/home: počítá jen splňující práh a trefu dle skutečného výsledku", () => {
    const rows = [
      row({ fixtureId: 1, homeWin: 0.7, homeGoals: 2, awayGoals: 0 }), // tip + trefa
      row({ fixtureId: 2, homeWin: 0.7, homeGoals: 0, awayGoals: 1 }), // tip + minul
      row({ fixtureId: 3, homeWin: 0.5, homeGoals: 3, awayGoals: 0 }), // pod prahem → mimo
    ];
    const r = backtestRule(rows, { market: "win", venue: "home", minProb: 0.65 });
    expect(r.n).toBe(2);
    expect(r.hits).toBe(1);
    expect(r.hitRate).toBeCloseTo(0.5);
  });

  it("win/any: trefa pro silnější stranu dle výsledku", () => {
    const rows = [
      row({ homeWin: 0.3, awayWin: 0.6, homeGoals: 0, awayGoals: 2 }), // sázka na hosty, vyhráli
      row({ homeWin: 0.3, awayWin: 0.6, homeGoals: 1, awayGoals: 0 }), // sázka na hosty, prohráli
    ];
    const r = backtestRule(rows, { market: "win", venue: "any", minProb: 0.55 });
    expect(r.n).toBe(2);
    expect(r.hits).toBe(1);
  });

  it("over25: trefa dle součtu gólů", () => {
    const rows = [
      row({ over25: 0.7, homeGoals: 2, awayGoals: 1 }), // 3 → trefa
      row({ over25: 0.7, homeGoals: 1, awayGoals: 1 }), // 2 → mimo
    ];
    const r = backtestRule(rows, { market: "over25", venue: "any", minProb: 0.6 });
    expect(r.n).toBe(2);
    expect(r.hits).toBe(1);
  });

  it("btts: trefa když oba skórují", () => {
    const rows = [
      row({ bttsYes: 0.7, homeGoals: 1, awayGoals: 2 }), // oba → trefa
      row({ bttsYes: 0.7, homeGoals: 3, awayGoals: 0 }), // jen domácí → mimo
    ];
    const r = backtestRule(rows, { market: "btts", venue: "any", minProb: 0.6 });
    expect(r.n).toBe(2);
    expect(r.hits).toBe(1);
  });

  it("prázdný vzorek → hitRate null", () => {
    const r = backtestRule([row({ homeWin: 0.4 })], {
      market: "win",
      venue: "home",
      minProb: 0.65,
    });
    expect(r.n).toBe(0);
    expect(r.hitRate).toBeNull();
  });

  it("nedostupné a neodehrané řádky se do n nepočítají", () => {
    const rows = [
      row({ fixtureId: 1, homeWin: 0.7, available: false }), // nedostupná
      row({ fixtureId: 2, homeWin: 0.7, homeGoals: null, awayGoals: null }), // neodehraná
      row({ fixtureId: 3, homeWin: 0.7, homeGoals: 2, awayGoals: 0 }), // platná trefa
    ];
    const r = backtestRule(rows, { market: "win", venue: "home", minProb: 0.65 });
    expect(r.n).toBe(1);
    expect(r.hits).toBe(1);
  });

  it("samples: jen splňující řádky, hit odpovídá výsledku, side/prob z pravidla", () => {
    const rows = [
      row({ fixtureId: 1, homeWin: 0.7, homeGoals: 2, awayGoals: 0 }), // tip + trefa
      row({ fixtureId: 2, homeWin: 0.7, homeGoals: 0, awayGoals: 1 }), // tip + minul
      row({ fixtureId: 3, homeWin: 0.5, homeGoals: 3, awayGoals: 0 }), // pod prahem → mimo
    ];
    const r = backtestRule(rows, { market: "win", venue: "home", minProb: 0.65 });
    expect(r.samples).toHaveLength(2);
    const s1 = r.samples.find((s) => s.fixtureId === 1)!;
    expect(s1.hit).toBe(true);
    expect(s1.side).toBe("home");
    expect(s1.prob).toBeCloseTo(0.7);
    expect(s1.homeGoals).toBe(2);
    expect(r.samples.find((s) => s.fixtureId === 2)!.hit).toBe(false);
    expect(r.samples.some((s) => s.fixtureId === 3)).toBe(false);
  });

  it("samples: seřazené dle kickoff sestupně a oříznuté na limit; n/hits přes celou historii", () => {
    const mk = (id: number, daysAgo: number) =>
      row({
        fixtureId: id,
        homeWin: 0.7,
        homeGoals: 2,
        awayGoals: 0,
        kickoff: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      });
    // 4 platné tipy s různým datem (vstup schválně nesetříděný)
    const rows = [mk(1, 4), mk(2, 1), mk(3, 3), mk(4, 2)];
    const r = backtestRule(rows, { market: "win", venue: "home", minProb: 0.65 }, 2);
    expect(r.n).toBe(4); // n přes celou historii
    expect(r.hits).toBe(4);
    expect(r.samples).toHaveLength(2); // oříznuto na limit
    expect(r.samples.map((s) => s.fixtureId)).toEqual([2, 4]); // nejnovější první
  });
});

describe("computeBenchmarkTrackRecord", () => {
  const bench = (over: Partial<PredictionRow>) =>
    row({
      benchAvailable: true,
      benchHomeWin: 0.5,
      benchDraw: 0.25,
      benchAwayWin: 0.25,
      ...over,
    });

  it("počítá jen řádky, kde mají oba modely dostupnou predikci i skóre", () => {
    const rows = [
      bench({ fixtureId: 1, homeGoals: 2, awayGoals: 0 }), // oba dostupné + odehráno
      bench({ fixtureId: 2, benchAvailable: false, benchHomeWin: null }), // bez benchmarku
      row({ fixtureId: 3, homeGoals: 1, awayGoals: 1 }), // bez benchmarku (default)
      bench({ fixtureId: 4, available: false, homeGoals: 1, awayGoals: 0 }), // náš model nedostupný
      bench({ fixtureId: 5, homeGoals: null, awayGoals: null }), // neodehráno
    ];
    const r = computeBenchmarkTrackRecord(rows);
    expect(r.n).toBe(1);
    expect(r.our?.n).toBe(1);
    expect(r.bench?.n).toBe(1);
  });

  it("prázdná podmnožina → n 0 a null skóre", () => {
    const r = computeBenchmarkTrackRecord([row({ homeGoals: 1, awayGoals: 0 })]);
    expect(r.n).toBe(0);
    expect(r.our).toBeNull();
    expect(r.bench).toBeNull();
  });

  it("oba na stejné podmnožině; přesnost dle argmaxu (shoda/neshoda)", () => {
    // Náš model favorizuje domácí (0.6), benchmark hosty (0.6). Domácí vyhráli.
    const rows = [
      bench({
        fixtureId: 1,
        homeWin: 0.6,
        draw: 0.2,
        awayWin: 0.2,
        benchHomeWin: 0.2,
        benchDraw: 0.2,
        benchAwayWin: 0.6,
        homeGoals: 2,
        awayGoals: 0,
      }),
    ];
    const r = computeBenchmarkTrackRecord(rows);
    expect(r.our?.accuracy).toBe(1); // trefil domácí
    expect(r.bench?.accuracy).toBe(0); // trefil hosty
  });
});
