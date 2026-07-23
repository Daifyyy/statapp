import { describe, expect, it } from "vitest";
import type {
  EntityType,
  Metric,
  MetricValue,
  TeamComparison,
  Venue,
} from "@/lib/types";
import { predictMatch } from "@/lib/stats/predict";
import { buildTeamContext } from "./context";
import { runInsightEngine } from "./engine";

const NOW = new Date("2026-06-12T00:00:00Z");

/** TeamComparison s odlišnými hodnotami GOALS_FOR per varianta (HOME/AWAY/TOTAL). */
function teamPerVenue(
  name: string,
  gf: Record<Venue, number>,
  ga = 1.0
): TeamComparison {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const values: MetricValue[] = [];
  for (const venue of venues) {
    values.push(mvOf("GOALS_FOR", venue, gf[venue]));
    values.push(mvOf("GOALS_AGAINST", venue, ga));
  }
  return {
    team: { id: name.length, name, logoUrl: "", country: "" },
    values,
    summary: venues.map((venue) => ({
      venue,
      form: [],
      formOpponents: [],
      formSampleSize: 0,
      cleanSheetPct: null,
      failedToScorePct: null,
      sampleSize: 5,
    })),
  };
}

function mvOf(metric: Metric, venue: Venue, value: number): MetricValue {
  return { metric, venue, value, lowConfidence: false, sampleSize: 10, breakdown: [] };
}

function reportFor(
  home: TeamComparison,
  away: TeamComparison,
  entityType: EntityType
) {
  const prediction = predictMatch(home, away);
  return runInsightEngine({
    home: buildTeamContext("home", home, [], entityType, NOW),
    away: buildTeamContext("away", away, [], entityType, NOW),
    prediction,
    entityType,
  });
}

describe("buildTeamContext – perspektivní venue", () => {
  it("klub: domácí → HOME, host → AWAY; reprezentace → TOTAL", () => {
    const c = teamPerVenue("X", { HOME: 2, AWAY: 1, TOTAL: 1.5 });
    expect(buildTeamContext("home", c, [], "CLUB", NOW).venue).toBe("HOME");
    expect(buildTeamContext("away", c, [], "CLUB", NOW).venue).toBe("AWAY");
    expect(buildTeamContext("home", c, [], "NATIONAL", NOW).venue).toBe("TOTAL");
  });
});

describe("insighty čtou perspektivní venue (klub)", () => {
  it("domácí útok bere HOME hodnotu, hostující AWAY hodnotu", () => {
    const home = teamPerVenue("Domácí", { HOME: 2.4, AWAY: 0.9, TOTAL: 1.6 });
    const away = teamPerVenue("Host", { HOME: 0.8, AWAY: 2.2, TOTAL: 1.5 });
    const r = reportFor(home, away, "CLUB");
    const all = [...r.keySignals, ...r.home, ...r.away];
    // Domácí silný útok ze své HOME hodnoty (2.4), host ze své AWAY (2.2).
    expect(all.some((s) => s.text.includes("2.4"))).toBe(true);
    expect(all.some((s) => s.text.includes("2.2"))).toBe(true);
    // NESmí vzít celkové (1.6 / 1.5) jako hodnotu útoku.
    expect(all.some((s) => s.text.includes("Silný útok (1.6"))).toBe(false);
  });
});

describe("reprezentace – TOTAL, predikce nezávislá na pořadí", () => {
  // HOME/AWAY prázdné (sampleSize 0) → perspektiva spadne na TOTAL.
  function natTeam(name: string, gfTotal: number, gaTotal: number): TeamComparison {
    const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
    const values: MetricValue[] = [];
    for (const venue of venues) {
      const empty = venue !== "TOTAL";
      values.push({ metric: "GOALS_FOR", venue, value: empty ? null : gfTotal, lowConfidence: empty, sampleSize: empty ? 0 : 12, breakdown: [] });
      values.push({ metric: "GOALS_AGAINST", venue, value: empty ? null : gaTotal, lowConfidence: empty, sampleSize: empty ? 0 : 12, breakdown: [] });
    }
    return {
      team: { id: name.length, name, logoUrl: "", country: "" },
      values,
      summary: venues.map((venue) => ({ venue, form: [], formOpponents: [], formSampleSize: 0, cleanSheetPct: null, failedToScorePct: null, sampleSize: venue === "TOTAL" ? 12 : 0 })),
    };
  }

  it("prohození týmů dá zrcadlovou predikci", () => {
    const a = natTeam("A", 2.2, 0.8);
    const b = natTeam("B", 0.9, 1.9);
    const ab = predictMatch(a, b);
    const ba = predictMatch(b, a);
    expect(ab.homeWin).toBeCloseTo(ba.awayWin, 5);
    expect(ab.awayWin).toBeCloseTo(ba.homeWin, 5);
  });

  it("predikce reprezentací není označená jako nízká spolehlivost kvůli prázdnému HOME", () => {
    const a = natTeam("A", 1.6, 1.2);
    const b = natTeam("B", 1.4, 1.3);
    expect(predictMatch(a, b).lowConfidence).toBe(false);
  });
});
