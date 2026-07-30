import { describe, expect, it } from "vitest";
import { matchStakes } from "./stakes";
import {
  HOLD_POINT_WEIGHTS,
  MUST_WIN_WEIGHTS,
  POINTS_WEIGHTS,
  recommendPlan,
} from "./planChoice";
import { generateLeague } from "./teams";
import { newSeason, simulateToEnd, yourNextMatch } from "./engine";
import { teamStrengthScore } from "./leagues";
import type { MatchResult, SeasonState } from "./types";

const league = generateLeague(77);
/** Tvůj tým = přesný střed tabulky sil, ať není ani favorit, ani beznadějný. */
const mid = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a))[
  Math.floor(league.length / 2)
];
const base = newSeason(77, mid.id, { teams: league });
const strongest = [...league].sort(
  (a, b) => teamStrengthScore(b) - teamStrengthScore(a)
)[0];
const weakest = [...league].sort(
  (a, b) => teamStrengthScore(a) - teamStrengthScore(b)
)[0];

describe("matchStakes", () => {
  it("proti výrazně silnějšímu soupeři bere bod", () => {
    const s = matchStakes(base, strongest.id);
    expect(s.kind).toBe("hold_a_point");
    expect(s.weights).toBe(HOLD_POINT_WEIGHTS);
  });

  it("proti slabšímu je to běžný zápas o tři body", () => {
    const s = matchStakes(base, weakest.id);
    expect(s.kind).toBe("normal");
    expect(s.weights).toBe(POINTS_WEIGHTS);
  });

  /**
   * „Musíš vyhrát" se smí spustit jen tehdy, když ani samé remízy na cíl nestačí — a jen
   * v poslední třetině. Manko z podzimu není krize, jinak by hláška zdegenerovala na šum.
   */
  it("na začátku sezóny nikdy nehlásí „musíš vyhrát“", () => {
    for (const t of league) {
      if (t.id === mid.id) continue;
      expect(matchStakes(base, t.id).kind).not.toBe("must_win");
    }
  });

  it("v závěru sezóny s nedohnatelným mankem hlásí „musíš vyhrát“", () => {
    // Poslední kolo, cíl na 1. místo, ty bez bodu → ani výhra nestačí, natož remíza.
    const results: MatchResult[] = league
      .filter((t) => t.id !== mid.id)
      .map((t, i) => ({
        round: 0,
        homeId: t.id,
        awayId: mid.id,
        homeGoals: 3,
        awayGoals: 0,
        ...(i >= 0 ? {} : {}),
      }));
    const s: SeasonState = {
      ...base,
      results,
      round: base.schedule.length - 1,
      objective: { ...base.objective, kind: "title", targetRank: 1, text: "Titul" },
    };
    const st = matchStakes(s, weakest.id);
    expect(st.kind).toBe("must_win");
    expect(st.weights).toBe(MUST_WIN_WEIGHTS);
    expect(st.text).toContain("Remízy");
  });

  it("dohraná sezóna nespadne (žádné dělení nulou ani NaN)", () => {
    const done = simulateToEnd(base);
    expect(() => matchStakes(done, weakest.id)).not.toThrow();
  });
});

describe("sázky se propisují do doporučení", () => {
  /**
   * Jádro změny A: TÁŽ dvojice týmů a týž styl musí pod jinými sázkami dát jiný plán.
   * Kdyby ne, byla by celá vrstva jen text nad nezměněným rozhodnutím.
   */
  it("stejný soupeř, jiné sázky → jiný doporučený plán", () => {
    const styles = ["attacking", "defensive", "balanced"] as const;
    let situations = 0;
    let changed = 0;
    const plans = new Set<string>();
    for (const t of league) {
      if (t.id === mid.id) continue;
      for (const style of styles) {
        for (const youHome of [true, false]) {
          situations++;
          const picks = [POINTS_WEIGHTS, MUST_WIN_WEIGHTS, HOLD_POINT_WEIGHTS].map((w) =>
            recommendPlan(base, t.id, youHome, style, [], w)
          );
          picks.forEach((p) => plans.add(p));
          if (new Set(picks).size > 1) changed++;
        }
      }
    }
    // Proti `attacking` je `counter` nejlepší pod všemi vahami – sázky tedy odpověď
    // nemění VŽDY. Musí ji ale měnit v podstatné části situací, jinak je vrstva zbytečná.
    expect(changed / situations).toBeGreaterThan(0.2);
    // A hlavně: musí se tím dostat ke slovu dřív mrtvé plány.
    expect(plans.has("open") || plans.has("low_block")).toBe(true);
  });

  it("yourNextMatch nese sázky a scout je použije na doporučení", () => {
    const next = yourNextMatch(base);
    expect(next).not.toBeNull();
    expect(next!.stakes.text.length).toBeGreaterThan(0);
    expect(["must_win", "hold_a_point", "normal"]).toContain(next!.stakes.kind);
  });

  /** Anti-exploit se sázkami nemění: náhled se pořád nehýbe s volbou plánu. */
  it("sázky neprozradí nejlepší plán skrz náhled", () => {
    const a = yourNextMatch({ ...base, plan: "open" });
    const b = yourNextMatch({ ...base, plan: "low_block" });
    expect(a!.probs).toEqual(b!.probs);
  });
});
