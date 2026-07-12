import { describe, expect, it } from "vitest";
import { backtest, buildTeamAt, matchStatsBefore, type HistoryMatch } from "./backtest";

function m(
  fixtureId: number,
  date: string,
  season: number,
  homeId: number,
  awayId: number,
  homeGoals: number,
  awayGoals: number
): HistoryMatch {
  return {
    fixtureId,
    date,
    season,
    leagueId: 39,
    homeId,
    awayId,
    homeName: `T${homeId}`,
    awayName: `T${awayId}`,
    homeLogo: "h.png",
    awayLogo: "a.png",
    homeGoals,
    awayGoals,
  };
}

/** Malá historie: 2024 (baseline) + 2025, týmy 1 a 2. */
const HISTORY: HistoryMatch[] = [
  m(1, "2024-09-01T15:00:00Z", 2024, 1, 2, 1, 0),
  m(2, "2025-08-10T15:00:00Z", 2025, 1, 2, 3, 1),
  m(3, "2025-08-20T15:00:00Z", 2025, 2, 1, 0, 2),
  m(4, "2025-09-01T15:00:00Z", 2025, 1, 2, 2, 2),
];

describe("matchStatsBefore", () => {
  it("vezme jen zápasy PŘED datem – žádný leak z budoucnosti", () => {
    const before = matchStatsBefore(HISTORY, 1, "2025-08-20T15:00:00Z", 2025);
    expect(before.map((s) => s.fixtureId).sort()).toEqual([1, 2]);
    // Zápas 3 (týž den/později) ani 4 (budoucnost) tam být nesmí.
    expect(before.some((s) => s.fixtureId === 3 || s.fixtureId === 4)).toBe(false);
  });

  it("góly se otočí podle strany a doma/venku sedí", () => {
    const stats = matchStatsBefore(HISTORY, 2, "2025-09-01T15:00:00Z", 2025);
    const away = stats.find((s) => s.fixtureId === 2)!; // tým 2 hrál venku, prohrál 1:3
    expect(away.isHome).toBe(false);
    expect(away.metrics.GOALS_FOR).toBe(1);
    expect(away.metrics.GOALS_AGAINST).toBe(3);
    const home = stats.find((s) => s.fixtureId === 3)!; // tým 2 doma, prohrál 0:2
    expect(home.isHome).toBe(true);
    expect(home.metrics.GOALS_FOR).toBe(0);
  });

  it("zápasy předchozí sezóny jsou baseline, aktuální ne", () => {
    const stats = matchStatsBefore(HISTORY, 1, "2025-09-01T15:00:00Z", 2025);
    expect(stats.find((s) => s.fixtureId === 1)!.isBaseline).toBe(true);
    expect(stats.find((s) => s.fixtureId === 2)!.isBaseline).toBe(false);
  });

  it("sezóny starší než baseline se ignorují", () => {
    const old = [m(9, "2023-05-01T15:00:00Z", 2023, 1, 2, 5, 0), ...HISTORY];
    const stats = matchStatsBefore(old, 1, "2025-09-01T15:00:00Z", 2025);
    expect(stats.some((s) => s.fixtureId === 9)).toBe(false);
  });
});

describe("buildTeamAt", () => {
  it("postaví klubový tým jen z dostupné historie", () => {
    const t = buildTeamAt(
      HISTORY,
      1,
      { name: "T1", logoUrl: "l.png", leagueId: 39 },
      "2025-08-20T15:00:00Z",
      2025
    );
    expect(t.entityType).toBe("CLUB");
    expect(t.leagueMatches).toHaveLength(2);
  });
});

describe("backtest", () => {
  it("predikuje jen vybrané sezóny a doplní skutečný výsledek", () => {
    const rows = backtest(HISTORY, { seasons: [2025] });
    expect(rows.map((r) => r.fixtureId).sort()).toEqual([2, 3, 4]);
    const last = rows.find((r) => r.fixtureId === 4)!;
    expect(last.homeGoals).toBe(2);
    expect(last.awayGoals).toBe(2);
    expect(last.status).toBe("FT");
    // Uložená λ jsou základní (jako v produkci) → jdou fitovat post-parametry.
    expect(last.lambdaHome).toBeGreaterThan(0);
  });

  it("minMatches odfiltruje zápasy bez dost historie (rozjezd sezóny)", () => {
    // Zápas 2 je pro oba týmy 2. dohromady (mají jen 1 zápas z 2024) → při minMatches=2 vypadne.
    const rows = backtest(HISTORY, { seasons: [2025], minMatches: 2 });
    expect(rows.some((r) => r.fixtureId === 2)).toBe(false);
    expect(rows.some((r) => r.fixtureId === 4)).toBe(true);
  });

  it("predikce nezná svůj vlastní výsledek (leak test)", () => {
    // Kdyby se do týmu dostal i predikovaný zápas, λ domácích by ovlivnil jeho výsledek.
    // Ověříme, že predikce zápasu 4 je shodná, ať už je v historii nebo ne.
    const withoutLast = HISTORY.filter((h) => h.fixtureId !== 4);
    const target = HISTORY.find((h) => h.fixtureId === 4)!;
    const a = backtest(HISTORY, { seasons: [2025] }).find((r) => r.fixtureId === 4)!;
    const b = backtest([...withoutLast, target], { seasons: [2025] }).find(
      (r) => r.fixtureId === 4
    )!;
    expect(a.lambdaHome).toBeCloseTo(b.lambdaHome, 12);
    expect(a.homeWin).toBeCloseTo(b.homeWin, 12);
  });
});
