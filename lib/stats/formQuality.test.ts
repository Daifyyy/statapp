import { describe, expect, it } from "vitest";
import type { MatchStat } from "@/lib/types";
import { computeFormQuality, expectedPointsFromXg } from "./formQuality";
import { computeSummary } from "./summary";

const NOW = new Date("2026-06-12T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** Zápas se skóre (gf:ga) a volitelným xG obou stran. */
function match(
  id: number,
  daysAgo: number,
  gf: number,
  ga: number,
  xg?: { for: number; against: number },
  opts: Partial<MatchStat> = {}
): MatchStat {
  return {
    fixtureId: id,
    date: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    isHome: true,
    isNeutral: false,
    competitive: true,
    season: 2025,
    isBaseline: false,
    metrics: {
      GOALS_FOR: gf,
      GOALS_AGAINST: ga,
      ...(xg ? { XG: xg.for, XG_AGAINST: xg.against } : {}),
    },
    ...opts,
  };
}

describe("expectedPointsFromXg", () => {
  it("je v rozsahu 0–3 a roste s převahou v xG", () => {
    const weak = expectedPointsFromXg(0.4, 2.2);
    const even = expectedPointsFromXg(1.3, 1.3);
    const strong = expectedPointsFromXg(2.6, 0.5);

    for (const xp of [weak, even, strong]) {
      expect(xp).toBeGreaterThanOrEqual(0);
      expect(xp).toBeLessThanOrEqual(3);
    }
    expect(weak).toBeLessThan(even);
    expect(even).toBeLessThan(strong);
  });

  it("je symetrické: vyrovnané xG dá oběma stranám totéž", () => {
    expect(expectedPointsFromXg(1.6, 1.6)).toBeCloseTo(expectedPointsFromXg(1.6, 1.6), 10);
    // Prohozené strany musí dát dohromady tolik, kolik dá dvojice sama sobě.
    const a = expectedPointsFromXg(2.1, 0.8);
    const b = expectedPointsFromXg(0.8, 2.1);
    expect(a).toBeGreaterThan(b);
    // Remízová složka je společná → součet je pod 3 (o pravděpodobnost remízy).
    expect(a + b).toBeLessThan(3);
  });

  it("vyrovnaný zápas dá zhruba bod a půl", () => {
    const xp = expectedPointsFromXg(1.4, 1.4);
    expect(xp).toBeGreaterThan(1.1);
    expect(xp).toBeLessThan(1.6);
  });
});

describe("computeFormQuality – jednotlivé zápasy", () => {
  it("šťastnou výhru označí jako 'lucky'", () => {
    // 1:0 při xG 0.4 : 1.6 – body 3, výkon na podstatně míň.
    const q = computeFormQuality([match(1, 1, 1, 0, { for: 0.4, against: 1.6 })], "TOTAL");
    const m = q.matches[0];
    expect(m.result).toBe("W");
    expect(m.points).toBe(3);
    expect(m.expectedPoints!).toBeLessThan(1.2);
    expect(m.edge!).toBeGreaterThan(1);
    expect(m.verdict).toBe("lucky");
  });

  it("nezaslouženou prohru označí jako 'unlucky'", () => {
    // 0:1 při xG 2.4 : 0.5 – tým vytvořil násobně víc a nemá nic.
    const q = computeFormQuality([match(1, 1, 0, 1, { for: 2.4, against: 0.5 })], "TOTAL");
    const m = q.matches[0];
    expect(m.result).toBe("L");
    expect(m.points).toBe(0);
    expect(m.expectedPoints!).toBeGreaterThan(2);
    expect(m.verdict).toBe("unlucky");
  });

  it("zasloužená výhra je 'matched', ne 'lucky'", () => {
    const q = computeFormQuality([match(1, 1, 3, 0, { for: 2.6, against: 0.4 })], "TOTAL");
    expect(q.matches[0].verdict).toBe("matched");
  });

  it("bez xG nedopočítává nic odhadem", () => {
    const q = computeFormQuality([match(1, 1, 2, 1)], "TOTAL");
    const m = q.matches[0];
    expect(m.result).toBe("W"); // výsledek a góly máme vždy
    expect(m.points).toBe(3);
    expect(m.xgFor).toBeNull();
    expect(m.expectedPoints).toBeNull();
    expect(m.edge).toBeNull();
    expect(m.verdict).toBeNull();
    expect(q.xgSampleSize).toBe(0);
    expect(q.level).toBeNull();
    expect(q.note).toBe("");
  });

  it("jednostranné xG se NEPOUŽIJE (soupeř by neměl šance vůbec)", () => {
    const half = match(1, 1, 1, 1);
    half.metrics.XG = 1.4; // XG_AGAINST chybí
    const q = computeFormQuality([half], "TOTAL");
    expect(q.matches[0].expectedPoints).toBeNull();
    expect(q.xgSampleSize).toBe(0);
  });
});

describe("computeFormQuality – verdikt nad oknem", () => {
  /** Pět výher 1:0, ve kterých byl vždycky lepší soupeř. */
  const luckyRun = [
    match(1, 1, 1, 0, { for: 0.5, against: 1.8 }),
    match(2, 2, 1, 0, { for: 0.6, against: 1.7 }),
    match(3, 3, 1, 0, { for: 0.4, against: 2.0 }),
    match(4, 4, 1, 0, { for: 0.7, against: 1.6 }),
    match(5, 5, 1, 0, { for: 0.5, against: 1.9 }),
  ];

  it("sérii výher bez výkonu označí za nadstavenou", () => {
    const q = computeFormQuality(luckyRun, "TOTAL");
    expect(q.points).toBe(15);
    expect(q.expectedPoints!).toBeLessThan(6);
    expect(q.xgDiffPerMatch!).toBeLessThan(0);
    expect(q.level).toBe("overperforming");
    expect(q.note).toContain("Výsledky jsou nad výkony");
    expect(q.note).toContain("z 5 zápasů");
  });

  it("sérii proher s lepší hrou označí za podhodnocenou", () => {
    const q = computeFormQuality(
      [
        match(1, 1, 0, 1, { for: 2.2, against: 0.6 }),
        match(2, 2, 1, 2, { for: 2.4, against: 0.8 }),
        match(3, 3, 0, 1, { for: 1.9, against: 0.5 }),
        match(4, 4, 0, 0, { for: 2.6, against: 0.4 }),
        match(5, 5, 1, 3, { for: 2.1, against: 0.9 }),
      ],
      "TOTAL"
    );
    expect(q.level).toBe("underperforming");
    expect(q.xgDiffPerMatch!).toBeGreaterThan(1);
    expect(q.note).toContain("Výkony jsou nad výsledky");
  });

  it("sedící formu označí za odpovídající", () => {
    const q = computeFormQuality(
      [
        match(1, 1, 2, 0, { for: 2.1, against: 0.6 }),
        match(2, 2, 1, 1, { for: 1.3, against: 1.4 }),
        match(3, 3, 0, 2, { for: 0.6, against: 2.2 }),
        match(4, 4, 2, 1, { for: 1.9, against: 1.1 }),
        match(5, 5, 1, 1, { for: 1.2, against: 1.3 }),
      ],
      "TOTAL"
    );
    expect(q.level).toBe("inline");
    expect(q.note).toContain("Výsledky odpovídají výkonům");
  });

  it("pod prahem vzorku verdikt NEVZNIKNE, jednotlivé zápasy ano", () => {
    const q = computeFormQuality(
      [
        match(1, 1, 1, 0, { for: 0.4, against: 1.8 }),
        match(2, 2, 1, 0, { for: 0.5, against: 1.9 }),
        match(3, 3, 1, 0), // bez xG
        match(4, 4, 1, 0), // bez xG
        match(5, 5, 1, 0), // bez xG
      ],
      "TOTAL"
    );
    expect(q.xgSampleSize).toBe(2);
    expect(q.matches[0].verdict).toBe("lucky"); // jednotlivý zápas hodnotíme dál
    expect(q.level).toBeNull();
    expect(q.note).toBe("");
  });

  it("agreguje jen ze zápasů s xG (body i xP mají stejný jmenovatel)", () => {
    const q = computeFormQuality(
      [
        match(1, 1, 1, 0, { for: 1.2, against: 1.0 }),
        match(2, 2, 1, 0, { for: 1.1, against: 0.9 }),
        match(3, 3, 1, 0, { for: 1.3, against: 1.1 }),
        match(4, 4, 1, 0, { for: 1.0, against: 0.8 }),
        match(5, 5, 3, 0), // výhra BEZ xG – nesmí do bodů
      ],
      "TOTAL"
    );
    expect(q.xgSampleSize).toBe(4);
    expect(q.points).toBe(12); // ne 15
  });
});

describe("computeFormQuality – výběr zápasů", () => {
  const matches = [
    match(1, 1, 1, 0, { for: 1.5, against: 0.8 }),
    match(2, 2, 0, 1, { for: 0.7, against: 1.6 }, { isHome: false }),
    match(3, 3, 2, 2, { for: 1.9, against: 1.8 }),
    match(4, 4, 0, 0, { for: 0.9, against: 1.0 }, { isHome: false }),
    match(5, 5, 3, 1, { for: 2.2, against: 1.1 }),
    match(6, 6, 0, 3, { for: 0.5, against: 2.4 }), // mimo top 5
  ];

  it("bere stejné zápasy ve stejném pořadí jako forma v TeamSummary", () => {
    for (const venue of ["HOME", "AWAY", "TOTAL"] as const) {
      const summary = computeSummary(matches, venue);
      const quality = computeFormQuality(matches, venue);
      expect(quality.matches.map((m) => m.result)).toEqual(summary.form);
    }
  });

  it("respektuje přepínač Doma/Venku", () => {
    const home = computeFormQuality(matches, "HOME");
    const away = computeFormQuality(matches, "AWAY");
    expect(home.matches.map((m) => m.fixtureId)).toEqual([1, 3, 5, 6]);
    expect(away.matches.map((m) => m.fixtureId)).toEqual([2, 4]);
  });

  it("neutrální zápas nepatří do HOME ani AWAY", () => {
    const neutral = [match(9, 1, 1, 0, { for: 1.4, against: 0.9 }, { isNeutral: true })];
    expect(computeFormQuality(neutral, "HOME").matches).toHaveLength(0);
    expect(computeFormQuality(neutral, "AWAY").matches).toHaveLength(0);
    expect(computeFormQuality(neutral, "TOTAL").matches).toHaveLength(1);
  });

  it("prázdný vstup nespadne", () => {
    const q = computeFormQuality([], "TOTAL");
    expect(q.matches).toEqual([]);
    expect(q.points).toBeNull();
    expect(q.level).toBeNull();
    expect(q.note).toBe("");
  });
});
