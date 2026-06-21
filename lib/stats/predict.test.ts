import { describe, expect, it } from "vitest";
import type { Metric, MetricValue, TeamComparison, Venue } from "@/lib/types";
import { predictMatch, drawTau, poissonVector } from "./predict";

/** Postaví minimální TeamComparison s danými hodnotami metrik (stejné pro všechny venue). */
function team(
  vals: Partial<Record<Metric, number>>,
  lowConfidence = false
): TeamComparison {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const values: MetricValue[] = [];
  for (const [metric, value] of Object.entries(vals)) {
    for (const venue of venues) {
      values.push({
        metric: metric as Metric,
        venue,
        value,
        lowConfidence,
        sampleSize: 10,
        breakdown: [],
      });
    }
  }
  return {
    team: { id: 1, name: "T", logoUrl: "", country: "" },
    values,
    summary: [],
  };
}

describe("predictMatch", () => {
  it("symetrické týmy → homeWin ≈ awayWin a součet ≈ 1", () => {
    const a = team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 });
    const b = team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 });
    const p = predictMatch(a, b);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 5);
    expect(Math.abs(p.homeWin - p.awayWin)).toBeLessThan(0.02);
  });

  it("silný útok doma vs slabá obrana hosta → výrazně vyšší homeWin", () => {
    const home = team({ GOALS_FOR: 2.6, GOALS_AGAINST: 0.8 });
    const away = team({ GOALS_FOR: 0.7, GOALS_AGAINST: 2.4 });
    const p = predictMatch(home, away);
    expect(p.homeWin).toBeGreaterThan(p.awayWin);
    expect(p.homeWin).toBeGreaterThan(0.5);
    expect(p.lambdaHome).toBeGreaterThan(p.lambdaAway);
  });

  it("over25 roste s očekávanými góly", () => {
    const low = predictMatch(
      team({ GOALS_FOR: 0.6, GOALS_AGAINST: 0.6 }),
      team({ GOALS_FOR: 0.6, GOALS_AGAINST: 0.6 })
    );
    const high = predictMatch(
      team({ GOALS_FOR: 2.5, GOALS_AGAINST: 2.5 }),
      team({ GOALS_FOR: 2.5, GOALS_AGAINST: 2.5 })
    );
    expect(high.over25).toBeGreaterThan(low.over25);
    expect(low.bttsYes).toBeGreaterThanOrEqual(0);
    expect(high.bttsYes).toBeLessThanOrEqual(1);
  });

  it("chybějící venue hodnoty → fallback na TOTAL (stále počítá)", () => {
    // Jen TOTAL hodnoty (žádné HOME/AWAY) – fallback v valueOrTotal.
    const onlyTotal = (gf: number, ga: number): TeamComparison => ({
      team: { id: 1, name: "T", logoUrl: "", country: "" },
      values: [
        { metric: "GOALS_FOR", venue: "TOTAL", value: gf, lowConfidence: false, sampleSize: 8, breakdown: [] },
        { metric: "GOALS_AGAINST", venue: "TOTAL", value: ga, lowConfidence: false, sampleSize: 8, breakdown: [] },
      ],
      summary: [],
    });
    const p = predictMatch(onlyTotal(2, 1), onlyTotal(1, 2));
    expect(p.lambdaHome).toBeGreaterThan(0);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 5);
  });

  it("lowConfidence se propíše z podkladových metrik", () => {
    const p = predictMatch(
      team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 }, true),
      team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 }, true)
    );
    expect(p.lowConfidence).toBe(true);
  });

  it("topScores: seřazené sestupně, validní skóre, prob ≤ součet 1X2", () => {
    const p = predictMatch(
      team({ GOALS_FOR: 1.8, GOALS_AGAINST: 1.1 }),
      team({ GOALS_FOR: 1.2, GOALS_AGAINST: 1.6 })
    );
    expect(p.topScores.length).toBeGreaterThan(0);
    expect(p.topScores.length).toBeLessThanOrEqual(5);
    // sestupně dle prob
    for (let i = 1; i < p.topScores.length; i++) {
      expect(p.topScores[i - 1].prob).toBeGreaterThanOrEqual(p.topScores[i].prob);
    }
    // platná nezáporná celá skóre + prob v rozsahu
    for (const s of p.topScores) {
      expect(Number.isInteger(s.home)).toBe(true);
      expect(Number.isInteger(s.away)).toBe(true);
      expect(s.prob).toBeGreaterThan(0);
      expect(s.prob).toBeLessThanOrEqual(1);
    }
    // součet top skóre nepřekročí celkovou pravděpodobnost (1)
    const sum = p.topScores.reduce((a, s) => a + s.prob, 0);
    expect(sum).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("topScores: nedostupná predikce → prázdné pole", () => {
    const empty: TeamComparison = {
      team: { id: 1, name: "X", logoUrl: "", country: "" },
      values: [],
      summary: [],
    };
    expect(predictMatch(empty, empty).topScores).toEqual([]);
  });

  it("bez gólových i xG dat → predikce nedostupná (ne falešná 50/50)", () => {
    const empty: TeamComparison = {
      team: { id: 1, name: "Nováček", logoUrl: "", country: "" },
      values: [],
      summary: [],
    };
    const p = predictMatch(empty, empty);
    expect(p.available).toBe(false);
    expect(p.homeWin).toBe(0);
    expect(p.draw).toBe(0);
    expect(p.awayWin).toBe(0);
  });

  it("data jen na jedné straně (soupeřova obrana) → predikce dostupná", () => {
    // Domácí nemá nic; host má jen GOALS_AGAINST → λ domácích z obrany soupeře.
    const home: TeamComparison = {
      team: { id: 1, name: "A", logoUrl: "", country: "" },
      values: [],
      summary: [],
    };
    const away = team({ GOALS_AGAINST: 1.4, GOALS_FOR: 1.2 });
    const p = predictMatch(home, away);
    expect(p.available).toBe(true);
    expect(p.lambdaHome).toBeGreaterThan(0);
  });
});

