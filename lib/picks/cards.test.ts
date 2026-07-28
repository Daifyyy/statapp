import { describe, expect, it } from "vitest";
import type { Metric, MetricValue, Venue } from "@/lib/types";
import {
  backtestCards,
  buildRefereeIndex,
  cardBaselineFor,
  cardCalibration,
  cardCount,
  dampenCardTotal,
  expectedCards,
  predictCards,
  refereeFactor,
  refereeSpread,
  DEFAULT_CARD_TUNING,
  type CardBaselines,
  type CardRow,
  type RefereeMatch,
} from "./cards";
import type { HistoryMatch } from "./backtest";

/** Hodnoty metrik pro jednu stranu (stejné ve všech variantách). */
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

const BASE: CardBaselines = {
  cards: { home: 2.0, away: 2.4 },
  fouls: { home: 10.8, away: 11.3 },
};

describe("cardCount", () => {
  it("sečte žluté a červené", () => {
    expect(cardCount(3, 1)).toBe(4);
    expect(cardCount(2, 0)).toBe(2);
  });

  it("váha červené je parametr (konvence knih se liší)", () => {
    expect(cardCount(3, 1, 2)).toBe(5);
    expect(cardCount(3, 1, 2.5)).toBe(5.5);
  });
});

describe("refereeFactor", () => {
  const ref = (date: string, cards: number): RefereeMatch => ({
    date,
    cards,
    expected: 4,
  });

  it("je POINT-IN-TIME: pozdější zápasy do faktoru nevstupují", () => {
    const matches = [
      ref("2024-01-01", 8),
      ref("2024-01-08", 8),
      // Tenhle je PO datu predikce – kdyby se započítal, faktor by klesl.
      ref("2024-06-01", 0),
    ];
    const before = refereeFactor(matches, "2024-02-01", 0);
    const after = refereeFactor(matches, "2024-12-01", 0);
    expect(before.sample).toBe(2);
    expect(after.sample).toBe(3);
    expect(before.factor).toBeGreaterThan(after.factor);
  });

  it("bez shrinkage vrací hrubý poměr skutečnost / očekávání", () => {
    // 3 zápasy po 5 kartách při očekávání 4 → 15/12 = 1.25
    const m = [ref("2024-01-01", 5), ref("2024-01-02", 5), ref("2024-01-03", 5)];
    expect(refereeFactor(m, "2024-06-01", 0).factor).toBeCloseTo(1.25, 10);
  });

  it("shrinkage táhne malý vzorek k 1", () => {
    const one = [ref("2024-01-01", 5)]; // hrubý poměr 1.25
    const raw = refereeFactor(one, "2024-06-01", 0).factor;
    const shrunk = refereeFactor(one, "2024-06-01", 10).factor;
    expect(raw).toBeCloseTo(1.25, 10);
    // (1·1.25 + 10·1) / (1 + 10) = 1.0227
    expect(shrunk).toBeCloseTo(11.25 / 11, 10);
    expect(shrunk).toBeLessThan(raw);
  });

  it("velký vzorek shrinkage skoro nezmenší", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      ref(`2024-01-${String((i % 28) + 1).padStart(2, "0")}`, 5)
    );
    // hrubý poměr 5/4 = 1.25; se 200 zápasy a k=10 zůstane skoro tam
    expect(refereeFactor(many, "2025-01-01", 10).factor).toBeGreaterThan(1.23);
  });

  it("weight = 0 je přesná ablace (faktor 1), ale vzorek se pořád hlásí", () => {
    const m = [ref("2024-01-01", 8), ref("2024-01-02", 8)];
    const off = refereeFactor(m, "2024-06-01", 10, 0);
    expect(off.factor).toBe(1);
    expect(off.sample).toBe(2);
  });

  it("weight škáluje odchylku od 1, ne obchází shrinkage", () => {
    const m = [ref("2024-01-01", 6), ref("2024-01-02", 6)];
    const full = refereeFactor(m, "2024-06-01", 2, 1).factor;
    const half = refereeFactor(m, "2024-06-01", 2, 0.5).factor;
    expect(half).toBeCloseTo(1 + (full - 1) * 0.5, 10);
  });

  it("neznámý rozhodčí i prázdná historie dají neutrální faktor", () => {
    expect(refereeFactor([], "2024-06-01", 10).factor).toBe(1);
    expect(refereeFactor([], "2024-06-01", 10).sample).toBe(0);
  });

  it("extrém z malého vzorku je clampnutý", () => {
    const crazy = Array.from({ length: 50 }, (_, i) => ref(`2024-01-01`, 40 + i));
    expect(refereeFactor(crazy, "2025-01-01", 0).factor).toBeLessThanOrEqual(1.5);
    const soft = Array.from({ length: 50 }, () => ref("2024-01-01", 0));
    expect(refereeFactor(soft, "2025-01-01", 0).factor).toBeGreaterThanOrEqual(0.65);
  });
});

