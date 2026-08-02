import { describe, expect, it } from "vitest";
import type { PredictionRow } from "@/lib/types";
import { buildMatchReview } from "./matchReview";

/** Minimální uložený řádek predikce; jednotlivé testy si přepíšou, co potřebují. */
function row(over: Partial<PredictionRow> = {}): PredictionRow {
  return {
    fixtureId: 1,
    leagueId: 345,
    season: 2026,
    kickoff: "2026-08-01T15:00:00.000Z",
    homeTeamId: 10,
    awayTeamId: 20,
    homeName: "Baník",
    awayName: "Slavia",
    homeLogo: "h.png",
    awayLogo: "a.png",
    available: true,
    lambdaHome: 1.0,
    lambdaAway: 2.1,
    homeWin: 0.2,
    draw: 0.25,
    awayWin: 0.55,
    bttsYes: 0.5,
    over25: 0.58,
    lowConfidence: false,
    readinessSample: 12,
    modelVersion: 7,
    rho: -0.03,
    sharpen: 1,
    calibA: 1,
    calibB: 0,
    status: "FT",
    homeGoals: 0,
    awayGoals: 4,
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
  };
}

/** Referenční kurzy obou snímků (bez knih → CLV spadne na `reference` větev). */
function withRefOdds(open: [number, number, number], close: [number, number, number]) {
  return {
    oddsHome: open[0],
    oddsDraw: open[1],
    oddsAway: open[2],
    oddsCloseHome: close[0],
    oddsCloseDraw: close[1],
    oddsCloseAway: close[2],
  };
}

const GOALS = { home: 0, away: 4 };

describe("buildMatchReview – model", () => {
  it("trefený tip: favorit hosté a hosté vyhráli", () => {
    const { model } = buildMatchReview(row(), GOALS);
    expect(model?.side).toBe("away");
    expect(model?.prob).toBeCloseTo(0.55);
    expect(model?.hit).toBe(true);
  });

  it("netrefený tip: favorit hosté, ale vyhráli domácí", () => {
    const { model } = buildMatchReview(row(), { home: 2, away: 0 });
    expect(model?.hit).toBe(false);
  });

  it("nedostupná predikce se zpětně neprezentuje jako tip – ani když by vyšla", () => {
    // `available: false` znamená, že jsme ji sami označili za nepoužitelnou.
    const review = buildMatchReview(row({ available: false }), GOALS);
    expect(review.model).toBeNull();
    expect(review.market).toBeNull();
  });

  it("nejpravděpodobnější skóre jde z λ toutéž mřížkou jako predikce", () => {
    // λ 1.0 : 2.1 → nejpravděpodobnější je nízké skóre ve prospěch hostů.
    const { model } = buildMatchReview(row(), GOALS);
    expect(model?.topScore).not.toBeNull();
    expect(model!.topScore!.prob).toBeGreaterThan(0);
    expect(model!.topScore!.prob).toBeLessThan(1);
    // 0:4 rozhodně nejpravděpodobnější nebylo.
    expect(model?.topScoreHit).toBe(false);
  });

  it("topScoreHit je true, když padlo právě to skóre", () => {
    const { model } = buildMatchReview(row({ lambdaHome: 1.2, lambdaAway: 1.1 }), {
      home: 1,
      away: 1,
    });
    expect(model?.topScore).toEqual(
      expect.objectContaining({ home: 1, away: 1 })
    );
    expect(model?.topScoreHit).toBe(true);
  });

  it("Over 2.5 a BTTS se vyhodnotí proti skutečnému skóre", () => {
    const a = buildMatchReview(row(), { home: 0, away: 4 }).model;
    expect(a?.over25Hit).toBe(true);
    expect(a?.bttsHit).toBe(false); // domácí nedali gól

    const b = buildMatchReview(row(), { home: 1, away: 1 }).model;
    expect(b?.over25Hit).toBe(false); // 2 góly
    expect(b?.bttsHit).toBe(true);
  });
});

