import { describe, expect, it } from "vitest";
import {
  MIN_XP_SAMPLE,
  XP_VERDICT_MARGIN,
  actualPointsOf,
  expectedPointsOf,
  seasonExpectedPoints,
  xpVerdictLabel,
} from "./expectedPoints";
import { generateLeague } from "./teams";
import { newSeason, playRound, simulateToEnd, yourNextMatch } from "./engine";
import { setPlan } from "./engine";
import type { MatchResult } from "./types";

const mr = (over: Partial<MatchResult> = {}): MatchResult => ({
  round: 0,
  homeId: 1,
  awayId: 2,
  homeGoals: 1,
  awayGoals: 1,
  ...over,
});

describe("expectedPointsOf", () => {
  it("je 3·V + R z pohledu správné strany", () => {
    const probs = { homeWin: 0.5, draw: 0.3, awayWin: 0.2 };
    expect(expectedPointsOf(probs, true)).toBeCloseTo(1.8, 10);
    expect(expectedPointsOf(probs, false)).toBeCloseTo(0.9, 10);
  });

  it("jistá výhra dá 3, jistá prohra 0, jistá remíza 1", () => {
    expect(expectedPointsOf({ homeWin: 1, draw: 0, awayWin: 0 }, true)).toBe(3);
    expect(expectedPointsOf({ homeWin: 1, draw: 0, awayWin: 0 }, false)).toBe(0);
    expect(expectedPointsOf({ homeWin: 0, draw: 1, awayWin: 0 }, true)).toBe(1);
  });

  it("součet xB obou stran nepřekročí 3 (mřížka je normalizovaná)", () => {
    const probs = { homeWin: 0.45, draw: 0.28, awayWin: 0.27 };
    const sum = expectedPointsOf(probs, true) + expectedPointsOf(probs, false);
    expect(sum).toBeCloseTo(3 * (probs.homeWin + probs.awayWin) + 2 * probs.draw, 10);
    expect(sum).toBeLessThanOrEqual(3);
  });
});

describe("actualPointsOf", () => {
  it("čte výsledek z pohledu strany", () => {
    const win = mr({ homeGoals: 2, awayGoals: 0 });
    expect(actualPointsOf(win, true)).toBe(3);
    expect(actualPointsOf(win, false)).toBe(0);
    expect(actualPointsOf(mr({ homeGoals: 1, awayGoals: 1 }), true)).toBe(1);
  });
});

describe("seasonExpectedPoints", () => {
  it("sečte jen TVOJE zápasy", () => {
    const res = [
      mr({ homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0, xp: 1.9 }),
      mr({ homeId: 3, awayId: 4, homeGoals: 5, awayGoals: 0 }), // cizí zápas
    ];
    const out = seasonExpectedPoints(res, 1);
    expect(out.matches).toBe(1);
    expect(out.points).toBe(3);
    expect(out.expected).toBe(1.9);
  });

  it("bere tvůj tým doma i venku", () => {
    const res = [
      mr({ homeId: 1, awayId: 2, homeGoals: 1, awayGoals: 0, xp: 1.5 }),
      mr({ homeId: 3, awayId: 1, homeGoals: 0, awayGoals: 2, xp: 1.2 }),
    ];
    const out = seasonExpectedPoints(res, 1);
    expect(out.matches).toBe(2);
    expect(out.points).toBe(6); // dvě výhry
    expect(out.expected).toBeCloseTo(2.7, 5);
  });

  it("STEJNÝ JMENOVATEL: zápas bez xB se nezapočítá ani do skutečných bodů", () => {
    // Rozehraná kariéra z dřívější verze má prvních N kol bez xB. Kdyby se skutečné body
    // braly ze všech zápasů a očekávané jen z části, vyšel by obrovský „nadvýkon" čistě
    // z toho, že se do jedné strany rozdílu sečetlo víc zápasů.
    const res = [
      mr({ round: 0, homeId: 1, awayId: 2, homeGoals: 3, awayGoals: 0 }), // starý, bez xp
      mr({ round: 1, homeId: 1, awayId: 3, homeGoals: 1, awayGoals: 0, xp: 1.4 }),
    ];
    const out = seasonExpectedPoints(res, 1);
    expect(out.matches).toBe(1);
    expect(out.points).toBe(3); // ne 6
    expect(out.delta).toBeCloseTo(1.6, 5);
  });

  it("xB = 0 se NEPLETE s chybějícím xB", () => {
    // Jistá prohra je legitimní hodnota; `?? 0` by ji smazalo, `== null` ne.
    const res = [mr({ homeId: 1, awayId: 2, homeGoals: 0, awayGoals: 4, xp: 0 })];
    const out = seasonExpectedPoints(res, 1);
    expect(out.matches).toBe(1);
    expect(out.expected).toBe(0);
    expect(out.delta).toBe(0);
  });

  it("verdikt: pod prahem vzorku je „unknown“, i když je rozdíl velký", () => {
    // Rozdíl bodů a xB unese na krátkém úseku ±4 body čirým šumem.
    const res = Array.from({ length: MIN_XP_SAMPLE - 1 }, (_, i) =>
      mr({ round: i, homeId: 1, awayId: 2, homeGoals: 3, awayGoals: 0, xp: 0.5 })
    );
    const out = seasonExpectedPoints(res, 1);
    expect(out.delta).toBeGreaterThan(XP_VERDICT_MARGIN);
    expect(out.verdict).toBe("unknown");
  });

  it("verdikt: šťastlivec / sedí / smolař podle znaménka rozdílu", () => {
    const season = (goals: [number, number], xp: number) =>
      Array.from({ length: MIN_XP_SAMPLE }, (_, i) =>
        mr({ round: i, homeId: 1, awayId: 2, homeGoals: goals[0], awayGoals: goals[1], xp })
      );
    // 8 výher (24 b) při xB 1.0/zápas (8) → +16
    expect(seasonExpectedPoints(season([2, 0], 1.0), 1).verdict).toBe("lucky");
    // 8 remíz (8 b) při xB 1.0/zápas (8) → 0
    expect(seasonExpectedPoints(season([1, 1], 1.0), 1).verdict).toBe("fair");
    // 8 proher (0 b) při xB 1.5/zápas (12) → −12
    expect(seasonExpectedPoints(season([0, 2], 1.5), 1).verdict).toBe("unlucky");
  });

  it("verdikt „fair“ drží těsně pod prahem na obou stranách", () => {
    const res = (delta: number) =>
      Array.from({ length: MIN_XP_SAMPLE }, (_, i) =>
        mr({
          round: i,
          homeId: 1,
          awayId: 2,
          homeGoals: 1,
          awayGoals: 1, // 1 bod za zápas
          xp: 1 - delta / MIN_XP_SAMPLE,
        })
      );
    expect(seasonExpectedPoints(res(XP_VERDICT_MARGIN - 0.1), 1).verdict).toBe("fair");
    expect(seasonExpectedPoints(res(XP_VERDICT_MARGIN + 0.1), 1).verdict).toBe("lucky");
  });

  it("prázdná sezóna nespadne", () => {
    const out = seasonExpectedPoints([], 1);
    expect(out).toMatchObject({ matches: 0, points: 0, expected: 0, delta: 0, verdict: "unknown" });
  });

  it("každý verdikt má popisek", () => {
    for (const v of ["lucky", "fair", "unlucky", "unknown"] as const) {
      expect(xpVerdictLabel(v).length).toBeGreaterThan(0);
    }
  });
});

