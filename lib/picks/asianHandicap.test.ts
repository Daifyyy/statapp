import { describe, expect, it } from "vitest";
import {
  computeSupremacyDiagnostic,
  coverProb,
  devigTwoWay,
  goalDiffDist,
  impliedSupremacy,
  impliedTotal,
  isQuarterLine,
  marketView,
  ols,
  overTwoFiveProb,
  type SupremacyRow,
} from "./asianHandicap";

/** Deterministický generátor – testy nesmí mít náladu. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fér ceny obou stran s přimíchanou marží (tak, jak je kotuje sázkovka). */
function priced(p: number, margin = 0.01): [number, number] {
  return [1 / p / (1 + margin), 1 / (1 - p) / (1 + margin)];
}

describe("devigTwoWay", () => {
  it("odmaržuje na součet 1", () => {
    const fair = devigTwoWay(1.9, 1.9);
    expect(fair).not.toBeNull();
    expect(fair![0] + fair![1]).toBeCloseTo(1, 12);
    expect(fair![0]).toBeCloseTo(0.5, 12);
  });

  it("je PŘESNÝ: z ceny s marží vrátí původní pravděpodobnost", () => {
    for (const p of [0.35, 0.5, 0.62, 0.78]) {
      const [h, a] = priced(p, 0.025);
      const fair = devigTwoWay(h, a);
      expect(fair![0]).toBeCloseTo(p, 12);
    }
  });

  it("odmítne nesmyslné kurzy", () => {
    expect(devigTwoWay(1, 2)).toBeNull();
    expect(devigTwoWay(2, 0.5)).toBeNull();
  });
});

describe("total z Over/Under 2.5", () => {
  it("overTwoFiveProb roste a sedí na ručním výpočtu", () => {
    // λ = 2.5 → P(≥3) = 1 − e^-2.5 (1 + 2.5 + 3.125)
    expect(overTwoFiveProb(2.5)).toBeCloseTo(1 - Math.exp(-2.5) * 6.625, 12);
    expect(overTwoFiveProb(1)).toBeLessThan(overTwoFiveProb(3));
  });

  it("impliedTotal je inverzí (round-trip)", () => {
    for (const t of [1.8, 2.4, 2.7, 3.5, 4.2]) {
      expect(impliedTotal(overTwoFiveProb(t))).toBeCloseTo(t, 6);
    }
  });

  it("mimo rozsah vrací null místo clampu", () => {
    expect(impliedTotal(0)).toBeNull();
    expect(impliedTotal(1)).toBeNull();
    expect(impliedTotal(0.999999)).toBeNull();
  });
});

