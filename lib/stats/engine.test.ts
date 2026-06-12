import { describe, expect, it } from "vitest";
import type { MatchStat, Team } from "@/lib/types";
import { selectWindowMatches } from "./windows";
import { computeMetricValue } from "./aggregate";
import { compareTeams } from "./compare";
import { resolveSource } from "./resolveSource";

const NOW = new Date("2026-06-12T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function clubMatch(
  id: number,
  daysAgo: number,
  opts: Partial<MatchStat> = {}
): MatchStat {
  return {
    fixtureId: id,
    date: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    isHome: true,
    isNeutral: false,
    competitive: true,
    isPreviousSeason: false,
    metrics: { GOALS_FOR: 2 },
    ...opts,
  };
}

describe("selectWindowMatches", () => {
  it("LAST5 vezme 5 nejnovějších aktuálních zápasů", () => {
    const matches = Array.from({ length: 12 }, (_, i) =>
      clubMatch(i, i * 7)
    );
    expect(selectWindowMatches(matches, "LAST5", NOW)).toHaveLength(5);
  });

  it("SEASON vezme jen zápasy minulé sezóny", () => {
    const matches = [
      clubMatch(1, 7),
      clubMatch(2, 14, { isPreviousSeason: true }),
      clubMatch(3, 21, { isPreviousSeason: true }),
    ];
    expect(selectWindowMatches(matches, "SEASON", NOW)).toHaveLength(2);
  });

  it("reprezentační LAST6 vezme jen zápasy z posledních 6 měsíců", () => {
    const matches = [
      clubMatch(1, 30),
      clubMatch(2, 120),
      clubMatch(3, 300), // ~10 měsíců → mimo
    ];
    expect(selectWindowMatches(matches, "LAST6", NOW)).toHaveLength(2);
  });
});

describe("computeMetricValue", () => {
  it("neutrální zápas se nezapočítá do HOME/AWAY, ale do TOTAL", () => {
    const matches: MatchStat[] = [
      clubMatch(1, 5, { isNeutral: true, isHome: false, metrics: { GOALS_FOR: 4 } }),
      clubMatch(2, 12, { isHome: true, metrics: { GOALS_FOR: 2 } }),
    ];
    const home = computeMetricValue(matches, "GOALS_FOR", "HOME", "NATIONAL", NOW);
    const total = computeMetricValue(matches, "GOALS_FOR", "TOTAL", "NATIONAL", NOW);
    expect(home.value).toBe(2); // jen domácí zápas
    expect(total.sampleSize).toBeGreaterThan(home.sampleSize);
  });

  it("soutěžní zápas má u reprezentace vyšší váhu než přátelák", () => {
    const matches: MatchStat[] = [
      clubMatch(1, 5, { competitive: true, metrics: { GOALS_FOR: 3 } }),
      clubMatch(2, 12, { competitive: false, metrics: { GOALS_FOR: 1 } }),
    ];
    const v = computeMetricValue(matches, "GOALS_FOR", "TOTAL", "NATIONAL", NOW);
    // Vážený průměr (1.0*3 + 0.4*1)/1.4 = 2.43 > prostý průměr 2.0
    expect(v.value).toBeGreaterThan(2);
  });
});

describe("resolveSource", () => {
  const base = {
    logoUrl: "",
    leagueMatches: [clubMatch(1, 5)],
  };
  const teamA: Team = {
    ...base, id: 1, name: "A", country: "Anglie",
    entityType: "CLUB", leagueId: 39,
  };
  const teamB: Team = {
    ...base, id: 2, name: "B", country: "Anglie",
    entityType: "CLUB", leagueId: 39,
  };

  it("stejná liga → zdroj LEAGUE", () => {
    expect(resolveSource(teamA, teamB).source).toBe("LEAGUE");
  });

  it("různé země bez evropských dat → FALLBACK s upozorněním", () => {
    const r = resolveSource(teamA, { ...teamB, leagueId: 140, country: "Španělsko" });
    expect(r.source).toBe("FALLBACK");
    expect(r.sourceNote).toBe("Data z domácí ligy");
  });
});

describe("compareTeams (smoke)", () => {
  it("vrátí hodnoty i insights pro oba týmy", () => {
    const matches = Array.from({ length: 14 }, (_, i) =>
      clubMatch(i, i * 7, { isHome: i % 2 === 0 })
    );
    const team = (id: number): Team => ({
      id, name: `T${id}`, logoUrl: "", country: "Anglie",
      entityType: "CLUB", leagueId: 39, leagueMatches: matches,
    });
    const res = compareTeams(team(1), team(2), NOW);
    expect(res.metrics).toContain("XG");
    expect(res.home.values.length).toBeGreaterThan(0);
    expect(res.away.values.length).toBeGreaterThan(0);
  });
});