describe("expectedCards", () => {
  it("průměrný tým proti průměrnému dá ligové měřítko", () => {
    // Baseline bez home/away rozpadu – `values()` dává stejné číslo do všech variant,
    // takže „průměrný tým" znamená jen tady rovnost s ligou na obou stranách.
    const flat: CardBaselines = {
      cards: { home: 2.2, away: 2.2 },
      fouls: { home: 11, away: 11 },
    };
    const avg = values({ CARDS: 2.2, CARDS_AGAINST: 2.2 });
    expect(expectedCards(avg, avg, true, flat)!).toBeCloseTo(2.2, 5);
    expect(expectedCards(avg, avg, false, flat)!).toBeCloseTo(2.2, 5);
  });

  it("faulující tým dostane víc karet", () => {
    const dirty = values({ CARDS: 3.5, CARDS_AGAINST: 2.2 });
    const clean = values({ CARDS: 1.2, CARDS_AGAINST: 2.2 });
    const opp = values({ CARDS: 2.2, CARDS_AGAINST: 2.2 });
    expect(expectedCards(dirty, opp, true, BASE)!).toBeGreaterThan(
      expectedCards(clean, opp, true, BASE)!
    );
  });

  it("soupeř, který karty VYVOLÁVÁ, zvedne λ druhé strany", () => {
    const team = values({ CARDS: 2.2, CARDS_AGAINST: 2.2 });
    const provoker = values({ CARDS: 2.2, CARDS_AGAINST: 3.5 });
    const calm = values({ CARDS: 2.2, CARDS_AGAINST: 1.2 });
    expect(expectedCards(team, provoker, true, BASE)!).toBeGreaterThan(
      expectedCards(team, calm, true, BASE)!
    );
  });

  it("bez dat na obou stranách vrací null", () => {
    expect(expectedCards([], [], true, BASE)).toBeNull();
  });

  it("chybí-li jedna strana, dopočítá se ligovým průměrem", () => {
    const only = values({ CARDS: 2.2 });
    expect(expectedCards(only, [], true, BASE)).not.toBeNull();
  });
});

describe("dampenCardTotal", () => {
  it("t = 1 je přesný no-op", () => {
    expect(dampenCardTotal(3, 2, BASE.cards, 1)).toEqual([3, 2]);
  });

  it("drží ROZDÍL a stlačuje SOUČET k ligovému průměru", () => {
    const [h, a] = dampenCardTotal(4, 2, BASE.cards, 0.5);
    expect(h - a).toBeCloseTo(2, 10); // rozdíl beze změny
    const ref = BASE.cards.home + BASE.cards.away;
    expect(h + a).toBeCloseTo(ref + (6 - ref) * 0.5, 10);
  });

  it("t = 0 predikuje přesně ligový průměr (při nulovém rozdílu)", () => {
    const [h, a] = dampenCardTotal(3, 3, BASE.cards, 0);
    expect(h + a).toBeCloseTo(BASE.cards.home + BASE.cards.away, 10);
  });
});

describe("predictCards", () => {
  const avg = values({ CARDS: 2.2, CARDS_AGAINST: 2.2 });

  it("faktor rozhodčího λ násobí a nese se na výstupu", () => {
    const neutral = predictCards(avg, avg, { factor: 1, sample: 30 }, BASE);
    const strict = predictCards(avg, avg, { factor: 1.25, sample: 30 }, BASE);
    expect(strict.lambdaTotal).toBeCloseTo(neutral.lambdaTotal * 1.25, 6);
    expect(strict.refereeFactor).toBe(1.25);
    expect(strict.refereeSample).toBe(30);
  });

  it("rozhodčí se aplikuje AŽ ZA útlumem součtu, takže ho útlum nesmaže", () => {
    // Při t = 0 je týmová část přesně ligový průměr; faktor sudího ho musí pořád zvednout.
    const tuning = { ...DEFAULT_CARD_TUNING, totalSpread: 0 };
    const p = predictCards(avg, avg, { factor: 1.3, sample: 50 }, BASE, tuning);
    expect(p.lambdaTotal).toBeCloseTo((BASE.cards.home + BASE.cards.away) * 1.3, 6);
  });

  it("bez dat vrací available:false", () => {
    const p = predictCards([], [], { factor: 1, sample: 0 }, BASE);
    expect(p.available).toBe(false);
    expect(p.lambdaTotal).toBe(0);
  });
});