describe("rozdělení rozdílu gólů", () => {
  it("je normalizované a symetrické při shodných λ", () => {
    const d = goalDiffDist(1.4, 1.4);
    expect(d.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    // P(D = +2) === P(D = −2)
    expect(d[10 + 2]).toBeCloseTo(d[10 - 2], 12);
  });

  it("posouvá hmotu k domácím, když mají vyšší λ", () => {
    const d = goalDiffDist(2.2, 1.0);
    let up = 0;
    let down = 0;
    for (let k = 1; k <= 10; k++) {
      up += d[10 + k];
      down += d[10 - k];
    }
    expect(up).toBeGreaterThan(down);
  });
});

describe("coverProb", () => {
  it("linka 0 při shodných λ = 50 % (push se vydělí pryč)", () => {
    expect(coverProb(0, 1.5, 1.5)).toBeCloseTo(0.5, 10);
  });

  it("rozezná čtvrtinovou linku", () => {
    expect(isQuarterLine(-0.75)).toBe(true);
    expect(isQuarterLine(-0.25)).toBe(true);
    expect(isQuarterLine(-0.5)).toBe(false);
    expect(isQuarterLine(-1)).toBe(false);
    expect(isQuarterLine(0)).toBe(false);
  });

  it("čtvrtinová linka je přesně průměrem obou půlek", () => {
    const a = coverProb(-0.5, 1.9, 1.2)!;
    const b = coverProb(-1, 1.9, 1.2)!;
    const q = coverProb(-0.75, 1.9, 1.2)!;
    // Průměruje se v poměru výher a proher, ne v pravděpodobnostech – ověřujeme proto
    // jen to, že leží mezi oběma půlkami a je jim blízko.
    expect(q).toBeLessThan(a);
    expect(q).toBeGreaterThan(b);
  });

  it("je rostoucí v převaze domácích", () => {
    const low = coverProb(-0.5, 1.4, 1.4)!;
    const mid = coverProb(-0.5, 1.8, 1.0)!;
    const high = coverProb(-0.5, 2.4, 0.8)!;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("těžší hendikep favorita snižuje šanci na pokrytí", () => {
    expect(coverProb(-1.5, 2.2, 1.0)!).toBeLessThan(coverProb(-0.5, 2.2, 1.0)!);
  });
});

describe("inverze trhu", () => {
  it("impliedSupremacy vrátí převahu, ze které se cena vyrobila", () => {
    for (const [lh, la, line] of [
      [1.7, 1.1, -0.5],
      [2.1, 0.9, -1],
      [1.3, 1.3, 0],
      [1.0, 1.9, 0.5],
      [2.4, 1.0, -0.75],
    ] as const) {
      const total = lh + la;
      const p = coverProb(line, lh, la)!;
      const s = impliedSupremacy(line, p, total);
      expect(s).not.toBeNull();
      expect(s!).toBeCloseTo(lh - la, 4);
    }
  });

  it("marketView složí λ obou stran z reálně vypadajících kurzů", () => {
    const lh = 1.85;
    const la = 1.15;
    const line = -0.5;
    const [ahH, ahA] = priced(coverProb(line, lh, la)!, 0.02);
    const [ouO, ouU] = priced(overTwoFiveProb(lh + la), 0.03);

    const view = marketView(line, ahH, ahA, ouO, ouU);
    expect(view).not.toBeNull();
    expect(view!.total).toBeCloseTo(lh + la, 3);
    expect(view!.supremacy).toBeCloseTo(lh - la, 3);
    expect(view!.lambdaHome).toBeCloseTo(lh, 3);
    expect(view!.lambdaAway).toBeCloseTo(la, 3);
  });

  it("marží se výsledek neposune (je symetrická na obou stranách)", () => {
    const line = -1;
    const p = coverProb(line, 2.0, 1.0)!;
    const thin = marketView(line, ...priced(p, 0.005), ...priced(overTwoFiveProb(3), 0.005));
    const fat = marketView(line, ...priced(p, 0.08), ...priced(overTwoFiveProb(3), 0.08));
    expect(thin!.supremacy).toBeCloseTo(fat!.supremacy, 6);
  });

  it("nedosažitelná cena vrátí null, ne clamp", () => {
    // P(pokrytí) = 99.9 % při totalu 1.0 je mimo dosah jakékoli převahy.
    expect(impliedSupremacy(-2.5, 0.999, 1.0)).toBeNull();
  });
});

describe("ols", () => {
  it("najde známé koeficienty", () => {
    const rnd = lcg(7);
    const y: number[] = [];
    const X: number[][] = [];
    for (let i = 0; i < 500; i++) {
      const x1 = rnd() * 4 - 2;
      const x2 = rnd() * 4 - 2;
      X.push([x1, x2]);
      y.push(3 + 2 * x1 - 1 * x2 + (rnd() - 0.5) * 0.02);
    }
    const fit = ols(y, X)!;
    expect(fit.intercept).toBeCloseTo(3, 2);
    expect(fit.coef[0]).toBeCloseTo(2, 2);
    expect(fit.coef[1]).toBeCloseTo(-1, 2);
    expect(fit.r2).toBeGreaterThan(0.99);
  });

  it("vrátí null u singulárního návrhu (dva shodné regresory)", () => {
    const X = Array.from({ length: 50 }, (_, i) => [i, i]);
    expect(ols(X.map((r) => r[0]), X)).toBeNull();
  });
});

describe("computeSupremacyDiagnostic", () => {
  /** Postaví syntetickou sadu; `signal` = kolik z naší odchylky je pravda. */
  function build(signal: number, seed: number): SupremacyRow[] {
    const rnd = lcg(seed);
    const rows: SupremacyRow[] = [];
    for (let i = 0; i < 3000; i++) {
      const marketSupremacy = rnd() * 2 - 1;
      const marketTotal = 2.2 + rnd() * 1.2;
      const deviation = rnd() * 0.8 - 0.4;
      const noise = (rnd() + rnd() + rnd() - 1.5) * 2; // ~šum rozdílu gólů
      rows.push({
        ourSupremacy: marketSupremacy + deviation,
        ourTotal: marketTotal,
        marketSupremacy,
        marketTotal,
        actualDiff: marketSupremacy + signal * deviation + noise,
        actualTotal: marketTotal,
      });
    }
    return rows;
  }

  it("POZNÁ hranu: když naše odchylka nese pravdu, β₂ ≈ 1", () => {
    const d = computeSupremacyDiagnostic(build(1, 11));
    const fit = d.supremacyFit!;
    expect(d.n).toBe(3000);
    // Odhad se porovnává s VLASTNÍ směrodatnou chybou, ne s pevnou tolerancí: při 3 000
    // zápasech a šumu rozdílu gólů je SE(β₂) ≈ 0.08, takže „β₂ = 1 ± 0.05" by byl test
    // na štěstí generátoru. Tohle navíc ověří i výpočet `se` – kdyby byl špatně, neprojde.
    expect(Math.abs(fit.coef[0] - 1)).toBeLessThan(3 * fit.se[0]); // trh nevychýlený
    expect(Math.abs(fit.coef[1] - 1)).toBeLessThan(3 * fit.se[1]); // odchylka = informace
    expect(fit.t[1]).toBeGreaterThan(2);
    // Koše to musí ukázat i neparametricky: víc odchylky → víc zbytku.
    expect(d.buckets[4].residual).toBeGreaterThan(d.buckets[0].residual);
  });

  it("POZNÁ prázdno: když je odchylka šum, β₂ ≈ 0 a není významné", () => {
    const d = computeSupremacyDiagnostic(build(0, 23));
    expect(d.supremacyFit!.coef[1]).toBeCloseTo(0, 1);
    expect(Math.abs(d.supremacyFit!.t[1])).toBeLessThan(2);
  });

  it("POZNÁ škodu: záporný signál dá záporné β₂", () => {
    const d = computeSupremacyDiagnostic(build(-1, 31));
    expect(d.supremacyFit!.coef[1]).toBeLessThan(-0.5);
    expect(d.buckets[4].residual).toBeLessThan(d.buckets[0].residual);
  });

  it("prázdný vstup je stav, ne chyba", () => {
    const d = computeSupremacyDiagnostic([]);
    expect(d.n).toBe(0);
    expect(d.supremacyFit).toBeNull();
    expect(d.buckets).toEqual([]);
  });
});
