import { describe, expect, it } from "vitest";
import { buildMatchReport, type MatchSide } from "./matchReport";

const TEAMS = { home: "Sparta", away: "Slavia" };

/** Zápas, kde domácí dominovali ve všem. */
const DOMINANT_HOME: MatchSide = {
  POSSESSION: 64,
  XG: 2.4,
  SHOTS_ON_TARGET: 8,
  SHOTS_INSIDE_BOX: 12,
  FOULS: 8,
  YELLOW_CARDS: 1,
  RED_CARDS: 0,
  PASSES_ACCURATE: 480,
  SAVES: 1,
};
const DOMINATED_AWAY: MatchSide = {
  POSSESSION: 36,
  XG: 0.5,
  SHOTS_ON_TARGET: 2,
  SHOTS_INSIDE_BOX: 3,
  FOULS: 16,
  YELLOW_CARDS: 3,
  RED_CARDS: 0,
  PASSES_ACCURATE: 250,
  SAVES: 6,
};

const dim = (r: ReturnType<typeof buildMatchReport>, key: string) =>
  r.dimensions.find((d) => d.key === key)!;

describe("rozměry", () => {
  it("součet obou stran je vždy 10 (je to podíl, ne absolutní výkon)", () => {
    const r = buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, { home: 2, away: 0 });
    for (const d of r.dimensions) {
      expect(d.home + d.away).toBeCloseTo(10, 6);
    }
  });

  it("kontrolu hry určuje držení míče", () => {
    const d = dim(buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, null), "CONTROL");
    expect(d.available).toBe(true);
    expect(d.home).toBeCloseTo(6.4, 1);
    expect(d.detail).toContain("64");
  });

  it("bez držení míče spadne kontrola na přesné přihrávky", () => {
    const home = { ...DOMINANT_HOME, POSSESSION: undefined };
    const away = { ...DOMINATED_AWAY, POSSESSION: undefined };
    const d = dim(buildMatchReport(home, away, TEAMS, null), "CONTROL");
    expect(d.available).toBe(true);
    expect(d.home).toBeGreaterThan(5);
    expect(d.detail).toContain("přihrávky");
  });

  it("nebezpečnost jede z xG, a bez něj ze střel", () => {
    const withXg = dim(buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, null), "THREAT");
    expect(withXg.detail).toContain("xG");
    expect(withXg.home).toBeGreaterThan(7);

    const noXg = dim(
      buildMatchReport(
        { ...DOMINANT_HOME, XG: undefined },
        { ...DOMINATED_AWAY, XG: undefined },
        TEAMS,
        null
      ),
      "THREAT"
    );
    expect(noXg.available).toBe(true);
    expect(noXg.detail).toContain("na branku");
    expect(noXg.home).toBeGreaterThan(5);
  });

  it("proměňování BEZ xG není dostupné (samotné skóre není efektivita)", () => {
    const d = dim(
      buildMatchReport(
        { ...DOMINANT_HOME, XG: undefined },
        { ...DOMINATED_AWAY, XG: undefined },
        TEAMS,
        { home: 3, away: 0 }
      ),
      "FINISHING"
    );
    expect(d.available).toBe(false);
  });

  it("proměňování měří přebytek nad xG, ne počet gólů", () => {
    // Domácí: 1 gól z xG 2.4 (podstřelili), hosté: 2 góly z xG 0.5 (přestřelili).
    const d = dim(
      buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, { home: 1, away: 2 }),
      "FINISHING"
    );
    expect(d.available).toBe(true);
    expect(d.away).toBeGreaterThan(d.home);
  });
});

describe("povaha zápasu", () => {
  it("vysoké xG = otevřený, nízké = uzavřený", () => {
    const open = buildMatchReport({ XG: 2.0 }, { XG: 1.8 }, TEAMS, null);
    expect(open.character.openness).toBe("otevřený");
    const shut = buildMatchReport({ XG: 0.6 }, { XG: 0.5 }, TEAMS, null);
    expect(shut.character.openness).toBe("uzavřený");
  });

  it("vyrovnanost se čte z NEBEZPEČNOSTI, ne z výsledku", () => {
    // Vyrovnaná hra, ale výsledek 4:0 – zápas je pořád „vyrovnaný".
    const r = buildMatchReport({ XG: 1.3 }, { XG: 1.25 }, TEAMS, { home: 4, away: 0 });
    expect(r.character.balance).toBe("vyrovnaný");
    const oneSided = buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, { home: 0, away: 0 });
    expect(oneSided.character.balance).toBe("jednostranný");
  });

  it("fauly a karty určují ostrost", () => {
    const hot = buildMatchReport(
      { FOULS: 15, YELLOW_CARDS: 4 },
      { FOULS: 14, YELLOW_CARDS: 3 },
      TEAMS,
      null
    );
    expect(hot.character.intensity).toBe("ostrý");
    const calm = buildMatchReport(
      { FOULS: 7, YELLOW_CARDS: 0 },
      { FOULS: 8, YELLOW_CARDS: 1 },
      TEAMS,
      null
    );
    expect(calm.character.intensity).toBe("klidný");
  });
});

