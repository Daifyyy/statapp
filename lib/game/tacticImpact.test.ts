import { describe, expect, it } from "vitest";
import {
  MIN_TACTIC_SAMPLE,
  matchTacticImpact,
  seasonTacticImpact,
  winProbOf,
} from "./tacticImpact";
import { generateLeague } from "./teams";
import {
  newSeason,
  playRound,
  setInstruction,
  setPlan,
  yourNextMatch,
  nextOpponentOf,
} from "./engine";
import type { MatchResult, SeasonState } from "./types";

const mr = (over: Partial<MatchResult> = {}): MatchResult => ({
  round: 0,
  homeId: 1,
  awayId: 2,
  homeGoals: 1,
  awayGoals: 1,
  ...over,
});

/** Odehraje jedno kolo daným plánem a vrátí výsledek tvého zápasu. */
function playYourMatch(
  seed: number,
  plan: Parameters<typeof setPlan>[1],
  instruction: Parameters<typeof setInstruction>[1] = "none"
): { state: SeasonState; result: MatchResult } {
  const teams = generateLeague(seed);
  let s = newSeason(seed, teams[0].id, { teams });
  s = setInstruction(setPlan(s, plan), instruction);
  const after = playRound(s);
  const result = after.results.find(
    (r) => r.homeId === s.yourTeamId || r.awayId === s.yourTeamId
  )!;
  return { state: after, result };
}

describe("winProbOf", () => {
  it("čte šanci na výhru z pohledu správné strany", () => {
    const probs = { homeWin: 0.5, draw: 0.3, awayWin: 0.2 };
    expect(winProbOf(probs, true)).toBe(0.5);
    expect(winProbOf(probs, false)).toBe(0.2);
  });
});

describe("matchTacticImpact", () => {
  it("bez kontrafaktuálu vrací null (starší uložená kariéra)", () => {
    expect(matchTacticImpact(mr({ xp: 1.5 }))).toBeNull();
    expect(matchTacticImpact(mr())).toBeNull();
  });

  it("posun je v procentních bodech, body v očekávaných bodech", () => {
    const out = matchTacticImpact(
      mr({ xp: 1.6, xpBase: 1.45, win: 0.44, winBase: 0.41 })
    )!;
    expect(out.shift).toBeCloseTo(3, 6);
    expect(out.points).toBeCloseTo(0.15, 6);
  });
});

