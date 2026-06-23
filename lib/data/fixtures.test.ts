import { describe, expect, it } from "vitest";
import { normalizeUpcomingFixtures } from "./fixtures";
import type { ApiFixture } from "./apiFootball";

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

describe("normalizeUpcomingFixtures", () => {
  it("vyřadí ligy mimo sledovaný seznam", () => {
    const raw = [
      fx(1, 39, "NS", "2026-06-23T18:00:00+00:00"), // Premier League – sledovaná
      fx(2, 999999, "NS", "2026-06-23T18:00:00+00:00"), // neznámá liga – pryč
    ];
    const out = normalizeUpcomingFixtures(raw);
    expect(out.map((f) => f.leagueId)).toEqual([39]);
  });

  it("vyřadí dohrané zápasy (FT/AET/PEN)", () => {
    const raw = [
      fx(1, 39, "FT", "2026-06-23T12:00:00+00:00"),
      fx(2, 39, "NS", "2026-06-23T18:00:00+00:00"),
      fx(3, 39, "AET", "2026-06-23T12:00:00+00:00"),
    ];
    const out = normalizeUpcomingFixtures(raw);
    expect(out.map((f) => f.fixtureId)).toEqual([2]);
  });

  it("řadí dle výkopu vzestupně", () => {
    const raw = [
      fx(1, 39, "NS", "2026-06-23T20:00:00+00:00"),
      fx(2, 140, "NS", "2026-06-23T16:00:00+00:00"),
      fx(3, 135, "NS", "2026-06-23T18:00:00+00:00"),
    ];
    const out = normalizeUpcomingFixtures(raw);
    expect(out.map((f) => f.fixtureId)).toEqual([2, 3, 1]);
  });

  it("označí reprezentační soutěž jako national", () => {
    const raw = [
      fx(1, 39, "NS", "2026-06-23T18:00:00+00:00"), // klub
      fx(2, 1, "NS", "2026-06-23T18:00:00+00:00"), // MS = národní turnaj
    ];
    const out = normalizeUpcomingFixtures(raw);
    expect(out.find((f) => f.leagueId === 39)?.national).toBe(false);
    expect(out.find((f) => f.leagueId === 1)?.national).toBe(true);
  });

  it("klubový zápas má CLUB mód s leagueId u obou stran (deep-link ready)", () => {
    const out = normalizeUpcomingFixtures([
      fx(1, 39, "NS", "2026-06-23T18:00:00+00:00"),
    ]);
    expect(out[0].compareMode).toBe("CLUB");
    expect(out[0].homeCompareLeagueId).toBe(39);
    expect(out[0].awayCompareLeagueId).toBe(39);
  });

  it("reprezentační zápas má NATIONAL mód a konfederace null (dotahuje repo)", () => {
    const out = normalizeUpcomingFixtures([
      fx(1, 1, "NS", "2026-06-23T18:00:00+00:00"),
    ]);
    expect(out[0].compareMode).toBe("NATIONAL");
    expect(out[0].homeCompareLeagueId).toBeNull();
    expect(out[0].awayCompareLeagueId).toBeNull();
  });
});
