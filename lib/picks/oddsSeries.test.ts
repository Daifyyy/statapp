import { describe, expect, it } from "vitest";
import type { BookOdds } from "@/lib/data/apiFootball";
import {
  appendPoint,
  closingPoint,
  lateMove,
  parseSeries,
  pointProbs,
  seriesDrift,
  seriesDue,
  seriesPointFrom,
  snapshotIntervalMinutes,
  snapshotPlan,
  MAX_SERIES_POINTS,
  type OddsSeriesPoint,
} from "./oddsSeries";

const book = (name: string, o: Partial<BookOdds>): BookOdds => ({
  id: 0,
  name,
  home: null,
  draw: null,
  away: null,
  over25: null,
  under25: null,
  btts: null,
  bttsNo: null,
  ...o,
});

describe("kadence", () => {
  it("se zužuje směrem k výkopu", () => {
    expect(snapshotIntervalMinutes(48)).toBe(720);
    expect(snapshotIntervalMinutes(12)).toBe(180);
    expect(snapshotIntervalMinutes(2)).toBe(60);
    // Monotónní: blíž k výkopu nikdy řidčeji.
    for (const h of [72, 30, 24, 10, 6, 3, 1]) {
      expect(snapshotIntervalMinutes(h)).toBeLessThanOrEqual(snapshotIntervalMinutes(h + 1));
    }
  });

  it("první bod je vždy na řadě, další až po intervalu", () => {
    expect(seriesDue(48, null)).toBe(true);
    expect(seriesDue(48, 60)).toBe(false); // 12h interval daleko od výkopu
    expect(seriesDue(48, 720)).toBe(true);
    expect(seriesDue(2, 60)).toBe(true); // hodinový interval u výkopu
    expect(seriesDue(2, 30)).toBe(false);
  });

  it("po výkopu se už nesnímá (byly by to živé kurzy)", () => {
    expect(seriesDue(0, null)).toBe(false);
    expect(seriesDue(-1, 999)).toBe(false);
  });

  it("malá tolerance, aby běh o minutu dřív bod nepřeskočil", () => {
    expect(seriesDue(2, 56)).toBe(true); // 60 − 5 min tolerance
    expect(seriesDue(2, 50)).toBe(false);
  });
});

describe("snapshotPlan", () => {
  const kickoff = new Date("2026-08-10T19:00:00Z");
  const at = (hoursBefore: number) =>
    new Date(kickoff.getTime() - hoursBefore * 3_600_000);
  const state = (over: Partial<Parameters<typeof snapshotPlan>[0]> = {}) => ({
    kickoff,
    oddsFetchedAt: null,
    oddsCloseAt: null,
    oddsSeriesAt: null,
    ...over,
  });

  it("první dotek zápasu udělá otevírací snímek I bod řady jedním fetchem", () => {
    const p = snapshotPlan(state(), at(48), 3);
    expect(p).toEqual({ fetch: true, open: true, close: false, series: true });
  });

  it("blízko výkopu udělá zavírací snímek i bod řady", () => {
    const p = snapshotPlan(state({ oddsFetchedAt: at(48), oddsSeriesAt: at(48) }), at(2), 3);
    expect(p).toEqual({ fetch: true, open: false, close: true, series: true });
  });

  it("otevírací a zavírací snímek zůstávají JEDEN za život", () => {
    const done = state({ oddsFetchedAt: at(48), oddsCloseAt: at(3), oddsSeriesAt: at(0.5) });
    const p = snapshotPlan(done, at(0.4), 3);
    expect(p.open).toBe(false);
    expect(p.close).toBe(false);
  });

  it("když není potřeba nic, NEFETCHUJE se", () => {
    const s = state({ oddsFetchedAt: at(48), oddsSeriesAt: at(47.5) });
    expect(snapshotPlan(s, at(47), 3).fetch).toBe(false);
  });

  it("po výkopu se nedělá nic", () => {
    const p = snapshotPlan(state(), new Date(kickoff.getTime() + 60_000), 3);
    expect(p.fetch).toBe(false);
  });

  it("zavírací okno se řídí parametrem, ne konstantou v modulu", () => {
    const s = state({ oddsFetchedAt: at(48), oddsSeriesAt: at(5) });
    expect(snapshotPlan(s, at(4), 3).close).toBe(false);
    expect(snapshotPlan(s, at(4), 6).close).toBe(true);
  });
});

describe("seriesPointFrom", () => {
  // Marže: Pinnacle 2.5 %, Akční 6.2 %, Líná 10.2 %. Akční má sice NEJLEPŠÍ kurz na
  // domácí, ale na zbytku je horší → sharp kniha je Pinnacle. Přesně tenhle rozdíl
  // („nejlepší cena" ≠ „nejostřejší kniha") je důvod, proč se to čte dvěma funkcemi.
  const BOOKS = [
    book("Pinnacle", { home: 2.1, draw: 3.55, away: 3.75, over25: 1.9, under25: 1.95 }),
    book("Líná", { home: 1.95, draw: 3.3, away: 3.5 }),
    book("Akční", { home: 2.12, draw: 3.2, away: 3.6 }),
  ];

  it("vezme syrové kurzy knihy s nejnižší marží", () => {
    const p = seriesPointFrom(BOOKS, 180)!;
    expect(p.b).toBe("Pinnacle");
    expect(p.h).toBe(2.1);
    expect(p.o).toBe(1.9);
    expect(p.t).toBe(180);
    expect(p.n).toBe(3);
  });

  it("nejlepší cena je maximum napříč knihami, ne z jedné", () => {
    const p = seriesPointFrom(BOOKS, 180)!;
    expect(p.xh).toBe(2.12); // Akční má nejlepší domácí…
    expect(p.xd).toBe(3.55); // …ale remízu i hosty má nejlepší Pinnacle
    expect(p.xa).toBe(3.75);
  });

  it("ukládá SYROVÉ kurzy, ne odmaržované pravděpodobnosti", () => {
    const p = seriesPointFrom(BOOKS, 180)!;
    // Kdyby to byly pravděpodobnosti, byly by < 1 a v součtu 1.
    expect(p.h! + p.d! + p.a!).toBeGreaterThan(3);
  });

  it("bez použitelných kurzů vrátí null (bod by byl jen šum v DB)", () => {
    expect(seriesPointFrom([], 60)).toBeNull();
    expect(seriesPointFrom([book("Prázdná", {})], 60)).toBeNull();
  });
});

