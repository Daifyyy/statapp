import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { clvSideOf, rowClv, summarizeClv } from "./clv";

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
    lambdaAway: 1.1,
    homeWin: 0.5,
    draw: 0.25,
    awayWin: 0.25,
    bttsYes: 0.5,
    over25: 0.5,
    lowConfidence: false,
    readinessSample: 10,
    modelVersion: 7,
    rho: -0.03,
    sharpen: 1,
    calibA: 1,
    calibB: 0,
    status: "FT",
    homeGoals: 2,
    awayGoals: 0,
    benchAvailable: false,
    benchHomeWin: null,
    benchDraw: null,
    benchAwayWin: null,
    oddsBookmaker: "Pinnacle",
    oddsHome: 2.0,
    oddsDraw: 3.5,
    oddsAway: 4.0,
    oddsOver25: 1.9,
    oddsBtts: null,
    oddsUnder25: 2.0,
    oddsBttsNo: null,
    oddsCloseHome: null,
    oddsCloseDraw: null,
    oddsCloseAway: null,
    oddsCloseOver25: null,
    oddsCloseUnder25: null,
    ...over,
  } as PredictionRow;
}

describe("clvSideOf", () => {
  it("mapuje trh a stranu; BTTS se nesleduje", () => {
    expect(clvSideOf("win", "home")).toBe("home");
    expect(clvSideOf("win", "away")).toBe("away");
    expect(clvSideOf("over25", null)).toBe("over25");
    expect(clvSideOf("btts", null)).toBeNull();
  });
});

describe("rowClv", () => {
  it("kladné CLV, když linie zkrátí naši stranu (trh se pohnul k nám)", () => {
    // Domácí z 2.00 na 1.80 → pravděpodobnost vzrostla.
    const r = rowClv(
      row({ oddsCloseHome: 1.8, oddsCloseDraw: 3.6, oddsCloseAway: 4.5 }),
      "home"
    )!;
    expect(r.closeProb).toBeGreaterThan(r.openProb);
    expect(r.clv).toBeGreaterThan(0);
  });

  it("záporné CLV, když se linie pohnula proti nám", () => {
    const r = rowClv(
      row({ oddsCloseHome: 2.3, oddsCloseDraw: 3.4, oddsCloseAway: 3.4 }),
      "home"
    )!;
    expect(r.clv).toBeLessThan(0);
  });

  // Zásadní: CLV má měřit názor trhu, ne to, jak si sázkovka nastavila marži.
  it("samotná změna marže (při stejném názoru trhu) dá CLV nula", () => {
    // Zdvojnásobení marže napříč všemi stranami – poměry zůstanou stejné.
    const r = rowClv(
      row({
        oddsHome: 2.0,
        oddsDraw: 3.5,
        oddsAway: 4.0,
        oddsCloseHome: 2.0 / 1.05,
        oddsCloseDraw: 3.5 / 1.05,
        oddsCloseAway: 4.0 / 1.05,
      }),
      "home"
    )!;
    expect(r.clv).toBeCloseTo(0, 10);
  });

  it("Over/Under se počítá z obou stran totalu", () => {
    const r = rowClv(
      row({ oddsCloseOver25: 1.7, oddsCloseUnder25: 2.2 }),
      "over25"
    )!;
    expect(r.clv).toBeGreaterThan(0);
  });

  it("bez zavíracího snímku → null (starší řádky)", () => {
    expect(rowClv(row(), "home")).toBeNull();
    expect(rowClv(row({ oddsCloseHome: 1.8 }), "home")).toBeNull(); // neúplný 1X2
  });
});

