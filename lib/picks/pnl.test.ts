import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import type { MatchOddsRecord } from "./oddsDataset";
import { fairProbOf, flatBets, summarizePnl } from "./pnl";

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
    modelVersion: 0,
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

const odds: MatchOddsRecord = {
  pinnacle: { home: 2.0, draw: 3.5, away: 4.0 },
  best: { home: 2.1, draw: 3.6, away: 4.2 },
  ou25: { pinnacle: { over: 1.9, under: 1.9 } },
};

describe("fairProbOf", () => {
  it("odmaržuje 1X2 – součet stran dá 1", () => {
    const h = fairProbOf(odds, "pinnacle", "home")!;
    const d = fairProbOf(odds, "pinnacle", "draw")!;
    const a = fairProbOf(odds, "pinnacle", "away")!;
    expect(h + d + a).toBeCloseTo(1, 10);
    // Férová pravděpodobnost je NIŽŠÍ než 1/kurz – přesně o marži.
    expect(h).toBeLessThan(1 / 2.0);
  });

  it("odmaržuje i Over/Under (na férové lince 1.90/1.90 je to přesně 50 %)", () => {
    expect(fairProbOf(odds, "pinnacle", "over25")).toBeCloseTo(0.5, 10);
    expect(fairProbOf(odds, "pinnacle", "under25")).toBeCloseTo(0.5, 10);
  });

  it("chybějící hladina → null", () => {
    expect(fairProbOf(odds, "average", "home")).toBeNull();
    expect(fairProbOf(undefined, "pinnacle", "home")).toBeNull();
  });
});

describe("flatBets", () => {
  const byId = new Map([[1, odds]]);

  // Dvě různá kritéria = dvě různé otázky. EV je přísnější, protože počítá s marží.
  it("EV (default) sází podle p × kurz − 1", () => {
    // Domácí: 0.50 × 2.00 − 1 = 0 → projde s prahem 0, ne s kladným prahem.
    expect(
      flatBets([row()], byId, { level: "pinnacle", minEdge: 0 }).map((b) => b.market)
    ).toContain("home");
    expect(flatBets([row()], byId, { level: "pinnacle", minEdge: 0.01 })).toEqual([]);
  });

  it("kritérium disagreement je VOLNĚJŠÍ než EV (férová cena je nižší než 1/kurz)", () => {
    // Marže linie 2.00/3.50/4.00 je 3.57 % → férová domácí 0.4828, takže model s 0.50
    // se s trhem rozchází o 1.72 p.b., přestože EV té sázky je přesně nula.
    const dis = flatBets([row()], byId, {
      level: "pinnacle",
      minEdge: 0.01,
      criterion: "disagreement",
    });
    expect(dis.map((b) => b.market)).toContain("home");
    expect(flatBets([row()], byId, { level: "pinnacle", minEdge: 0.01 })).toEqual([]);
  });

  it("výhru pozná ze skutečného skóre", () => {
    const bets = flatBets([row()], byId, {
      level: "pinnacle",
      minEdge: -1, // ať projdou všechny trhy, i ty se záporným EV
    });
    expect(bets.find((b) => b.market === "home")?.won).toBe(true);
    expect(bets.find((b) => b.market === "away")?.won).toBe(false);
    // 2:0 = 2 góly → Over 2.5 neprošlo, Under ano.
    expect(bets.find((b) => b.market === "over25")?.won).toBe(false);
    expect(bets.find((b) => b.market === "under25")?.won).toBe(true);
  });

  it("přeskočí zápas bez kurzů, bez výsledku i nedostupnou predikci", () => {
    expect(flatBets([row()], new Map(), { level: "pinnacle", minEdge: 0 })).toEqual([]);
    expect(flatBets([row({ homeGoals: null })], byId, { level: "pinnacle", minEdge: 0 })).toEqual([]);
    expect(flatBets([row({ available: false })], byId, { level: "pinnacle", minEdge: 0 })).toEqual([]);
  });

  it("nejlepší cena dá vyšší kurz než sharp linie", () => {
    const p = flatBets([row()], byId, { level: "pinnacle", minEdge: 0 }).find((b) => b.market === "home");
    const b = flatBets([row()], byId, { level: "best", minEdge: 0 }).find((x) => x.market === "home");
    expect(b!.odds).toBeGreaterThan(p!.odds);
  });
});

describe("summarizePnl", () => {
  it("spočítá zisk, ROI a maximální propad", () => {
    const bets = [
      { fixtureId: 1, leagueId: 39, market: "home" as const, odds: 3, prob: 0.5, won: true },
      { fixtureId: 2, leagueId: 39, market: "home" as const, odds: 2, prob: 0.5, won: false },
      { fixtureId: 3, leagueId: 39, market: "home" as const, odds: 2, prob: 0.5, won: false },
    ];
    const s = summarizePnl(bets);
    expect(s.n).toBe(3);
    expect(s.profit).toBeCloseTo(0, 10); // +2, −1, −1
    expect(s.roi).toBeCloseTo(0, 10);
    expect(s.maxDrawdown).toBeCloseTo(2, 10); // z vrcholu +2 dolů na 0
  });

  it("interval spolehlivosti obsahuje bodový odhad a je deterministický", () => {
    const bets = Array.from({ length: 200 }, (_, i) => ({
      fixtureId: i,
      leagueId: 39,
      market: "home" as const,
      odds: 2,
      prob: 0.5,
      won: i % 2 === 0,
    }));
    const a = summarizePnl(bets);
    const b = summarizePnl(bets);
    expect(a.roiLow).toBeLessThanOrEqual(a.roi);
    expect(a.roiHigh).toBeGreaterThanOrEqual(a.roi);
    expect(a.roiLow).toBe(b.roiLow); // stejný vstup → stejný interval
  });

  it("prázdný vstup nevrací NaN", () => {
    expect(summarizePnl([])).toMatchObject({ n: 0, roi: 0, profit: 0, maxDrawdown: 0 });
  });
});