describe("appendPoint", () => {
  const p = (t: number): OddsSeriesPoint => ({ t, n: 5, h: 2, d: 3, a: 4 });

  it("nemutuje vstup", () => {
    const orig = [p(300)];
    appendPoint(orig, p(120));
    expect(orig).toHaveLength(1);
  });

  it("řadí od nejstaršího (nejdál od výkopu) po nejnovější", () => {
    let s: OddsSeriesPoint[] = [];
    for (const t of [720, 300, 120, 30]) s = appendPoint(s, p(t));
    expect(s.map((x) => x.t)).toEqual([720, 300, 120, 30]);
  });

  it("zahodí bod, který není blíž výkopu než poslední (mimo pořadí)", () => {
    const s = appendPoint(appendPoint([], p(120)), p(300));
    expect(s.map((x) => x.t)).toEqual([300]);
  });

  it("délka je omezená a ořezává se odzadu (nejnovější body jsou cennější)", () => {
    let s: OddsSeriesPoint[] = [];
    for (let t = 5000; t > 5000 - MAX_SERIES_POINTS * 10 - 100; t -= 10) {
      s = appendPoint(s, p(t));
    }
    expect(s).toHaveLength(MAX_SERIES_POINTS);
    // Poslední přidaný (nejblíž výkopu) tam musí zůstat.
    expect(s[s.length - 1].t).toBeLessThan(s[0].t);
  });
});

describe("parseSeries", () => {
  it("odolá nesmyslu v JSON sloupci", () => {
    expect(parseSeries(null)).toEqual([]);
    expect(parseSeries("nope")).toEqual([]);
    expect(parseSeries([1, "x", null, {}])).toEqual([]);
  });

  it("zahodí neplatné kurzy, ale bod si nechá", () => {
    const s = parseSeries([{ t: 100, h: 0.5, d: 3, a: 4, n: 3 }]);
    expect(s[0].h).toBeUndefined(); // kurz ≤ 1 je nesmysl
    expect(s[0].d).toBe(3);
  });

  it("seřadí od nejdál po nejblíž výkopu, i když v JSON byly zpřeházené", () => {
    const s = parseSeries([{ t: 60, n: 1, h: 2, d: 3, a: 4 }, { t: 600, n: 1, h: 2, d: 3, a: 4 }]);
    expect(s.map((p) => p.t)).toEqual([600, 60]);
  });
});

describe("čtení řady", () => {
  /** Trh se postupně přiklání k domácím (kurz klesá z 3.00 na 2.00). */
  const series: OddsSeriesPoint[] = [
    { t: 2880, n: 10, h: 3.0, d: 3.4, a: 2.5 },
    { t: 720, n: 12, h: 2.8, d: 3.4, a: 2.6 },
    { t: 300, n: 13, h: 2.7, d: 3.4, a: 2.7 },
    { t: 60, n: 13, h: 2.0, d: 3.5, a: 3.6 },
  ];

  it("pointProbs odmaržuje na součet 1", () => {
    const p = pointProbs(series[0])!;
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 9);
  });

  it("drift zachytí posun trhu k domácím", () => {
    const d = seriesDrift(series, "home")!;
    expect(d.points).toBe(4);
    expect(d.fromT).toBe(2880);
    expect(d.toT).toBe(60);
    expect(d.drift).toBeGreaterThan(0.1);
    expect(d.close).toBeGreaterThan(d.open);
  });

  it("maxStep odliší SKOK od plynulého posunu", () => {
    const d = seriesDrift(series, "home")!;
    // Poslední krok (2.7 → 2.0) je násobně větší než předchozí.
    expect(d.maxStep).toBeGreaterThan(0.08);
    const smooth: OddsSeriesPoint[] = [
      { t: 600, n: 5, h: 2.5, d: 3.4, a: 2.9 },
      { t: 300, n: 5, h: 2.45, d: 3.4, a: 2.95 },
      { t: 60, n: 5, h: 2.4, d: 3.4, a: 3.0 },
    ];
    expect(Math.abs(seriesDrift(smooth, "home")!.maxStep)).toBeLessThan(0.02);
  });

  it("lateMove bere jen okno před výkopem", () => {
    const late = lateMove(series, "home", 6)!; // ≤ 360 min → body 300 a 60
    const whole = seriesDrift(series, "home")!.drift;
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(whole); // část pohybu byla dřív
  });

  it("bez dvou použitelných bodů vrací null, ne nulu", () => {
    expect(seriesDrift([series[0]], "home")).toBeNull();
    expect(lateMove(series, "home", 0.5)).toBeNull();
    expect(seriesDrift([{ t: 100, n: 1 }, { t: 50, n: 1 }], "home")).toBeNull();
  });

  it("closingPoint je poslední bod = nejlepší odhad zavření", () => {
    expect(closingPoint(series)!.t).toBe(60);
    expect(closingPoint([])).toBeNull();
  });
});