// ── Backtest nad malou syntetickou historií ──────────────────────────────────────────

function hm(over: Partial<HistoryMatch>): HistoryMatch {
  return {
    fixtureId: 1,
    date: "2024-08-10T18:00:00+00:00",
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
    ...over,
  };
}

/**
 * Historie: dva týmy hrají dokola. Karty **kolísají** (jinak by základní míra vyšla 0
 * nebo 1 a kalibrace by neměla co měřit), ale s přesnými průměry 2 doma / 3 venku.
 * Sezóna má **≥ 50 zápasů**, jinak `cardBaselineFor` spadne na default a rozladí λ.
 */
const HOME_CARDS = [1, 2, 3];
const AWAY_CARDS = [2, 3, 4];

function history(): HistoryMatch[] {
  const out: HistoryMatch[] = [];
  let id = 1;
  for (const season of [2023, 2024]) {
    for (let i = 0; i < 60; i++) {
      const homeFirst = i % 2 === 0;
      out.push(
        hm({
          fixtureId: id++,
          season,
          date: `${season}-${String((i % 11) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}T18:00:00+00:00`,
          homeId: homeFirst ? 1 : 2,
          awayId: homeFirst ? 2 : 1,
          referee: i % 3 === 0 ? "SudiA" : "SudiB",
          homeMetrics: { CARDS: HOME_CARDS[i % 3] },
          awayMetrics: { CARDS: AWAY_CARDS[i % 3] },
        })
      );
    }
  }
  return out;
}

describe("backtestCards", () => {
  it("vydá řádky s predikcí i skutečností a nese jméno sudího", () => {
    const rows = backtestCards(history(), { seasons: [2024] });
    expect(rows.length).toBeGreaterThan(20);
    const r = rows[rows.length - 1];
    expect(r.actualTotal).toBe(r.actualHome + r.actualAway);
    expect(r.lambdaTotal).toBeGreaterThan(0);
    // Na řádku je NORMALIZOVANÉ jméno – podle něj se řádky seskupují.
    expect(["sudia", "sudib"]).toContain(r.referee);
  });

  it("zápasy bez karet se přeskočí (nemá se co měřit)", () => {
    const h = history().map((m) => ({ ...m, homeMetrics: {}, awayMetrics: {} }));
    expect(backtestCards(h, { seasons: [2024] })).toEqual([]);
  });

  it("na stabilní historii sedí λ na skutečnost", () => {
    // Bez rozhodčího – tenhle test má ověřit TÝMOVOU část λ. Sudí je v tomhle fixture
    // svázaný s výší karet (`i % 3` řídí obojí), takže by do průměru vnesl vlastní posun.
    const rows = backtestCards(history(), {
      seasons: [2024],
      minMatches: 10,
      tuning: { ...DEFAULT_CARD_TUNING, refereeWeight: 0 },
    });
    const avgL = rows.reduce((a, r) => a + r.lambdaTotal, 0) / rows.length;
    const avgA = rows.reduce((a, r) => a + r.actualTotal, 0) / rows.length;
    expect(avgL).toBeCloseTo(avgA, 1);
  });
});

