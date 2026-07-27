import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { edge, impliedProb, rowValue, valueOf } from "./value";

function row(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 39,
    season: 2025,
    kickoff: new Date(Date.now() + 86400000).toISOString(),
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
    rho: -0.13,
    sharpen: 1,
    calibA: 1,
    calibB: 0,
    status: "NS",
    homeGoals: null,
    awayGoals: null,
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

describe("impliedProb / edge", () => {
  it("impliedProb = 1/kurz", () => {
    expect(impliedProb(2)).toBeCloseTo(0.5);
    expect(impliedProb(4)).toBeCloseTo(0.25);
  });

  it("edge = p×kurz − 1 (kladný = value)", () => {
    expect(edge(0.6, 2)).toBeCloseTo(0.2); // 0.6 vs implied 0.5 → +20 %
    expect(edge(0.5, 2)).toBeCloseTo(0); // férový kurz → nulová hrana
    expect(edge(0.4, 2)).toBeCloseTo(-0.2); // pod trhem → záporná hrana
  });
});

describe("valueOf", () => {
  it("spočítá implied a edge z platného kurzu", () => {
    const v = valueOf(0.6, 2.0);
    expect(v).not.toBeNull();
    expect(v!.impliedProb).toBeCloseTo(0.5);
    expect(v!.edge).toBeCloseTo(0.2);
  });

  it("null kurz / kurz ≤ 1 / nekladná pravděpodobnost → null", () => {
    expect(valueOf(0.6, null)).toBeNull();
    expect(valueOf(0.6, undefined)).toBeNull();
    expect(valueOf(0.6, 1)).toBeNull();
    expect(valueOf(0.6, 0.8)).toBeNull();
    expect(valueOf(0, 2)).toBeNull();
  });
});

describe("rowValue", () => {
  it("win/home páruje homeWin s oddsHome", () => {
    const v = rowValue(row({ homeWin: 0.55, oddsHome: 2.0 }), "win", "home");
    expect(v!.prob).toBeCloseTo(0.55);
    expect(v!.edge).toBeCloseTo(0.1);
  });

  it("win/away páruje awayWin s oddsAway", () => {
    const v = rowValue(row({ awayWin: 0.4, oddsAway: 3.0 }), "win", "away");
    expect(v!.edge).toBeCloseTo(0.2);
  });

  it("over25 a btts berou svůj kurz, side se ignoruje", () => {
    expect(rowValue(row({ over25: 0.6, oddsOver25: 1.9 }), "over25", null)!.edge).toBeCloseTo(0.14);
    expect(rowValue(row({ bttsYes: 0.55, oddsBtts: 2.0 }), "btts", null)!.edge).toBeCloseTo(0.1);
  });

  it("chybějící kurz → null (value nelze posoudit)", () => {
    expect(rowValue(row({ homeWin: 0.7 }), "win", "home")).toBeNull();
  });
});

describe("férová cena (edgeFair)", () => {
  // Jádro opravy z 26. 7. 2026: dřív se hrana počítala proti kurzu S MARŽÍ, takže
  // tip kolem nuly vypadal jako value.
  it("1X2: fairProb je NIŽŠÍ než 1/kurz o marži → neshoda vyjde větší než EV", () => {
    const r = row({ homeWin: 0.5, oddsHome: 2.0, oddsDraw: 3.5, oddsAway: 4.0 });
    const v = rowValue(r, "win", "home")!;
    // Marže 3.57 % je rozpuštěná v implikovaných pravděpodobnostech, takže férová
    // domácí je 0.4828, ne 0.50.
    expect(v.fairProb).toBeCloseTo(0.4828, 4);
    // EV proti VYPLÁCENÉMU kurzu je nula (0.5 × 2.0 − 1) → sázka nevydělá…
    expect(v.edge).toBeCloseTo(0.0, 10);
    // …ale s trhem se přesto rozcházíme o 1.7 p.b. To jsou dvě různé otázky:
    // „vydělá to?" (edge) vs. „myslíme si něco jiného?" (edgeFair).
    expect(v.edgeFair).toBeCloseTo(0.0172, 4);
    expect(v.fairProb!).toBeLessThan(v.impliedProb);
  });

  it("Over 2.5: bez protistrany férovou cenu neznáme", () => {
    const bez = rowValue(row({ over25: 0.6, oddsOver25: 1.9 }), "over25", null)!;
    expect(bez.fairProb).toBeNull();
    expect(bez.edgeFair).toBeNull();

    const s = rowValue(
      row({ over25: 0.6, oddsOver25: 1.9, oddsUnder25: 2.1 }),
      "over25",
      null
    )!;
    expect(s.fairProb).toBeCloseTo(2.1 / (1.9 + 2.1), 6);
    expect(s.edgeFair).toBeCloseTo(0.6 - 2.1 / (1.9 + 2.1), 6);
  });

  it("BTTS zvládne obě strany stejně", () => {
    const v = rowValue(row({ bttsYes: 0.55, oddsBtts: 2.0, oddsBttsNo: 2.0 }), "btts", null)!;
    expect(v.fairProb).toBeCloseTo(0.5, 10); // 2.00/2.00 = férová linie
    expect(v.edgeFair).toBeCloseTo(0.05, 10);
  });

  it("neúplný 1X2 (chybí remíza) → fairProb null, edge zůstane", () => {
    const v = rowValue(row({ homeWin: 0.5, oddsHome: 2.0, oddsAway: 4.0 }), "win", "home")!;
    expect(v.fairProb).toBeNull();
    expect(v.edge).toBeCloseTo(0, 10);
  });
});