describe("verdikt", () => {
  it("pojmenuje rozpor mezi hrou a výsledkem", () => {
    const r = buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, { home: 0, away: 1 });
    expect(r.verdict).toContain("Sparta");
    expect(r.verdict).toContain("Slavia");
    expect(r.verdict).toContain("neodpovídá průběhu");
  });

  it("nemluví o „ovládnutí“ zápasu – verdikt stojí na nebezpečnosti, ne na držení", () => {
    // Tým s třetinou míče, který si vytvořil dvakrát víc (reálný případ: Bournemouth
    // 33 % držení, xG 1.78 vs 0.78). „Ovládli zápas“ by si odporovalo s Kontrolou hry.
    const r = buildMatchReport(
      { POSSESSION: 33, XG: 1.78 },
      { POSSESSION: 67, XG: 0.78 },
      TEAMS,
      { home: 0, away: 1 }
    );
    expect(r.verdict).not.toContain("ovládli");
    expect(r.verdict).toContain("vytvořili");
  });

  it("zasloužená výhra se pozná", () => {
    const r = buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, { home: 3, away: 0 });
    expect(r.verdict).toContain("zaslouž");
  });

  it("dominance bez výhry", () => {
    const r = buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, { home: 1, away: 1 });
    expect(r.verdict).toContain("nestačilo");
  });

  it("vyrovnaný zápas nedostane vítěze na hře", () => {
    const r = buildMatchReport({ XG: 1.2 }, { XG: 1.15 }, TEAMS, { home: 1, away: 1 });
    expect(r.verdict).toContain("Vyrovnaný");
  });
});

describe("pozorování", () => {
  it("upozorní na proměňování nad i pod očekáváním", () => {
    const r = buildMatchReport(DOMINANT_HOME, DOMINATED_AWAY, TEAMS, { home: 1, away: 2 });
    expect(r.notes.join(" ")).toContain("nevyužité");
    expect(r.notes.join(" ")).toContain("nadprůměrně");
  });

  it("pozná jalové držení míče", () => {
    const r = buildMatchReport(
      { POSSESSION: 65, XG: 0.4, SHOTS_ON_TARGET: 1 },
      { POSSESSION: 35, XG: 1.9, SHOTS_ON_TARGET: 7 },
      TEAMS,
      { home: 0, away: 2 }
    );
    expect(r.notes.join(" ")).toContain("nebezpečnější byl soupeř");
  });

  it("vyloučení je nejsilnější pozorování", () => {
    const r = buildMatchReport(
      { ...DOMINANT_HOME, RED_CARDS: 1 },
      DOMINATED_AWAY,
      TEAMS,
      { home: 1, away: 1 }
    );
    expect(r.notes[0]).toContain("vyloučení");
  });

  it("vrací nejvýš čtyři", () => {
    const r = buildMatchReport(
      { ...DOMINANT_HOME, RED_CARDS: 1, SAVES: 8, POSSESSION: 70, YELLOW_CARDS: 4 },
      { ...DOMINATED_AWAY, SAVES: 9, YELLOW_CARDS: 4 },
      TEAMS,
      { home: 1, away: 3 }
    );
    expect(r.notes.length).toBeLessThanOrEqual(4);
  });
});

describe("chybějící data", () => {
  it("prázdný zápas → available:false, ne vymyšlená čísla", () => {
    const r = buildMatchReport({}, {}, TEAMS, { home: 1, away: 0 });
    expect(r.available).toBe(false);
    expect(r.verdict).toBe("");
    expect(r.notes).toEqual([]);
    expect(r.dimensions.every((d) => !d.available)).toBe(true);
  });

  it("nula ku nule v metrice rozměr SKRYJE (není to 50:50)", () => {
    const r = buildMatchReport({ FOULS: 0 }, { FOULS: 0 }, TEAMS, null);
    expect(dim(r, "PHYSICAL").available).toBe(false);
  });

  it("částečná data dají částečný přehled", () => {
    const r = buildMatchReport(
      { POSSESSION: 60, FOULS: 10 },
      { POSSESSION: 40, FOULS: 12 },
      TEAMS,
      { home: 1, away: 0 }
    );
    expect(r.available).toBe(true);
    expect(dim(r, "CONTROL").available).toBe(true);
    expect(dim(r, "THREAT").available).toBe(false);
    expect(dim(r, "FINISHING").available).toBe(false);
    // Bez nebezpečnosti nejde říct, kdo byl lepší → žádný verdikt.
    expect(r.verdict).toBe("");
  });

  it("skóre se propíše do metrik (GOALS_FOR nemusí být ve statistikách)", () => {
    const r = buildMatchReport({ XG: 0.5 }, { XG: 0.4 }, TEAMS, { home: 3, away: 0 });
    expect(r.notes.join(" ")).toContain("3 góly z xG 0.50");
  });

  it("počty se skloňují (sdílená `czech.ts`, ne „3 gólů“ a „6 karet“ natvrdo)", () => {
    // Čísla se do vět dosazují z dat, takže bez skloňování vznikne „1 góly“.
    const one = buildMatchReport({ XG: 0.1 }, { XG: 0.4 }, TEAMS, { home: 1, away: 0 });
    expect(one.notes.join(" ")).toContain("1 gól z xG 0.10");

    const many = buildMatchReport({ XG: 0.5 }, { XG: 0.2 }, TEAMS, { home: 5, away: 0 });
    expect(many.notes.join(" ")).toContain("5 gólů z xG 0.50");
  });
});
