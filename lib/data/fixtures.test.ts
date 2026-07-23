import { describe, expect, it } from "vitest";
import { fullTimeGoals, normalizeUpcomingFixtures, pickRound } from "./fixtures";
import type { ApiFixture } from "./apiFootball";

/** Odehraný zápas: `goals` = koncové skóre, `score.fulltime` = stav po 90 min. */
function played(
  goals: { home: number | null; away: number | null },
  fulltime?: { home: number | null; away: number | null }
): ApiFixture {
  return {
    fixture: { id: 1, date: "2026-06-20T18:00:00+00:00", status: { short: "AET" } },
    league: { id: 1, season: 2026, name: "World Cup" },
    teams: {
      home: { id: 10, name: "Home", logo: "h.png" },
      away: { id: 20, name: "Away", logo: "a.png" },
    },
    goals,
    ...(fulltime ? { score: { fulltime } } : {}),
  } as ApiFixture;
}

function fx(
  id: number,
  leagueId: number,
  status: string,
  date: string,
  overrides: Partial<{ leagueName: string }> = {}
): ApiFixture {
  return {
    fixture: { id, date, status: { short: status } },
    league: { id: leagueId, season: 2025, name: overrides.leagueName ?? "Liga" },
    teams: {
      home: { id: id * 10 + 1, name: `Home${id}`, logo: "h.png" },
      away: { id: id * 10 + 2, name: `Away${id}`, logo: "a.png" },
    },
    goals: { home: null, away: null },
  } as ApiFixture;
}

/** Živý zápas: běžící status + minuta (`elapsed`) + živé skóre (`goals`). */
function liveFx(
  id: number,
  leagueId: number,
  status: string,
  date: string,
  elapsed: number | null,
  goals: { home: number | null; away: number | null }
): ApiFixture {
  return {
    fixture: { id, date, status: { short: status, elapsed } },
    league: { id: leagueId, season: 2025, name: "Liga" },
    teams: {
      home: { id: id * 10 + 1, name: `Home${id}`, logo: "h.png" },
      away: { id: id * 10 + 2, name: `Away${id}`, logo: "a.png" },
    },
    goals,
  } as ApiFixture;
}

/** Fixní „teď" – všechny testovací výkopy níže leží po něm (= nadcházející). */
const NOW = new Date("2026-06-23T10:00:00+00:00");

