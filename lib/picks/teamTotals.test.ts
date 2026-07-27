import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { poissonVector, PREDICT_PARAMS } from "@/lib/stats/predict";
import {
  goalMarginals,
  overProbOf,
  teamTotalCalibration,
  teamTotalDispersion,
  teamTotalLevel,
  teamTotalProb,
} from "./teamTotals";

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
    lambdaAway: 1.2,
    homeWin: 0.45,
    draw: 0.27,
    awayWin: 0.28,
    bttsYes: 0.5,
    over25: 0.5,
    lowConfidence: false,
    readinessSample: 10,
    modelVersion: 7,
    rho: PREDICT_PARAMS.rho,
    sharpen: PREDICT_PARAMS.sharpen,
    calibA: 1,
    calibB: 0,
    status: "FT",
    homeGoals: 2,
    awayGoals: 1,
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
    ...over,
  } as PredictionRow;
}

describe("goalMarginals", () => {
  it("obě marginály jsou normalizované na 1", () => {
    const m = goalMarginals(1.5, 1.2);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(m.home)).toBeCloseTo(1, 9);
    expect(sum(m.away)).toBeCloseTo(1, 9);
  });

  it("střední hodnota marginály odpovídá λ", () => {
    const m = goalMarginals(1.5, 1.2);
    const mean = (a: number[]) => a.reduce((s, p, k) => s + k * p, 0);
    // Uťatá mřížka (0..10) a DC korekce → drobná odchylka, ne přesná rovnost.
    expect(mean(m.home)).toBeCloseTo(1.5, 2);
    expect(mean(m.away)).toBeCloseTo(1.2, 2);
  });

  it("Dixon–Colesovo τ marginály ZACHOVÁVÁ (vlastnost, ne shoda náhodou)", () => {
    // τ přerozděluje hmotu uvnitř čtyř nejnižších skóre, ale řádkové součty nemění:
    // pro i=0 je oprava ph₀·[1 + λₕρ(pa₁ − λₐpa₀)] a pa₁ = λₐpa₀ → závorka je nula.
    // Proto vyjde marginála číselně jako Poisson – i při silném ρ.
    for (const rho of [0, -0.03, -0.18]) {
      const m = goalMarginals(1.5, 1.2, { ...PREDICT_PARAMS, rho });
      const raw = poissonVector(1.5);
      for (let k = 0; k <= 5; k++) expect(m.home[k]).toBeCloseTo(raw[k], 6);
    }
  });

  it("zostření λ marginály naopak MĚNÍ (posouvá samotnou λ)", () => {
    const base = goalMarginals(1.5, 1.2, { ...PREDICT_PARAMS, sharpen: 1 });
    const sharp = goalMarginals(1.5, 1.2, { ...PREDICT_PARAMS, sharpen: 1.3 });
    // Zostření zvedne λ favorita → míň nulových zápasů.
    expect(sharp.home[0]).toBeLessThan(base.home[0]);
  });

  it("prohození λ zrcadlí marginály", () => {
    const a = goalMarginals(1.7, 0.9);
    const b = goalMarginals(0.9, 1.7);
    for (let k = 0; k < a.home.length; k++) {
      expect(a.home[k]).toBeCloseTo(b.away[k], 12);
      expect(a.away[k]).toBeCloseTo(b.home[k], 12);
    }
  });
});

describe("overProbOf", () => {
  it("doplněk k P(0 gólů) na lince 0.5", () => {
    const m = goalMarginals(1.5, 1.2);
    expect(overProbOf(m.home, 0.5)).toBeCloseTo(1 - m.home[0], 9);
  });

  it("klesá s rostoucí linií", () => {
    const m = goalMarginals(1.5, 1.2);
    expect(overProbOf(m.home, 0.5)).toBeGreaterThan(overProbOf(m.home, 1.5));
    expect(overProbOf(m.home, 1.5)).toBeGreaterThan(overProbOf(m.home, 2.5));
  });

  it("zůstává platnou pravděpodobností v extrémech", () => {
    const m = goalMarginals(0.3, 0.3);
    expect(overProbOf(m.home, 9.5)).toBeGreaterThan(0);
    expect(overProbOf(m.home, 9.5)).toBeLessThan(1);
  });
});

describe("teamTotalProb", () => {
  it("silnější útok → vyšší pravděpodobnost přes 1.5", () => {
    const weak = teamTotalProb(row({ lambdaHome: 0.9 }), "home", 1.5);
    const strong = teamTotalProb(row({ lambdaHome: 2.4 }), "home", 1.5);
    expect(strong).toBeGreaterThan(weak);
  });

  it("čte zostření Z ŘÁDKU, ne z aktuálních konstant", () => {
    // Stejná zásada jako `reprice`: řádek nese, čím byl spočítaný. Jinak by se
    // v jednom měření míchaly dva různé modely. (ρ se tu neprojeví – τ marginály
    // zachovává, viz test výše; zostření ale ano, protože mění samotné λ.)
    const a = teamTotalProb(row({ sharpen: 1 }), "home", 1.5);
    const b = teamTotalProb(row({ sharpen: 1.4 }), "home", 1.5);
    expect(a).not.toBeCloseTo(b, 4);
  });

  it("obě strany se počítají ze svých λ", () => {
    const r = row({ lambdaHome: 2.2, lambdaAway: 0.7 });
    expect(teamTotalProb(r, "home", 1.5)).toBeGreaterThan(teamTotalProb(r, "away", 1.5));
  });
});

describe("teamTotalLevel / dispersion", () => {
  it("porovná ⌀ λ se skutečností", () => {
    const rows = [
      row({ lambdaHome: 1.5, homeGoals: 2 }),
      row({ lambdaHome: 1.5, homeGoals: 1 }),
    ];
    const l = teamTotalLevel(rows, "home");
    expect(l.n).toBe(2);
    expect(l.lambda).toBeCloseTo(1.5, 9);
    expect(l.actual).toBeCloseTo(1.5, 9);
  });

  it("neodehrané řádky se přeskočí", () => {
    expect(teamTotalLevel([row({ homeGoals: null, awayGoals: null })], "home").n).toBe(0);
    expect(teamTotalDispersion([row({ homeGoals: null, awayGoals: null })], "home")).toBe(0);
  });

  it("Poissonovský rozptyl kolem λ dá disperzi ≈ 1", () => {
    // λ = 1, odchylky ±1 → (±1)²/1 = 1.
    const rows = [
      row({ lambdaHome: 1, homeGoals: 2 }),
      row({ lambdaHome: 1, homeGoals: 0 }),
    ];
    expect(teamTotalDispersion(rows, "home")).toBeCloseTo(1, 9);
  });
});

describe("teamTotalCalibration", () => {
  it("spočítá základní míru a laťku konstanty", () => {
    const rows = [
      row({ lambdaHome: 1.5, homeGoals: 2 }),
      row({ lambdaHome: 1.5, homeGoals: 0 }),
      row({ lambdaHome: 1.5, homeGoals: 3 }),
      row({ lambdaHome: 1.5, homeGoals: 0 }),
    ];
    const c = teamTotalCalibration(rows, "home", 0.5);
    expect(c.n).toBe(4);
    expect(c.baseRate).toBeCloseTo(0.5, 9);
    expect(c.baseLogloss).toBeCloseTo(Math.log(2), 9);
  });

  it("nedostupné predikce se do měření nepočítají", () => {
    expect(teamTotalCalibration([row({ available: false })], "home", 0.5).n).toBe(0);
  });
});
