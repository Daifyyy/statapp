import { describe, expect, it } from "vitest";
import type { MatchStat, Team } from "@/lib/types";
import { selectWindowMatches } from "./windows";
import { computeMetricValue } from "./aggregate";
import { compareTeams } from "./compare";
import { resolveSource } from "./resolveSource";
import { matchWeight, FRIENDLY_WEIGHT } from "./matchWeight";

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
    season: 2025,
    isBaseline: false,
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

  it("SEASON vezme jen zápasy baseline (minulé) sezóny", () => {
    const matches = [
      clubMatch(1, 7),
      clubMatch(2, 14, { isBaseline: true }),
      clubMatch(3, 21, { isBaseline: true }),
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

  it("LAST5 vrátí všechny, když je zápasů méně než 5", () => {
    const matches = [clubMatch(1, 7), clubMatch(2, 14), clubMatch(3, 21)];
    expect(selectWindowMatches(matches, "LAST5", NOW)).toHaveLength(3);
  });

  it("SEASON je prázdné, když žádný zápas není baseline", () => {
    const matches = [clubMatch(1, 7), clubMatch(2, 14)];
    expect(selectWindowMatches(matches, "SEASON", NOW)).toHaveLength(0);
  });

  it("BASE bere jen zápasy 12–24 měsíců zpět", () => {
    const matches = [
      clubMatch(1, 100), // ~3 m → moc čerstvé, mimo
      clubMatch(2, 400), // ~13 m → uvnitř
      clubMatch(3, 650), // ~21 m → uvnitř
      clubMatch(4, 800), // ~26 m → moc staré, mimo
    ];
    expect(selectWindowMatches(matches, "BASE", NOW)).toHaveLength(2);
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
    // Vážený průměr (1.0*3 + 0.4*1)/1.4 = 2.4286, zaokrouhleno na 2 des. místa.
    const expected = Math.round(((3 + FRIENDLY_WEIGHT) / (1 + FRIENDLY_WEIGHT)) * 100) / 100;
    expect(v.value).toBe(expected); // 2.43 > prostý průměr 2.0
    expect(v.value).toBeGreaterThan(2);
  });

  it("prázdný vzorek → value null a sampleSize 0", () => {
    const v = computeMetricValue([], "GOALS_FOR", "TOTAL", "CLUB", NOW);
    expect(v.value).toBeNull();
    expect(v.sampleSize).toBe(0);
    expect(v.lowConfidence).toBe(false);
  });

  it("metrika chybějící ve všech zápasech → value null", () => {
    const matches = [clubMatch(1, 5, { metrics: { GOALS_FOR: 2 } })];
    const v = computeMetricValue(matches, "XG", "TOTAL", "CLUB", NOW);
    expect(v.value).toBeNull();
  });

  it("lowConfidence a sampleSize používají stejný (zaokrouhlený) práh", () => {
    // 1 klubový zápas se započte v LAST10 i LAST5 → effectiveSample 2 < 4.
    const one = computeMetricValue([clubMatch(1, 5)], "GOALS_FOR", "TOTAL", "CLUB", NOW);
    expect(one.sampleSize).toBe(2);
    expect(one.lowConfidence).toBe(true);
    // 2 zápasy → effectiveSample 4 → už není nízká spolehlivost.
    const two = computeMetricValue(
      [clubMatch(1, 5), clubMatch(2, 12)],
      "GOALS_FOR",
      "TOTAL",
      "CLUB",
      NOW
    );
    expect(two.sampleSize).toBe(4);
    expect(two.lowConfidence).toBe(false);
  });
});

describe("matchWeight", () => {
  it("klub má vždy váhu 1", () => {
    expect(matchWeight(clubMatch(1, 5, { competitive: false }), "CLUB")).toBe(1);
  });
  it("reprezentace: přátelák má FRIENDLY_WEIGHT, soutěžní 1", () => {
    expect(matchWeight(clubMatch(1, 5, { competitive: false }), "NATIONAL")).toBe(
      FRIENDLY_WEIGHT
    );
    expect(matchWeight(clubMatch(2, 5, { competitive: true }), "NATIONAL")).toBe(1);
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

  const natTeam = (id: number, competitiveCount: number): Team => ({
    id,
    name: `N${id}`,
    logoUrl: "",
    country: `země${id}`,
    entityType: "NATIONAL",
    leagueId: 9001,
    leagueMatches: Array.from({ length: 6 }, (_, i) =>
      clubMatch(id * 100 + i, i * 14, { competitive: i < competitiveCount })
    ),
  });

  it("reprezentace s dostatkem soutěžních zápasů → NATIONAL", () => {
    const r = resolveSource(natTeam(1, 5), natTeam(2, 5));
    expect(r.source).toBe("NATIONAL");
    expect(r.sourceNote).toBeUndefined();
  });

  it("reprezentace s málo soutěžními → NATIONAL_FB s poznámkou", () => {
    const r = resolveSource(natTeam(1, 2), natTeam(2, 5));
    expect(r.source).toBe("NATIONAL_FB");
    expect(r.sourceNote).toBe("Včetně přátelských zápasů");
  });

  it("reprezentace vs klub → rozhoduje národní větev (entityType)", () => {
    const klub: Team = {
      id: 9, name: "Klub", logoUrl: "", country: "Anglie",
      entityType: "CLUB", leagueId: 39,
      leagueMatches: Array.from({ length: 6 }, (_, i) =>
        clubMatch(900 + i, i * 14, { competitive: true })
      ),
    };
    expect(resolveSource(natTeam(1, 5), klub).source).toBe("NATIONAL");
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

  // Reprezentacím se vynechává POUZE xG (má ho jen ~31 % zápasů se statistikami, u přáteláků
  // 2 %). Držení/přihrávky/střely z vápna se dřív vynechávaly taky, ale to bylo měřením
  // vyvráceno – mají je 99 % zápasů, u kterých API vůbec statistiky vrátí (viz NATIONAL_EXCLUDED).
  it("reprezentace nezahrnují xG, ale držení/přihrávky ano", () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      clubMatch(i, i * 14, { competitive: true })
    );
    const nat = (id: number): Team => ({
      id, name: `N${id}`, logoUrl: "", country: `z${id}`,
      entityType: "NATIONAL", leagueId: 9001, leagueMatches: matches,
    });
    const res = compareTeams(nat(1), nat(2), NOW);
    expect(res.metrics).not.toContain("XG");
    expect(res.metrics).toContain("POSSESSION");
    expect(res.metrics).toContain("PASS_ACCURACY");
    expect(res.metrics).toContain("SHOTS_INSIDE_BOX");
    expect(res.metrics).toContain("GOALS_FOR");
  });
});