describe("sharp konsenzus a rohy", () => {
  /** Zavírací snímek v REFERENČNÍCH sloupcích (bez knih) – jako starší řádky. */
  const CLOSE_REF = {
    oddsCloseHome: 1.9,
    oddsCloseDraw: 3.5,
    oddsCloseAway: 4.3,
    oddsCloseOver25: 1.85,
    oddsCloseUnder25: 2.05,
  };

  it("dá PŘEDNOST sharp knihám před referenčními sloupci", () => {
    // Referenční sloupce říkají jedno, sharp knihy druhé – musí vyhrát sharp.
    const r = row({
      oddsBooks: [
        { name: "Sharp", home: 2.02, draw: 3.5, away: 4.05 },
        { name: "Líná", home: 1.7, draw: 3.0, away: 3.4 },
      ],
      oddsCloseBooks: [{ name: "Sharp", home: 1.85, draw: 3.55, away: 4.4 }],
    });
    const c = rowClv(r, "home")!;
    expect(c.source).toBe("sharp");
    // Domácí zlevnili (2.02 → 1.85) = trh se pohnul k nám → kladné CLV.
    expect(c.clv).toBeGreaterThan(0);
  });

  it("bez knih spadne na referenční sloupce (starší řádky fungují dál)", () => {
    const c = rowClv(row(CLOSE_REF), "home")!;
    expect(c.source).toBe("reference");
  });

  it("NEMÍCHÁ sharp a referenční zdroj mezi snímky", () => {
    // Knihy jen v otevíracím snímku → nesmí se to zkombinovat se zavíracími sloupci,
    // to by měřilo rozdíl mezi sázkovkami, ne pohyb trhu.
    const c = rowClv(
      row({ ...CLOSE_REF, oddsBooks: [{ name: "Sharp", home: 2.02, draw: 3.5, away: 4.05 }] }),
      "home"
    )!;
    expect(c.source).toBe("reference");
  });

  it("rohy: počítá se na lince z OTEVÍRACÍHO snímku", () => {
    const r = row({
      oddsBooks: [
        { name: "Sharp", corners: [{ line: 10.5, over: 2.0, under: 1.85 }] },
        { name: "B", corners: [{ line: 10.5, over: 1.95, under: 1.9 }] },
      ],
      oddsCloseBooks: [
        // Zavírací nabízí obě linie; musí se vzít 10.5 (ta z otevíracího), ne 11.5.
        { name: "Sharp", corners: [
          { line: 10.5, over: 1.8, under: 2.05 },
          { line: 11.5, over: 3.2, under: 1.35 },
        ] },
      ],
    });
    const c = rowClv(r, "cornersOver")!;
    expect(c.source).toBe("sharp");
    expect(c.line).toBe(10.5);
    // Over zlevnilo (2.0 → 1.8) → pravděpodobnost vzrostla → kladné CLV.
    expect(c.clv).toBeGreaterThan(0);
  });

  it("rohy: chybí-li linie v zavíracím snímku, CLV se nespočítá (nedosadí se jiná)", () => {
    const r = row({
      oddsBooks: [{ name: "S", corners: [{ line: 10.5, over: 2.0, under: 1.85 }] }],
      oddsCloseBooks: [{ name: "S", corners: [{ line: 11.5, over: 3.2, under: 1.35 }] }],
    });
    expect(rowClv(r, "cornersOver")).toBeNull();
  });

  it("rohy nemají referenční fallback – bez knih prostě nejsou", () => {
    expect(rowClv(row(), "cornersOver")).toBeNull();
  });

  it("týmové totaly: vlastní trh, vlastní linie, nemíchají se s rohy", () => {
    const r = row({
      oddsBooks: [
        {
          name: "S",
          totalHome: [{ line: 1.5, over: 2.0, under: 1.85 }],
          corners: [{ line: 10.5, over: 1.5, under: 2.6 }],
        },
      ],
      oddsCloseBooks: [
        {
          name: "S",
          totalHome: [{ line: 1.5, over: 1.8, under: 2.05 }],
          corners: [{ line: 10.5, over: 2.9, under: 1.42 }],
        },
      ],
    });
    const t = rowClv(r, "totalHomeOver")!;
    expect(t.line).toBe(1.5);
    // Domácí přes 1.5 zlevnilo (2.0 → 1.8) → kladné CLV.
    expect(t.clv).toBeGreaterThan(0);
    // Rohy se hnuly OPAČNĚ – kdyby se trhy pletly, vyšlo by tu záporné číslo.
    expect(rowClv(r, "cornersOver")!.clv).toBeLessThan(0);
  });

  it("týmové totaly: strana hostů čte své pole", () => {
    const r = row({
      oddsBooks: [{ name: "S", totalAway: [{ line: 1.5, over: 2.6, under: 1.48 }] }],
      oddsCloseBooks: [{ name: "S", totalAway: [{ line: 1.5, over: 2.4, under: 1.56 }] }],
    });
    expect(rowClv(r, "totalAwayOver")!.clv).toBeGreaterThan(0);
    // Domácí total ta kniha nenabízí → není z čeho počítat.
    expect(rowClv(r, "totalHomeOver")).toBeNull();
  });
});

describe("summarizeClv", () => {
  it("spočítá průměr i podíl tipů, které trh předběhly", () => {
    const good = row({ oddsCloseHome: 1.8, oddsCloseDraw: 3.6, oddsCloseAway: 4.5 });
    const bad = row({ oddsCloseHome: 2.3, oddsCloseDraw: 3.4, oddsCloseAway: 3.4 });
    const s = summarizeClv([
      { row: good, side: "home" },
      { row: good, side: "home" },
      { row: bad, side: "home" },
    ]);
    expect(s.n).toBe(3);
    expect(s.beatRate).toBeCloseTo(2 / 3, 6);
    expect(s.avgClv).toBeGreaterThan(0);
  });

  it("hlásí, kolik tipů se měřilo proti sharp konsenzu", () => {
    const sharpRow = row({
      oddsBooks: [
        { name: "Sharp", home: 2.02, draw: 3.5, away: 4.05 },
        { name: "Líná", home: 1.85, draw: 3.2, away: 3.6 },
      ],
      oddsCloseBooks: [{ name: "Sharp", home: 1.9, draw: 3.5, away: 4.3 }],
    });
    const refRow = row({
      oddsCloseHome: 1.9,
      oddsCloseDraw: 3.5,
      oddsCloseAway: 4.3,
    });
    const s = summarizeClv([
      { row: sharpRow, side: "home" },
      { row: refRow, side: "home" }, // jen referenční sloupce
    ]);
    expect(s.n).toBe(2);
    expect(s.sharpShare).toBeCloseTo(0.5, 6);
  });

  it("tipy bez zavíracího snímku se do souhrnu nepočítají", () => {
    expect(summarizeClv([{ row: row(), side: "home" }])).toEqual({
      n: 0,
      avgClv: 0,
      beatRate: 0,
      sharpShare: 0,
    });
  });
});
