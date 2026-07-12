import { describe, expect, it } from "vitest";
import type { Metric, MetricValue, TeamComparison, Venue } from "@/lib/types";
import {
  predictMatch,
  dampenTotal,
  drawTau,
  gridProbs,
  poissonVector,
  sharpenLambdas,
  PREDICT_PARAMS,
} from "./predict";

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

/** Tým s hodnotami per varianta (nový model čte venue vůči ligovému měřítku). */
function teamAt(
  home: Partial<Record<Metric, number>>,
  away: Partial<Record<Metric, number>>
): TeamComparison {
  const values: MetricValue[] = [];
  const push = (venue: Venue, vals: Partial<Record<Metric, number>>) => {
    for (const [metric, value] of Object.entries(vals)) {
      values.push({
        metric: metric as Metric,
        venue,
        value,
        lowConfidence: false,
        sampleSize: 10,
        breakdown: [],
      });
    }
  };
  push("HOME", home);
  push("AWAY", away);
  return { team: { id: 1, name: "T", logoUrl: "", country: "" }, values, summary: [] };
}

/** Ligově průměrný tým: doma dává/dostává přesně tolik co průměr ligy, venku taky. */
const AVERAGE_HOME = { GOALS_FOR: 1.5, GOALS_AGAINST: 1.2 }; // doma dá 1.5, dostane 1.2
const AVERAGE_AWAY = { GOALS_FOR: 1.2, GOALS_AGAINST: 1.5 }; // venku dá 1.2, dostane 1.5