describe("normalizeUpcomingFixtures", () => {
  it("vyřadí ligy mimo sledovaný seznam", () => {
    const raw = [
      fx(1, 39, "NS", "2026-06-23T18:00:00+00:00"), // Premier League – sledovaná
      fx(2, 999999, "NS", "2026-06-23T18:00:00+00:00"), // neznámá liga – pryč
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.map((f) => f.leagueId)).toEqual([39]);
  });

  it("vyřadí dohrané zápasy (FT/AET/PEN)", () => {
    const raw = [
      fx(1, 39, "FT", "2026-06-23T12:00:00+00:00"),
      fx(2, 39, "NS", "2026-06-23T18:00:00+00:00"),
      fx(3, 39, "AET", "2026-06-23T12:00:00+00:00"),
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.map((f) => f.fixtureId)).toEqual([2]);
  });

  it("vyřadí zápas s výkopem v minulosti i když má status NS (hodinu stará cache)", () => {
    // Přesně případ Argentina–Švýcarsko: zápas se ráno odehrál, ale denní rozpis
    // v `ApiCache` ho ještě nese jako `NS` → status by ho v Programu nechal.
    const raw = [
      fx(1, 1, "NS", "2026-06-23T03:00:00+00:00"), // už začal → pryč
      fx(2, 1, "NS", "2026-06-23T21:00:00+00:00"), // večer → zůstává
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.map((f) => f.fixtureId)).toEqual([2]);
  });

  it("vyřadí odložené / zrušené / kontumované (drží původní datum výkopu)", () => {
    const raw = [
      fx(1, 39, "PST", "2026-06-23T18:00:00+00:00"),
      fx(2, 39, "CANC", "2026-06-23T18:00:00+00:00"),
      fx(3, 39, "ABD", "2026-06-23T18:00:00+00:00"),
      fx(4, 39, "NS", "2026-06-23T18:00:00+00:00"),
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.map((f) => f.fixtureId)).toEqual([4]);
  });

  it("řadí dle výkopu vzestupně", () => {
    const raw = [
      fx(1, 39, "NS", "2026-06-23T20:00:00+00:00"),
      fx(2, 140, "NS", "2026-06-23T16:00:00+00:00"),
      fx(3, 135, "NS", "2026-06-23T18:00:00+00:00"),
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.map((f) => f.fixtureId)).toEqual([2, 3, 1]);
  });

  it("označí reprezentační soutěž jako national", () => {
    const raw = [
      fx(1, 39, "NS", "2026-06-23T18:00:00+00:00"), // klub
      fx(2, 1, "NS", "2026-06-23T18:00:00+00:00"), // MS = národní turnaj
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.find((f) => f.leagueId === 39)?.national).toBe(false);
    expect(out.find((f) => f.leagueId === 1)?.national).toBe(true);
  });

  it("klubový zápas má CLUB mód s leagueId u obou stran (deep-link ready)", () => {
    const out = normalizeUpcomingFixtures(
      [fx(1, 39, "NS", "2026-06-23T18:00:00+00:00")],
      NOW
    );
    expect(out[0].compareMode).toBe("CLUB");
    expect(out[0].homeCompareLeagueId).toBe(39);
    expect(out[0].awayCompareLeagueId).toBe(39);
  });

  it("použije kurátorovaný název ligy z katalogu, ne syrový název z API", () => {
    const out = normalizeUpcomingFixtures(
      [fx(1, 39, "NS", "2026-06-23T18:00:00+00:00", { leagueName: "English Premier League" })],
      NOW
    );
    expect(out[0].leagueName).toBe("Premier League");
  });

  it("neznámá liga (mimo katalog) ponechá syrový název z API jako fallback", () => {
    const out = normalizeUpcomingFixtures(
      [fx(1, 1, "NS", "2026-06-23T18:00:00+00:00", { leagueName: "FIFA World Cup" })],
      NOW
    );
    expect(out[0].leagueName).toBe("FIFA World Cup");
  });

  it("reprezentační zápas má NATIONAL mód a konfederace null (dotahuje repo)", () => {
    const out = normalizeUpcomingFixtures(
      [fx(1, 1, "NS", "2026-06-23T18:00:00+00:00")],
      NOW
    );
    expect(out[0].compareMode).toBe("NATIONAL");
    expect(out[0].homeCompareLeagueId).toBeNull();
    expect(out[0].awayCompareLeagueId).toBeNull();
  });

  it("ponechá živý zápas (1H) i s výkopem v minulosti a naplní minutu + skóre", () => {
    // Výkop v 9:12, teď 10:00 → běží 48. minuta. Přes „kickoff v minulosti" nepropadne,
    // protože živost čteme ze statusu.
    const raw = [
      liveFx(1, 39, "1H", "2026-06-23T09:12:00+00:00", 48, { home: 1, away: 0 }),
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].live).toBe(true);
    expect(out[0].elapsed).toBe(48);
    expect(out[0].liveHome).toBe(1);
    expect(out[0].liveAway).toBe(0);
  });

  it("ponechá zápas o poločase (HT); nadcházející nemá live flag", () => {
    const raw = [
      liveFx(1, 39, "HT", "2026-06-23T09:00:00+00:00", 45, { home: 0, away: 0 }),
      fx(2, 39, "NS", "2026-06-23T20:00:00+00:00"),
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.find((f) => f.fixtureId === 1)?.live).toBe(true);
    expect(out.find((f) => f.fixtureId === 2)?.live).toBeUndefined();
  });

  it("dohraný (FT) i stale-NS-po-výkopu jdou ven i s živými sourozenci", () => {
    const raw = [
      liveFx(1, 39, "2H", "2026-06-23T08:00:00+00:00", 70, { home: 2, away: 1 }), // živý → zůstává
      fx(2, 39, "FT", "2026-06-23T06:00:00+00:00"), // dohraný → ven
      fx(3, 39, "NS", "2026-06-23T03:00:00+00:00"), // stale NS po výkopu → ven
    ];
    const out = normalizeUpcomingFixtures(raw, NOW);
    expect(out.map((f) => f.fixtureId)).toEqual([1]);
  });
});

