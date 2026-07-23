import { describe, expect, it } from "vitest";
import type {
  MatchResult,
  Metric,
  MetricValue,
  TeamComparison,
  TeamSummary,
  Venue,
} from "@/lib/types";
import { predictMatch } from "@/lib/stats/predict";
import { buildTeamContext } from "./context";
import { runInsightEngine } from "./engine";

const NOW = new Date("2026-06-12T00:00:00Z");

function comparison(
  name: string,
  vals: Partial<Record<Metric, number>>,
  form: MatchResult[] = [],
  cleanSheetPct: number | null = null
): TeamComparison {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const values: MetricValue[] = [];
  for (const [metric, value] of Object.entries(vals)) {
    for (const venue of venues) {
      values.push({
        metric: metric as Metric,
        venue,
        value,
        lowConfidence: false,
        sampleSize: 10,
        breakdown: [],
      });
    }
  }
  const summary: TeamSummary[] = venues.map((venue) => ({
    venue,
    form,
    formOpponents: form.map(() => null),
    formSampleSize: form.length,
    cleanSheetPct,
    failedToScorePct: null,
    sampleSize: 10,
  }));
  return {
    team: { id: name.length, name, logoUrl: "", country: "" },
    values,
    summary,
  };
}

function report(home: TeamComparison, away: TeamComparison) {
  const prediction = predictMatch(home, away);
  return runInsightEngine({
    home: buildTeamContext("home", home, [], "CLUB", NOW),
    away: buildTeamContext("away", away, [], "CLUB", NOW),
    prediction,
    entityType: "CLUB",
  });
}

describe("runInsightEngine", () => {
  it("vrátí verdikt a klíčové signály (řazené, max 5)", () => {
    const home = comparison("Domácí", { GOALS_FOR: 2.4, GOALS_AGAINST: 0.7 }, ["W", "W", "W", "W", "D"]);
    const away = comparison("Host", { GOALS_FOR: 0.8, GOALS_AGAINST: 2.0 }, ["L", "L", "D", "L", "W"]);
    const r = report(home, away);

    expect(r.verdict.length).toBeGreaterThan(0);
    expect(r.keySignals.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < r.keySignals.length; i++) {
      expect(r.keySignals[i - 1].score).toBeGreaterThanOrEqual(r.keySignals[i].score);
    }
  });

  it("silný útok proti děravé obraně → maticový signál o tlaku na góly", () => {
    const home = comparison("Domácí", { GOALS_FOR: 2.4, GOALS_AGAINST: 1.0 });
    const away = comparison("Host", { GOALS_FOR: 1.1, GOALS_AGAINST: 2.0 });
    const r = report(home, away);
    const all = [...r.keySignals, ...r.home, ...r.away];
    expect(all.some((s) => s.text.includes("tlak na góly"))).toBe(true);
  });

  it("favorit se propíše do verdiktu", () => {
    const home = comparison("Sparta", { GOALS_FOR: 2.6, GOALS_AGAINST: 0.6 }, ["W", "W", "W", "W", "W"]);
    const away = comparison("Slabý", { GOALS_FOR: 0.6, GOALS_AGAINST: 2.4 }, ["L", "L", "L", "L", "L"]);
    const r = report(home, away);
    expect(r.verdict).toContain("Sparta");
  });

  it("vyrovnané týmy → neutrální verdikt", () => {
    const home = comparison("A", { GOALS_FOR: 1.4, GOALS_AGAINST: 1.4 });
    const away = comparison("B", { GOALS_FOR: 1.4, GOALS_AGAINST: 1.4 });
    const r = report(home, away);
    expect(r.verdict).toContain("Vyrovnaný");
  });

  it("per-tým signály jsou naplněné a řazené dle score", () => {
    const home = comparison("Domácí", { GOALS_FOR: 2.2, GOALS_AGAINST: 0.7, POSSESSION: 62 }, ["W", "W", "W", "W", "W"], 60);
    const away = comparison("Host", { GOALS_FOR: 0.7, GOALS_AGAINST: 1.9 });
    const r = report(home, away);
    expect(r.home.length).toBeGreaterThan(0);
    for (let i = 1; i < r.home.length; i++) {
      expect(r.home[i - 1].score).toBeGreaterThanOrEqual(r.home[i].score);
    }
  });
});