describe("playRound ukládá kontrafaktuál", () => {
  it("jen u TVÝCH zápasů (cizí by jen nafoukly save)", () => {
    const { state } = playYourMatch(11, "press");
    const yours = state.results.filter(
      (r) => r.homeId === state.yourTeamId || r.awayId === state.yourTeamId
    );
    const others = state.results.filter(
      (r) => r.homeId !== state.yourTeamId && r.awayId !== state.yourTeamId
    );
    expect(yours).toHaveLength(1);
    expect(matchTacticImpact(yours[0])).not.toBeNull();
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) expect(matchTacticImpact(r)).toBeNull();
  });

  /**
   * Klíčová vlastnost: základna JE ta neutrální volba. Když hráč nic nezmění, kontrafaktuál
   * musí sedět na skutečnost přesně – jinak by mu appka tvrdila, že „balanced" něco udělal.
   */
  it("s `balanced`/`none` je dopad přesně nulový", () => {
    const { result } = playYourMatch(12, "balanced", "none");
    const out = matchTacticImpact(result)!;
    expect(out.shift).toBeCloseTo(0, 10);
    expect(out.points).toBeCloseTo(0, 10);
    expect(out.win).toBeCloseTo(out.winBase, 10);
  });

  /** Základna = přesně to, co hráč viděl v náhledu před zápasem (`yourNextMatch`). */
  it("`winBase` se rovná predikci z náhledu před zápasem", () => {
    const teams = generateLeague(13);
    let s = newSeason(13, teams[0].id, { teams });
    s = setInstruction(setPlan(s, "press"), "high_line");
    const preview = yourNextMatch(s)!;
    const previewWin = winProbOf(preview.probs, preview.isHome);
    const after = playRound(s);
    const result = after.results.find(
      (r) => r.homeId === s.yourTeamId || r.awayId === s.yourTeamId
    )!;
    expect(result.winBase).toBeCloseTo(previewWin, 10);
  });

  /**
   * Anti-exploit zůstává: náhled se změnou plánu NEHÝBE, takže si hráč nemůže dopad
   * proklikat dopředu. Dopad je čitelný až ze zápasu, který se odehrál.
   */
  it("náhled se nehýbe s volbou plánu (dopad jde přečíst až zpětně)", () => {
    const teams = generateLeague(14);
    const base = newSeason(14, teams[0].id, { teams });
    const a = yourNextMatch(setPlan(base, "open"))!;
    const b = yourNextMatch(setPlan(base, "low_block"))!;
    expect(a.probs.homeWin).toBeCloseTo(b.probs.homeWin, 12);
    expect(a.probs.awayWin).toBeCloseTo(b.probs.awayWin, 12);
  });

  /**
   * Základna nese TÝŽ stav jako skutečnost, takže „nic jsem nezměnil" musí vyjít na nulu
   * i pro utahaný tým se zbídačenou morálkou. (Rozdíl sám na stavu nezávislý NENÍ – přes
   * Poissona je mapa na 1X2 nelineární, takže týž plán posune svěží a unavený tým o jiný
   * počet p.b. To je správně, viz doc v `tacticImpact.ts`.)
   */
  it("izoluje volbu: bez volby je dopad nulový i při špatné morálce a kondici", () => {
    const teams = generateLeague(15);
    const fresh = newSeason(15, teams[0].id, { teams });
    const tired: SeasonState = { ...fresh, morale: 12, fitness: 40 };
    const play = (s: SeasonState, plan: Parameters<typeof setPlan>[1]) => {
      const after = playRound(setInstruction(setPlan(s, plan), "none"));
      return matchTacticImpact(
        after.results.find(
          (r) => r.homeId === s.yourTeamId || r.awayId === s.yourTeamId
        )!
      )!;
    };
    expect(play(tired, "balanced").shift).toBeCloseTo(0, 10);

    // Unavený tým s pošramocenou morálkou má nižší absolutní šanci…
    const a = play(fresh, "counter");
    const b = play(tired, "counter");
    expect(b.winBase).toBeLessThan(a.winBase);
    // …ale plán na něj působí týmž SMĚREM (jen jinak velkým krokem).
    expect(Math.sign(b.shift)).toBe(Math.sign(a.shift));
  });
});

describe("seasonTacticImpact", () => {
  it("sečte jen tvoje zápasy, které kontrafaktuál mají", () => {
    const res = [
      mr({ homeId: 1, awayId: 2, xp: 1.6, xpBase: 1.4, win: 0.44, winBase: 0.4 }),
      mr({ homeId: 3, awayId: 1, xp: 1.0, xpBase: 0.9, win: 0.25, winBase: 0.23 }),
      mr({ homeId: 1, awayId: 4, xp: 2.0 }), // starší kolo bez kontrafaktuálu
      mr({ homeId: 5, awayId: 6, xp: 1.1, xpBase: 1.0, win: 0.3, winBase: 0.28 }), // cizí
    ];
    const out = seasonTacticImpact(res, 1);
    expect(out.matches).toBe(2);
    expect(out.points).toBeCloseTo(0.3, 6);
    expect(out.avgShift).toBeCloseTo(3, 6);
  });

  it("prázdná sezóna nedělí nulou", () => {
    const out = seasonTacticImpact([], 1);
    expect(out.matches).toBe(0);
    expect(out.points).toBe(0);
    expect(out.avgShift).toBe(0);
  });

  /**
   * Empirická kotva: hra podle protitahu vynese přes sezónu KLADNĚ. Kdyby tenhle test
   * spadl, znamená to, že counter matice přestala fungovat – a to je přesně ten druh
   * tiché regrese, kvůli které tenhle modul vznikl.
   */
  it("hra proti stylu soupeře vynese za sezónu kladně", () => {
    const teams = generateLeague(21);
    let s = newSeason(21, teams[Math.floor(teams.length / 2)].id, { teams });
    while (s.round < s.schedule.length) {
      const oppId = nextOpponentOf(s);
      if (oppId != null) s = setPlan(s, "counter");
      s = playRound(s);
    }
    const out = seasonTacticImpact(s.results, s.yourTeamId);
    expect(out.matches).toBeGreaterThanOrEqual(MIN_TACTIC_SAMPLE);
    expect(out.points).toBeGreaterThan(0);
  });
});