describe("napojení na engine", () => {
  const league = () => generateLeague(42);
  const start = () =>
    newSeason(7, league()[0].id, { teams: league(), leagueId: 1, leagueName: "Test" });

  it("playRound uloží xB JEN u tvých zápasů", () => {
    const s = playRound(start());
    const round0 = s.results.filter((r) => r.round === 0);
    const yours = round0.filter(
      (r) => r.homeId === s.yourTeamId || r.awayId === s.yourTeamId
    );
    expect(yours).toHaveLength(1);
    expect(yours[0].xp).toBeTypeOf("number");
    // Zápasy AI proti sobě xB nemají – `results` drží celou ligu a save by zbytečně narostl.
    for (const r of round0.filter((r) => !yours.includes(r))) {
      expect(r.xp).toBeUndefined();
    }
  });

  it("xB je v rozsahu 0–3 a po celé sezóně sedí počet zápasů", () => {
    const done = simulateToEnd(start());
    const out = seasonExpectedPoints(done.results, done.yourTeamId);
    const played = done.results.filter(
      (r) => r.homeId === done.yourTeamId || r.awayId === done.yourTeamId
    ).length;
    expect(out.matches).toBe(played);
    expect(out.expected).toBeGreaterThan(0);
    expect(out.expected).toBeLessThan(played * 3);
  });

  it("xB jde ze SKUTEČNĚ odehrané λ, ne z neutrálního náhledu", () => {
    // Tohle je celý smysl modulu. Náhled (`yourNextMatch`) jede záměrně "balanced"/"none"
    // kvůli anti-exploitu. Kdyby se xB bralo z něj, „nadvýkon" by z poloviny měřil, že
    // ti zabrala taktika – tedy pravý opak smůly, kterou má ukázat.
    const base = start();
    const preview = yourNextMatch(base)!;
    const neutralXp = expectedPointsOf(preview.probs, preview.isHome);

    // Zvol vyhraněný plán → skutečná λ se od náhledu odchýlí.
    const played = playRound(setPlan(base, "press"));
    const yours = played.results.find(
      (r) => r.homeId === base.yourTeamId || r.awayId === base.yourTeamId
    )!;
    expect(yours.xp).not.toBeCloseTo(neutralXp, 6);
  });

  it("stejný seed dá stejné xB (determinismus)", () => {
    const a = simulateToEnd(start());
    const b = simulateToEnd(start());
    expect(seasonExpectedPoints(a.results, a.yourTeamId)).toEqual(
      seasonExpectedPoints(b.results, b.yourTeamId)
    );
  });
});
