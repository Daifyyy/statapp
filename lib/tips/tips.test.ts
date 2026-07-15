import { describe, it, expect } from "vitest";
import { settleTip } from "./settle";
import { pickOddsForTip } from "./odds";
import { computeTipStats } from "./stats";
import type { TipMarket, TipRow, TipSelection } from "./types";
import type { MatchOdds } from "@/lib/data/apiFootball";

function tip(over: Partial<TipRow> & Pick<TipRow, "market" | "selection">): TipRow {
  return {
    id: Math.random().toString(36).slice(2),
    fixtureId: 1,
    leagueId: 39,
    leagueName: "Premier League",
    kickoff: "2026-08-01T14:00:00.000Z",
    homeTeamId: 10,
    awayTeamId: 20,
    homeName: "A",
    awayName: "B",
    homeLogo: null,
    awayLogo: null,
    national: false,
    line: over.market === "over25" ? 2.5 : null,
    stake: 1,
    note: null,
    odds: null,
    oddsBook: null,
    status: "NS",
    homeGoals: null,
    awayGoals: null,
    hit: null,
    placedAt: "2026-07-30T00:00:00.000Z",
    settledAt: null,
    ...over,
  };
}

/** Settlne tip daným skóre (nastaví homeGoals/awayGoals/hit). */
function settled(t: TipRow, hg: number, ag: number): TipRow {
  return {
    ...t,
    status: "FT",
    homeGoals: hg,
    awayGoals: ag,
    hit: settleTip(t.market, t.selection, t.line, hg, ag),
    settledAt: "2026-08-01T16:00:00.000Z",
  };
}

describe("settleTip", () => {
  const cases: [TipMarket, TipSelection, number | null, number, number, boolean][] = [
    ["win", "home", null, 2, 1, true],
    ["win", "home", null, 1, 1, false],
    ["win", "draw", null, 1, 1, true],
    ["win", "away", null, 0, 2, true],
    ["over25", "over", 2.5, 2, 1, true], // total 3 > 2.5
    ["over25", "over", 2.5, 1, 1, false], // total 2
    ["over25", "under", 2.5, 1, 1, true],
    ["over25", "under", 2.5, 2, 1, false],
    ["btts", "yes", null, 2, 1, true],
    ["btts", "yes", null, 1, 0, false],
    ["btts", "no", null, 1, 0, true],
    ["btts", "no", null, 2, 2, false],
  ];
  it.each(cases)("%s/%s line=%s at %i:%i → %s", (m, s, l, hg, ag, exp) => {
    expect(settleTip(m, s, l, hg, ag)).toBe(exp);
  });

  it("over25 bere default 2.5 když line chybí", () => {
    expect(settleTip("over25", "over", null, 2, 1)).toBe(true);
  });
});

describe("pickOddsForTip", () => {
  const odds: MatchOdds = {
    bookmaker: "Pinnacle",
    home: 1.8,
    draw: 3.5,
    away: 4.2,
    over25: 2.0,
    btts: 1.9,
    under25: 1.85,
    bttsNo: 1.95,
  };
  it("mapuje strany 1X2", () => {
    expect(pickOddsForTip(odds, "win", "home")).toBe(1.8);
    expect(pickOddsForTip(odds, "win", "draw")).toBe(3.5);
    expect(pickOddsForTip(odds, "win", "away")).toBe(4.2);
  });
  it("mapuje obě strany over/under a BTTS", () => {
    expect(pickOddsForTip(odds, "over25", "over")).toBe(2.0);
    expect(pickOddsForTip(odds, "over25", "under")).toBe(1.85);
    expect(pickOddsForTip(odds, "btts", "yes")).toBe(1.9);
    expect(pickOddsForTip(odds, "btts", "no")).toBe(1.95);
  });
  it("null odds → null", () => {
    expect(pickOddsForTip(null, "win", "home")).toBeNull();
  });
  it("chybějící opačná strana (starý MatchOdds bez under25) → null", () => {
    const partial: MatchOdds = { ...odds, under25: undefined, bttsNo: undefined };
    expect(pickOddsForTip(partial, "over25", "under")).toBeNull();
    expect(pickOddsForTip(partial, "btts", "no")).toBeNull();
  });
});

describe("computeTipStats", () => {
  it("prázdný vstup", () => {
    const s = computeTipStats([]);
    expect(s.count).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(s.roi).toBeNull();
  });

  it("úspěšnost počítá i tipy bez kurzu, ROI jen s kurzem", () => {
    const rows: TipRow[] = [
      // vyhrál, kurz 2.0 → +1.0
      settled(tip({ market: "win", selection: "home", odds: 2.0 }), 2, 0),
      // prohrál, kurz 2.0 → −1.0
      settled(tip({ market: "win", selection: "home", odds: 2.0 }), 0, 1),
      // vyhrál, ale BEZ kurzu → do accuracy ano, do ROI ne
      settled(tip({ market: "btts", selection: "yes" }), 1, 1),
      // čeká na výsledek
      tip({ market: "over25", selection: "over" }),
    ];
    const s = computeTipStats(rows);
    expect(s.count).toBe(4);
    expect(s.pending).toBe(1);
    expect(s.settled).toBe(3);
    expect(s.hits).toBe(2); // dva vyhrané
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.staked).toBe(2); // jen dva tipy s kurzem
    expect(s.returned).toBeCloseTo(2.0); // jeden hit × 2.0
    expect(s.profit).toBeCloseTo(0);
    expect(s.roi).toBeCloseTo(0);
    expect(s.byMarket.win.settled).toBe(2);
    expect(s.byMarket.btts.settled).toBe(1);
    expect(s.byMarket.btts.roi).toBeNull(); // bez kurzu
  });

  it("vsModel srovná 1X2 tipy tam, kde je modelová predikce", () => {
    const rows: TipRow[] = [
      settled(tip({ fixtureId: 100, market: "win", selection: "home" }), 2, 0), // ty ✓
      settled(tip({ fixtureId: 200, market: "win", selection: "away" }), 2, 0), // ty ✗
      settled(tip({ fixtureId: 300, market: "btts", selection: "yes" }), 1, 1), // ne-1X2, ignoruje se
    ];
    const modelPick = new Map<number, "home" | "draw" | "away">([
      [100, "home"], // model ✓
      [200, "home"], // model ✓ (skutečnost home)
      // 300 bez modelu
    ]);
    const s = computeTipStats(rows, { modelPick });
    expect(s.vsModel).not.toBeNull();
    expect(s.vsModel!.n).toBe(2);
    expect(s.vsModel!.you).toBeCloseTo(0.5);
    expect(s.vsModel!.model).toBeCloseTo(1.0);
  });

  it("bez modelPick → vsModel null", () => {
    const rows = [settled(tip({ market: "win", selection: "home" }), 1, 0)];
    expect(computeTipStats(rows).vsModel).toBeNull();
  });
});