/** Zápas s kolem a skóre – pro testy `pickRound`. */
function roundFx(
  id: number,
  round: string,
  status: string,
  date: string,
  goals: { home: number | null; away: number | null } = { home: null, away: null }
): ApiFixture {
  return {
    fixture: { id, date, status: { short: status } },
    league: { id: 39, season: 2025, name: "Liga", round },
    teams: {
      home: { id: id * 10 + 1, name: `Home${id}`, logo: "h.png" },
      away: { id: id * 10 + 2, name: `Away${id}`, logo: "a.png" },
    },
    goals,
  } as ApiFixture;
}

describe("pickRound", () => {
  it("last: vybere skupinu s nejnovějším průměrným datem z odehraných zápasů", () => {
    const raw = [
      roundFx(1, "Regular Season - 1", "FT", "2026-06-01T18:00:00+00:00", { home: 1, away: 0 }),
      roundFx(2, "Regular Season - 2", "FT", "2026-06-08T18:00:00+00:00", { home: 2, away: 2 }),
      roundFx(3, "Regular Season - 2", "FT", "2026-06-08T20:00:00+00:00", { home: 0, away: 1 }),
      roundFx(4, "Regular Season - 3", "NS", "2026-06-15T18:00:00+00:00"), // nadcházející → mimo "last"
    ];
    const out = pickRound(raw, "last");
    expect(out.map((f) => f.fixtureId)).toEqual([2, 3]);
    expect(out[0].homeGoals).toBe(2);
    expect(out[0].awayGoals).toBe(2);
  });

  it("next: vybere skupinu s nejbližším průměrným datem z nadcházejících zápasů", () => {
    const raw = [
      roundFx(1, "Regular Season - 3", "NS", "2026-06-15T18:00:00+00:00"),
      roundFx(2, "Regular Season - 4", "NS", "2026-06-22T18:00:00+00:00"),
      roundFx(3, "Regular Season - 4", "NS", "2026-06-22T20:00:00+00:00"),
    ];
    const out = pickRound(raw, "next");
    expect(out.map((f) => f.fixtureId)).toEqual([1]);
  });

  it("prázdný vstup vrátí prázdné pole", () => {
    expect(pickRound([], "last")).toEqual([]);
    expect(pickRound([], "next")).toEqual([]);
  });
});

describe("fullTimeGoals", () => {
  it("zápas rozhodnutý v prodloužení → skóre po 90 min, ne koncové", () => {
    // 1:1 po 90 min, 2:1 po prodloužení. Model predikuje 90 min → remíza.
    expect(fullTimeGoals(played({ home: 2, away: 1 }, { home: 1, away: 1 }))).toEqual({
      home: 1,
      away: 1,
    });
  });

  it("běžný zápas: score.fulltime == goals", () => {
    expect(fullTimeGoals(played({ home: 3, away: 0 }, { home: 3, away: 0 }))).toEqual({
      home: 3,
      away: 0,
    });
  });

  it("bez score.fulltime spadne zpět na goals", () => {
    expect(fullTimeGoals(played({ home: 2, away: 1 }))).toEqual({ home: 2, away: 1 });
  });

  it("neznámé skóre → null", () => {
    expect(fullTimeGoals(played({ home: null, away: null }))).toBeNull();
  });
});