describe("drawTau (Dixon–Coles korekce)", () => {
  it("ρ = 0 → faktor 1 všude (čistý nezávislý Poisson)", () => {
    const cells: [number, number][] = [
      [0, 0], [0, 1], [1, 0], [1, 1], [2, 3], [0, 2], [3, 1],
    ];
    for (const [i, j] of cells) {
      expect(drawTau(i, j, 1.5, 1.2, 0)).toBe(1);
    }
  });

  it("ρ < 0 → zvýší 0:0 a 1:1, sníží 1:0 a 0:1, ostatní beze změny", () => {
    const lh = 1.6, la = 1.1, rho = -0.13;
    expect(drawTau(0, 0, lh, la, rho)).toBeGreaterThan(1);
    expect(drawTau(1, 1, lh, la, rho)).toBeGreaterThan(1);
    expect(drawTau(0, 1, lh, la, rho)).toBeLessThan(1);
    expect(drawTau(1, 0, lh, la, rho)).toBeLessThan(1);
    expect(drawTau(2, 2, lh, la, rho)).toBe(1);
  });

  it("nikdy nevrací zápornou hodnotu ani při extrémních λ a ρ", () => {
    expect(drawTau(0, 1, 5, 5, -0.5)).toBeGreaterThanOrEqual(0);
    expect(drawTau(1, 0, 5, 5, -0.5)).toBeGreaterThanOrEqual(0);
  });
});

describe("predictMatch – Dixon–Coles korekce remízy", () => {
  it("remíza je vyšší než u nezávislého Poissonu se stejnými λ", () => {
    const a = team({ GOALS_FOR: 1.4, GOALS_AGAINST: 1.4 });
    const b = team({ GOALS_FOR: 1.4, GOALS_AGAINST: 1.4 });
    const p = predictMatch(a, b);

    // Nezávislý baseline z týchž λ: normalizovaná diagonála mřížky.
    const ph = poissonVector(p.lambdaHome);
    const pa = poissonVector(p.lambdaAway);
    let indDraw = 0;
    let total = 0;
    for (let i = 0; i < ph.length; i++)
      for (let j = 0; j < pa.length; j++) {
        const x = ph[i] * pa[j];
        total += x;
        if (i === j) indDraw += x;
      }
    indDraw /= total;

    expect(p.draw).toBeGreaterThan(indDraw);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 5);
  });

  it("BTTS i Over 2.5 zůstávají v rozsahu [0,1]", () => {
    const p = predictMatch(
      team({ GOALS_FOR: 2.0, GOALS_AGAINST: 1.2 }),
      team({ GOALS_FOR: 1.3, GOALS_AGAINST: 1.7 })
    );
    expect(p.bttsYes).toBeGreaterThanOrEqual(0);
    expect(p.bttsYes).toBeLessThanOrEqual(1);
    expect(p.over25).toBeGreaterThanOrEqual(0);
    expect(p.over25).toBeLessThanOrEqual(1);
  });
});