describe("buildMatchReview – trh", () => {
  it("bez uložených kurzů sekce Trh není (nedopočítává se)", () => {
    const review = buildMatchReview(row(), GOALS);
    expect(review.market).toBeNull();
    expect(review.marketNotes).toEqual([]);
  });

  it("jen otevírací snímek nestačí – CLV potřebuje oba", () => {
    const review = buildMatchReview(
      row({ oddsHome: 5, oddsDraw: 4, oddsAway: 1.6 }),
      GOALS
    );
    expect(review.market).toBeNull();
  });

  it("linie k naší straně = kladné CLV a věta „trh šel s námi“", () => {
    // Hosté (naše strana) z 1.80 na 1.50 → zdražili se v pravděpodobnosti.
    const review = buildMatchReview(
      row(withRefOdds([4.2, 3.6, 1.8], [5.5, 4.0, 1.5])),
      GOALS
    );
    expect(review.market?.side).toBe("away");
    expect(review.market!.clv).toBeGreaterThan(0);
    expect(review.marketNotes.join(" ")).toContain("trh šel s námi");
  });

  it("linie od naší strany = záporné CLV a věta „trh šel proti nám“", () => {
    const review = buildMatchReview(
      row(withRefOdds([4.2, 3.6, 1.5], [3.6, 3.4, 1.9])),
      GOALS
    );
    expect(review.market!.clv).toBeLessThan(0);
    expect(review.marketNotes.join(" ")).toContain("trh šel proti nám");
  });

  it("pohyb pod 2 p. b. se nehlásí jako signál", () => {
    const review = buildMatchReview(
      row(withRefOdds([4.2, 3.6, 1.8], [4.2, 3.6, 1.81])),
      GOALS
    );
    expect(review.marketNotes.join(" ")).toContain("prakticky nehnula");
  });

  it("tip na remízu sekci Trh nemá (remízu nesázíme, zavírací linii k ní neukládáme)", () => {
    const review = buildMatchReview(
      row({
        homeWin: 0.25,
        draw: 0.5,
        awayWin: 0.25,
        ...withRefOdds([4.2, 3.6, 1.8], [5.5, 4.0, 1.5]),
      }),
      { home: 1, away: 1 }
    );
    expect(review.model?.side).toBe("draw");
    expect(review.market).toBeNull();
  });

  it("věta uvádí obě čísla: zavírací linii i nás", () => {
    const review = buildMatchReview(
      row(withRefOdds([4.2, 3.6, 1.8], [5.5, 4.0, 1.5])),
      GOALS
    );
    expect(review.marketNotes[0]).toMatch(/Zavírací linie dávala hostům \d+ %, my 55 %/);
  });
});

describe("buildMatchReview – rohy a karty", () => {
  const counts = {
    corners: { home: 3, away: 8 },
    cards: { home: 4, away: 2 },
  };

  it("λ i skutečnost → očekávané vs. skutečné počty", () => {
    const review = buildMatchReview(
      row({
        lambdaCornersHome: 4.4,
        lambdaCornersAway: 5.2,
        lambdaCardsHome: 2.35,
        lambdaCardsAway: 1.85,
      }),
      GOALS,
      counts
    );
    expect(review.corners).toEqual({
      expectedHome: 4.4,
      expectedAway: 5.2,
      expectedTotal: 9.6,
      actualHome: 3,
      actualAway: 8,
      actualTotal: 11,
    });
    expect(review.cards?.expectedTotal).toBe(4.2);
    expect(review.cards?.actualTotal).toBe(6);
  });

  it("bez uložené λ sekce není (řádky z doby před zavedením sloupců)", () => {
    const review = buildMatchReview(row(), GOALS, counts);
    expect(review.corners).toBeNull();
    expect(review.cards).toBeNull();
  });

  it("bez skutečnosti sekce není (zápas bez statistik)", () => {
    const review = buildMatchReview(
      row({ lambdaCornersHome: 4.4, lambdaCornersAway: 5.2 }),
      GOALS
    );
    expect(review.corners).toBeNull();
  });

  it("každý trh degraduje sám za sebe – rohy bez karet", () => {
    const review = buildMatchReview(
      row({ lambdaCornersHome: 4.4, lambdaCornersAway: 5.2 }),
      GOALS,
      { corners: counts.corners, cards: null }
    );
    expect(review.corners).not.toBeNull();
    expect(review.cards).toBeNull();
  });

  it("počty se do vět nepromítají – kreslí se jako čísla, ne dvakrát", () => {
    const review = buildMatchReview(
      row({ lambdaCornersHome: 4.4, lambdaCornersAway: 5.2 }),
      GOALS,
      counts
    );
    expect(review.marketNotes).toEqual([]);
  });
});