describe("predictMatch", () => {
  it("dva ligově průměrné týmy → λ = ligové měřítko (domácí výhoda z něj)", () => {
    // Nový model normalizuje sílu vůči lize, takže průměrný pár dá přesně ligový průměr:
    // 1.5 : 1.2. Domácí výhoda je v tom rozdílu – λ ji nepřidává zvlášť.
    const a = teamAt(AVERAGE_HOME, AVERAGE_AWAY);
    const b = teamAt(AVERAGE_HOME, AVERAGE_AWAY);
    const p = predictMatch(a, b);
    expect(p.lambdaHome).toBeCloseTo(1.5, 6);
    expect(p.lambdaAway).toBeCloseTo(1.2, 6);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 5);
    expect(p.homeWin).toBeGreaterThan(p.awayWin);
  });

  it("shrinkage: malý vzorek stáhne sílu k ligovému průměru", () => {
    const strong = (sample: number): TeamComparison => ({
      team: { id: 1, name: "T", logoUrl: "", country: "" },
      values: [
        { metric: "GOALS_FOR", venue: "HOME", value: 3.0, lowConfidence: false, sampleSize: sample, breakdown: [] },
        { metric: "GOALS_AGAINST", venue: "HOME", value: 1.2, lowConfidence: false, sampleSize: sample, breakdown: [] },
      ],
      summary: [],
    });
    const opponent = teamAt(AVERAGE_HOME, AVERAGE_AWAY);
    // Bez útlumu součtu (t=1), ať test měří jen shrinkage.
    const lam = (sample: number) =>
      predictMatch(strong(sample), opponent, {
        tuning: { shrinkMatches: 6, strength: 1, totalSpread: 1 },
      }).lambdaHome;
    // Stejná syrová čísla (3.0 gólu doma), jiný vzorek: z dvou zápasů model nevěří, z třiceti ano.
    expect(lam(2)).toBeLessThan(lam(30));
    expect(lam(2)).toBeLessThan(2.4);
    expect(lam(30)).toBeGreaterThan(2.6);
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

  it("ukládaná λ jsou ZÁKLADNÍ (před zostřením) – z nich jde predikci přepočítat", () => {
    const p = predictMatch(
      team({ GOALS_FOR: 2.4, GOALS_AGAINST: 0.9 }),
      team({ GOALS_FOR: 0.8, GOALS_AGAINST: 2.2 })
    );
    // Aktuálně sharpen = 1 (no-op) → zobrazovaná i základní λ jsou shodné…
    expect(p.lambdaHomeBase).toBeCloseTo(p.lambdaHome, 10);
    // …a mřížka nad základními λ musí reprodukovat uložené pravděpodobnosti (to je
    // celý smysl: `reprice` počítá totéž z DB řádku, aniž by cokoli fetchoval).
    const g = gridProbs(p.lambdaHomeBase, p.lambdaAwayBase);
    expect(g.homeWin).toBeCloseTo(p.homeWin, 10);
    expect(g.draw).toBeCloseTo(p.draw, 10);
    expect(g.awayWin).toBeCloseTo(p.awayWin, 10);
    expect(g.over25).toBeCloseTo(p.over25, 10);
    expect(g.bttsYes).toBeCloseTo(p.bttsYes, 10);
  });

  it("post-parametry (ρ, zostření) mění mřížku, ne λ → přepočet je čistá matematika", () => {
    const base: [number, number] = [1.9, 1.0];
    const now = gridProbs(...base, PREDICT_PARAMS);
    const sharper = gridProbs(...base, { rho: PREDICT_PARAMS.rho, sharpen: 2 });
    const flatter = gridProbs(...base, { rho: -0.25, sharpen: 1 });

    // Zostření: favorit dostane víc, součet pravděpodobností drží.
    expect(sharper.homeWin).toBeGreaterThan(now.homeWin);
    expect(sharper.homeWin + sharper.draw + sharper.awayWin).toBeCloseTo(1, 5);
    // Zostření drží součet λ (celkové góly) → Over 2.5 se skoro nehne.
    expect(sharper.lambdaHome + sharper.lambdaAway).toBeCloseTo(base[0] + base[1], 10);
    expect(sharper.over25).toBeCloseTo(now.over25, 2);
    // Zápornější ρ → víc remíz.
    expect(flatter.draw).toBeGreaterThan(now.draw);
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

describe("sharpenLambdas", () => {
  it("s = 1 je přesný no-op", () => {
    expect(sharpenLambdas(1.8, 1.0, 1)).toEqual([1.8, 1.0]);
  });

  it("zachovává součet λ (celkové góly)", () => {
    const [lh, la] = sharpenLambdas(1.8, 1.0, 1.5);
    expect(lh + la).toBeCloseTo(2.8); // 1.8 + 1.0
  });

  it("s > 1 zostří rozdíl: favorit nahoru, slabší dolů", () => {
    const [lh, la] = sharpenLambdas(1.8, 1.0, 1.5);
    // D = (1.8−1.0)×1.5 = 1.2 → lh = (2.8+1.2)/2 = 2.0, la = (2.8−1.2)/2 = 0.8
    expect(lh).toBeCloseTo(2.0);
    expect(la).toBeCloseTo(0.8);
    expect(lh).toBeGreaterThan(1.8);
    expect(la).toBeLessThan(1.0);
  });

  it("symetrický zápas zůstane symetrický (nulový rozdíl)", () => {
    expect(sharpenLambdas(1.4, 1.4, 2)).toEqual([1.4, 1.4]);
  });

  it("clampuje do [MIN, MAX] při extrémním zostření", () => {
    const [lh, la] = sharpenLambdas(2.5, 0.5, 5);
    expect(lh).toBeLessThanOrEqual(5);
    expect(la).toBeGreaterThanOrEqual(0.2);
  });
});

describe("predictMatch – LAMBDA_SHARPEN no-op (default)", () => {
  it("default (s=1) → λ = ligové měřítko × síla útoku × slabost obrany (bez zostření)", () => {
    // Bez shrinkage (k=0) je vzorec čitelný: λ_home = 1.5 × (2.4/1.5) × (1.8/1.5) = 2.88.
    const home = teamAt({ GOALS_FOR: 2.4, GOALS_AGAINST: 1.2 }, AVERAGE_AWAY);
    const away = teamAt(AVERAGE_HOME, { GOALS_FOR: 1.2, GOALS_AGAINST: 1.8 });
    const p = predictMatch(home, away, {
      // Bez útlumu součtu (t=1), ať je vidět holý vzorec λ.
      tuning: { shrinkMatches: 0, strength: 1, totalSpread: 1 },
    });
    expect(p.lambdaHome).toBeCloseTo(1.5 * (2.4 / 1.5) * (1.8 / 1.5), 6);
    // Hosté průměrní proti průměrné domácí obraně → λ = ligové měřítko hostů.
    expect(p.lambdaAway).toBeCloseTo(1.2, 6);
    // Zostření je no-op → zobrazená λ = základní λ.
    expect(p.lambdaHomeBase).toBeCloseTo(p.lambdaHome, 10);
  });
});

describe("dampenTotal (útlum rozptylu součtu λ)", () => {
  const baseline = { home: 1.5, away: 1.2 }; // ref = 2.7 gólu na zápas

  it("t = 1 → no-op", () => {
    expect(dampenTotal(2.0, 1.4, baseline, 1)).toEqual([2.0, 1.4]);
  });

  it("drží ROZDÍL λ a stlačuje jen součet → 1X2 se nemění, Over 2.5 ano", () => {
    const [h, a] = dampenTotal(2.4, 1.4, baseline, 0.5); // součet 3.8, ref 2.7
    expect(h - a).toBeCloseTo(2.4 - 1.4, 10); // rozdíl beze změny
    expect(h + a).toBeCloseTo(2.7 + (3.8 - 2.7) * 0.5, 10); // součet stažený k lize
  });

  it("gólově chudý zápas se naopak přitáhne NAHORU k ligovému průměru", () => {
    const [h, a] = dampenTotal(1.0, 0.8, baseline, 0.5); // součet 1.8 < ref
    expect(h + a).toBeGreaterThan(1.8);
    expect(h + a).toBeCloseTo(2.7 + (1.8 - 2.7) * 0.5, 10);
  });

  it("zápas přesně na ligovém průměru se nehne", () => {
    const [h, a] = dampenTotal(1.5, 1.2, baseline, 0.5);
    expect(h).toBeCloseTo(1.5, 10);
    expect(a).toBeCloseTo(1.2, 10);
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
