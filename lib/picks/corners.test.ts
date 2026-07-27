import { describe, expect, it } from "vitest";
import type { Metric, MetricValue, Venue } from "@/lib/types";
import {
  backtestCorners,
  cornerBaselineFor,
  cornerCalibration,
  dampenCornerTotal,
  dispersion,
  expectedCorners,
  overProb,
  predictCorners,
  DEFAULT_CORNER_TUNING,
  type CornerBaseline,
} from "./corners";
import type { HistoryMatch } from "./backtest";

/** Hodnoty metrik pro jednu stranu (stejné ve všech variantách, `sampleSize` volitelně). */
function values(
  vals: Partial<Record<Metric, number>>,
  sampleSize = 20
): MetricValue[] {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const out: MetricValue[] = [];
  for (const [metric, value] of Object.entries(vals)) {
    for (const venue of venues) {
      out.push({
        metric: metric as Metric,
        venue,
        value,
        lowConfidence: false,
        sampleSize,
        breakdown: [],
      });
    }
  }
  return out;
}

const BASE: CornerBaseline = { home: 5.5, away: 4.5 };

describe("overProb", () => {
  it("počítá P(celkem > linie) z Poissonovy distribuce", () => {
    // λ = 10, linie 9.5 → potřeba ≥ 10. Ověřeno proti ručně sečtenému chvostu.
    const p = overProb(10, 9.5);
    expect(p).toBeGreaterThan(0.53);
    expect(p).toBeLessThan(0.56);
  });

  it("roste s λ a klesá s linií", () => {
    expect(overProb(12, 10.5)).toBeGreaterThan(overProb(9, 10.5));
    expect(overProb(10, 8.5)).toBeGreaterThan(overProb(10, 12.5));
  });

  it("zůstává platnou pravděpodobností i v extrémech", () => {
    for (const [l, line] of [
      [1, 20.5],
      [15, 0.5],
    ] as const) {
      const p = overProb(l, line);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe("expectedCorners", () => {
  it("průměrný tým proti průměrnému dá přesně ligové měřítko", () => {
    // Tým zahrává tolik rohů, kolik je ligový průměr, a soupeř tolik inkasuje →
    // λ musí vyjít přesně `ref`. Stejná vlastnost, jakou má gólový model.
    const team = values({ CORNERS: 5.5 });
    const opp = values({ CORNERS_AGAINST: 5.5 });
    expect(expectedCorners(team, opp, true, BASE)).toBeCloseTo(5.5, 6);
  });

  it("hostující strana se poměřuje vlastním měřítkem", () => {
    const team = values({ CORNERS: 4.5 });
    const opp = values({ CORNERS_AGAINST: 4.5 });
    expect(expectedCorners(team, opp, false, BASE)).toBeCloseTo(4.5, 6);
  });

  it("silnější rohový tým proti děravější obraně dá vyšší λ", () => {
    const strong = values({ CORNERS: 8 });
    const leaky = values({ CORNERS_AGAINST: 7 });
    const average = values({ CORNERS: 5.5 });
    const solid = values({ CORNERS_AGAINST: 5.5 });
    expect(expectedCorners(strong, leaky, true, BASE)!).toBeGreaterThan(
      expectedCorners(average, solid, true, BASE)!
    );
  });

  it("malý vzorek stáhne odhad k lize (shrinkage)", () => {
    const many = values({ CORNERS: 9 }, 40);
    const few = values({ CORNERS: 9 }, 2);
    const opp = values({ CORNERS_AGAINST: 5.5 });
    const withMany = expectedCorners(many, opp, true, BASE)!;
    const withFew = expectedCorners(few, opp, true, BASE)!;
    expect(withFew).toBeLessThan(withMany);
    expect(withFew).toBeGreaterThan(BASE.home);
  });

  it("bez dat na obou stranách vrací null", () => {
    expect(expectedCorners(values({}), values({}), true, BASE)).toBeNull();
  });

  it("chybí-li jen jedna strana, dopočítá se ligovým průměrem", () => {
    const team = values({ CORNERS: 5.5 });
    expect(expectedCorners(team, values({}), true, BASE)).toBeCloseTo(5.5, 6);
  });
});

describe("dampenCornerTotal", () => {
  it("t = 1 je přesný no-op", () => {
    expect(dampenCornerTotal(6, 5, BASE, 1)).toEqual([6, 5]);
  });

  it("stlačí součet k lize a DRŽÍ rozdíl", () => {
    const [h, a] = dampenCornerTotal(8, 6, BASE, 0.5);
    // Součet 14 → ref 10 + (14 − 10) × 0.5 = 12; rozdíl zůstává 2.
    expect(h + a).toBeCloseTo(12, 6);
    expect(h - a).toBeCloseTo(2, 6);
  });

  it("nepřekročí meze rozumné pro rohy (ne pro góly)", () => {
    const [h, a] = dampenCornerTotal(14, 13, BASE, 1);
    // Meze gólového modelu (max 5) by tyhle úplně běžné hodnoty rozbily.
    expect(h).toBeGreaterThan(5);
    expect(a).toBeGreaterThan(5);
  });
});

describe("predictCorners", () => {
  it("skládá λ obou stran do součtu", () => {
    const p = predictCorners(
      values({ CORNERS: 5.5, CORNERS_AGAINST: 5.5 }),
      values({ CORNERS: 4.5, CORNERS_AGAINST: 4.5 }),
      BASE
    );
    expect(p.available).toBe(true);
    expect(p.lambdaTotal).toBeCloseTo(p.lambdaHome + p.lambdaAway, 9);
    expect(p.lambdaTotal).toBeCloseTo(10, 5);
  });

  it("bez dat hlásí nedostupnost místo falešného odhadu", () => {
    const p = predictCorners(values({}), values({}), BASE);
    expect(p.available).toBe(false);
  });
});

/** Historie: `n` zápasů dvou týmů s pevným počtem rohů (a jeden „cílový" na konci). */
function history(
  cornersHome: number,
  cornersAway: number,
  n = 12
): HistoryMatch[] {
  const out: HistoryMatch[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      fixtureId: i + 1,
      date: `2024-0${1 + Math.floor(i / 5)}-${String((i % 5) + 1).padStart(2, "0")}T18:00:00Z`,
      season: 2024,
      leagueId: 39,
      homeId: 1,
      awayId: 2,
      homeName: "A",
      awayName: "B",
      homeLogo: "",
      awayLogo: "",
      homeGoals: 1,
      awayGoals: 1,
      homeMetrics: { CORNERS: cornersHome },
      awayMetrics: { CORNERS: cornersAway },
    });
  }
  return out;
}

describe("backtestCorners", () => {
  it("je point-in-time: vlastní rohy zápasu do jeho predikce neprotečou", () => {
    // Týž zápas dvakrát, jednou s extrémním počtem rohů. Kdyby model koukal na
    // přítomnost, λ by se lišila – musí vyjít na bit stejně. (Srovnávat se sousedním
    // zápasem nejde: ten má o jeden zápas kratší historii, tedy jiný shrinkage.)
    const calm = history(5, 5, 10);
    const wild = history(5, 5, 10);
    wild[wild.length - 1].homeMetrics = { CORNERS: 30 };
    wild[wild.length - 1].awayMetrics = { CORNERS: 25 };

    const lastOf = (h: HistoryMatch[]) => {
      const out = backtestCorners(h, { seasons: [2024] });
      return out[out.length - 1];
    };
    const a = lastOf(calm);
    const b = lastOf(wild);
    expect(b.actualHome).toBe(30);
    expect(b.lambdaHome).toBe(a.lambdaHome);
    expect(b.lambdaAway).toBe(a.lambdaAway);
  });

  it("přeskočí zápasy bez zaznamenaných rohů i ten úplně první (nemá z čeho stavět)", () => {
    const rows = history(5, 5, 6);
    rows[3].homeMetrics = {};
    const out = backtestCorners(rows, { seasons: [2024] });
    expect(out.some((r) => r.fixtureId === 4)).toBe(false);
    // 6 zápasů − 1 bez rohů − 1 úvodní (žádná předchozí data → `available: false`).
    expect(out.length).toBe(4);
    expect(out.some((r) => r.fixtureId === 1)).toBe(false);
  });

  it("skutečnost bere z obou stran", () => {
    const out = backtestCorners(history(7, 3, 6), { seasons: [2024] });
    expect(out[0].actualHome).toBe(7);
    expect(out[0].actualAway).toBe(3);
    expect(out[0].actualTotal).toBe(10);
  });

  it("respektuje minMatches", () => {
    const out = backtestCorners(history(5, 5, 8), { seasons: [2024], minMatches: 5 });
    // Prvních pět zápasů nemá u obou týmů dost historie.
    expect(out.length).toBe(3);
  });
});

describe("cornerBaselineFor", () => {
  it("počítá měřítko z PŘEDCHOZÍ sezóny (žádný leak z hodnocené)", () => {
    const prev = history(6, 4, 60).map((m) => ({ ...m, season: 2023 }));
    const cur = history(12, 12, 60).map((m) => ({
      ...m,
      season: 2024,
      fixtureId: m.fixtureId + 1000,
    }));
    const b = cornerBaselineFor([...prev, ...cur], 39, 2024);
    expect(b.home).toBeCloseTo(6, 6);
    expect(b.away).toBeCloseTo(4, 6);
  });

  it("bez dostatečné historie spadne na default", () => {
    const b = cornerBaselineFor(history(6, 4, 10), 39, 2024);
    expect(b).toEqual({ home: 5.5, away: 4.5 });
  });
});

describe("cornerCalibration", () => {
  const row = (lambdaTotal: number, actualTotal: number) => ({
    fixtureId: 1,
    leagueId: 39,
    season: 2024,
    kickoff: "2024-01-01T00:00:00Z",
    homeName: "A",
    awayName: "B",
    lambdaHome: lambdaTotal / 2,
    lambdaAway: lambdaTotal / 2,
    lambdaTotal,
    actualHome: actualTotal,
    actualAway: 0,
    actualTotal,
  });

  it("spočítá základní míru a laťku konstanty", () => {
    const rows = [row(10, 12), row(10, 8), row(10, 14), row(10, 4)];
    const c = cornerCalibration(rows, 10.5);
    expect(c.n).toBe(4);
    expect(c.baseRate).toBeCloseTo(0.5, 6);
    // Konstanta 50 % na binárním jevu → log-loss ln(2).
    expect(c.baseLogloss).toBeCloseTo(Math.log(2), 6);
  });

  it("dokonalá predikce má ECE u nuly", () => {
    // λ tak nízká/vysoká, že P(over) je prakticky 0/1 – a přesně tak to dopadne.
    const rows = [row(2, 3), row(2, 4), row(25, 25), row(25, 30)];
    const c = cornerCalibration(rows, 10.5);
    expect(c.ece!).toBeLessThan(0.01);
    expect(c.logloss).toBeLessThan(c.baseLogloss);
  });

  it("systematicky mimo predikce dají vysoké ECE", () => {
    // Model tvrdí „skoro jistě přes", realita je pod.
    const rows = [row(25, 2), row(25, 3), row(25, 1), row(25, 4)];
    const c = cornerCalibration(rows, 10.5);
    expect(c.ece!).toBeGreaterThan(0.9);
  });

  it("prázdný vstup nespadne", () => {
    const c = cornerCalibration([], 10.5);
    expect(c.n).toBe(0);
    expect(c.ece).toBeNull();
  });
});

describe("dispersion", () => {
  it("Poissonovská data mají poměr kolem 1", () => {
    // Rozdělení s ⌀ = rozptyl = 4 (idealizované).
    const totals = [2, 2, 4, 4, 6, 6];
    const rows = totals.map((t) => ({
      fixtureId: 1,
      leagueId: 39,
      season: 2024,
      kickoff: "2024-01-01T00:00:00Z",
      homeName: "A",
      awayName: "B",
      lambdaHome: 2,
      lambdaAway: 2,
      lambdaTotal: 4,
      actualHome: t,
      actualAway: 0,
      actualTotal: t,
    }));
    const d = dispersion(rows);
    expect(d.mean).toBeCloseTo(4, 6);
    expect(d.ratio).toBeCloseTo(d.variance / d.mean, 9);
  });

  it("prázdný vstup nespadne", () => {
    expect(dispersion([]).ratio).toBe(0);
  });
});

describe("DEFAULT_CORNER_TUNING", () => {
  it("tlumí součet λ silněji než gólový model (fitnuto backtestem)", () => {
    // Bez útlumu byl model na rozích horší než konstanta na VŠECH liniích. Kdyby se
    // někdo vrátil k `1`, tenhle test to chytí dřív, než se to projeví v predikcích.
    expect(DEFAULT_CORNER_TUNING.totalSpread).toBe(0.3);
    expect(DEFAULT_CORNER_TUNING.totalSpread).toBeLessThan(0.5);
  });

  it("útlum reálně zužuje rozptyl pravděpodobností", () => {
    const strong = values({ CORNERS: 8, CORNERS_AGAINST: 7 });
    const weak = values({ CORNERS: 3, CORNERS_AGAINST: 3 });
    const damped = predictCorners(strong, weak, BASE, DEFAULT_CORNER_TUNING);
    const raw = predictCorners(strong, weak, BASE, {
      base: DEFAULT_CORNER_TUNING.base,
      totalSpread: 1,
    });
    const ref = BASE.home + BASE.away;
    expect(Math.abs(damped.lambdaTotal - ref)).toBeLessThan(
      Math.abs(raw.lambdaTotal - ref)
    );
  });
});