describe("buildRefereeIndex", () => {
  it("zápas bez jména sudího, bez karet nebo bez očekávání do indexu nepatří", () => {
    const h = [
      hm({ fixtureId: 1, referee: "X", homeMetrics: { CARDS: 2 }, awayMetrics: { CARDS: 3 } }),
      hm({ fixtureId: 2, homeMetrics: { CARDS: 2 }, awayMetrics: { CARDS: 3 } }), // bez sudího
      hm({ fixtureId: 3, referee: "X" }), // bez karet
      // Se sudím i kartami, ale týmový model pro něj λ nemá (start historie).
      hm({ fixtureId: 4, referee: "X", homeMetrics: { CARDS: 1 }, awayMetrics: { CARDS: 1 } }),
    ];
    const idx = buildRefereeIndex(h, (id) => (id === 1 ? 4.5 : undefined));
    expect(idx.get("x")).toHaveLength(1);
    expect(idx.get("x")![0].cards).toBe(5);
    expect(idx.get("x")![0].expected).toBe(4.5);
  });

  it("sjednotí zápis jména napříč zdroji do JEDNOHO sudího", () => {
    // API-Football píše „R. Jones", football-data „R Jones". Bez sjednocení by se týž
    // rozhodčí rozpadl na dvě identity a každá by dostala půlku vzorku.
    const h = [
      hm({ fixtureId: 1, referee: "R. Jones", homeMetrics: { CARDS: 2 }, awayMetrics: { CARDS: 2 } }),
      hm({ fixtureId: 2, referee: "R Jones", homeMetrics: { CARDS: 3 }, awayMetrics: { CARDS: 3 } }),
      hm({ fixtureId: 3, referee: "M. Metoğlu", homeMetrics: { CARDS: 1 }, awayMetrics: { CARDS: 1 } }),
      hm({ fixtureId: 4, referee: "M. Metoglu", homeMetrics: { CARDS: 4 }, awayMetrics: { CARDS: 4 } }),
    ];
    const idx = buildRefereeIndex(h, () => 4);
    expect(idx.size).toBe(2);
    expect(idx.get("r jones")).toHaveLength(2);
    expect(idx.get("m metoglu")).toHaveLength(2); // diakritika taky
  });

  it("jmenovatel je λ TÝMOVÉHO modelu, ne ligový průměr", () => {
    // Sudí, kterému los nadělil karetně bohaté zápasy, nesmí vyjít jako přísný:
    // ukázal 6 karet tam, kde se od těch týmů 6 karet čekalo → faktor přesně 1.
    const h = [
      hm({ fixtureId: 1, referee: "Derby", homeMetrics: { CARDS: 3 }, awayMetrics: { CARDS: 3 } }),
    ];
    const idx = buildRefereeIndex(h, () => 6);
    const f = refereeFactor(idx.get("derby")!, "2030-01-01", 0);
    expect(f.factor).toBeCloseTo(1, 10);
  });
});

describe("cardBaselineFor", () => {
  it("bere PŘEDCHOZÍ sezónu, aby do predikce neprotekl hodnocený ročník", () => {
    const b = cardBaselineFor(history(), 39, 2024);
    expect(b.cards.home).toBeCloseTo(2, 6);
    expect(b.cards.away).toBeCloseTo(3, 6);
  });

  it("bez dost historie spadne na default", () => {
    expect(cardBaselineFor([], 39, 2024).cards).toEqual({ home: 1.9, away: 2.2 });
  });
});

describe("refereeSpread", () => {
  const row = (referee: string | null, actualTotal: number): CardRow => ({
    fixtureId: 1,
    leagueId: 39,
    season: 2024,
    kickoff: "2024-08-10",
    homeName: "A",
    awayName: "B",
    referee,
    lambdaHome: 2,
    lambdaAway: 2,
    lambdaTotal: 4,
    refereeFactor: 1,
    refereeSample: 10,
    varianceRatio: 1,
    actualHome: 2,
    actualAway: actualTotal - 2,
    actualTotal,
  });

  it("spočte rozpětí mezi sudími a ignoruje ty s málo zápasy", () => {
    const rows = [
      ...Array.from({ length: 25 }, () => row("Přísný", 6)),
      ...Array.from({ length: 25 }, () => row("Mírný", 2)),
      ...Array.from({ length: 3 }, () => row("Nový", 12)), // pod prahem → nepočítá se
      ...Array.from({ length: 5 }, () => row(null, 4)), // bez jména
    ];
    const s = refereeSpread(rows, 20);
    expect(s.count).toBe(2);
    expect(s.min).toBeCloseTo(2, 6);
    expect(s.max).toBeCloseTo(6, 6);
    expect(s.sd).toBeCloseTo(2, 6);
  });

  it("bez rozhodčích vrátí nuly, ne pád", () => {
    const s = refereeSpread([row(null, 4)], 20);
    expect(s.count).toBe(0);
  });
});

describe("cardCalibration", () => {
  it("kalibruje linii a srovnává s konstantou", () => {
    const rows = backtestCards(history(), { seasons: [2024], minMatches: 5 });
    const c = cardCalibration(rows, 4.5);
    expect(c.n).toBe(rows.length);
    expect(c.logloss).toBeGreaterThan(0);
    // Karty ve fixture kolísají (3 / 5 / 7), takže základní míra leží mezi 0 a 1
    // a konstanta je smysluplná laťka – u konstantních dat by vyšla 0 a nic neměřila.
    expect(c.baseRate).toBeGreaterThan(0);
    expect(c.baseRate).toBeLessThan(1);
    expect(c.baseLogloss).toBeGreaterThan(0);
  });
});
