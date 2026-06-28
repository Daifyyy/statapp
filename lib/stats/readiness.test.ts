import { describe, expect, it } from "vitest";
import type { Metric, MetricValue, TeamComparison, Venue } from "@/lib/types";
import {
  PREDICTION_READY_SAMPLE,
  computeReadiness,
  readinessLevel,
  readinessOf,
} from "./readiness";

/** TeamComparison s daným vzorkem na všech venue (volitelně override per venue). */
function team(
  sampleSize: number,
  overrides: { metric: Metric; venue: Venue; sampleSize: number }[] = []
): TeamComparison {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const metrics: Metric[] = ["GOALS_FOR", "GOALS_AGAINST"];
  const values: MetricValue[] = [];
  for (const metric of metrics) {
    for (const venue of venues) {
      const o = overrides.find((x) => x.metric === metric && x.venue === venue);
      values.push({
        metric,
        venue,
        value: 1.4,
        lowConfidence: false,
        sampleSize: o ? o.sampleSize : sampleSize,
        breakdown: [],
      });
    }
  }
  return { team: { id: 1, name: "T", logoUrl: "", country: "" }, values, summary: [] };
}

describe("readinessLevel / readinessOf", () => {
  it("úrovně podle prahů", () => {
    expect(readinessLevel(0)).toBe("low");
    expect(readinessLevel(3)).toBe("low");
    expect(readinessLevel(PREDICTION_READY_SAMPLE)).toBe("medium");
    expect(readinessLevel(5)).toBe("medium");
    expect(readinessLevel(6)).toBe("ok");
    expect(readinessLevel(12)).toBe("ok");
  });

  it("skóre roste a ořezává se na 1", () => {
    expect(readinessOf(0).score).toBe(0);
    expect(readinessOf(3).score).toBeCloseTo(0.5);
    expect(readinessOf(6).score).toBe(1);
    expect(readinessOf(10).score).toBe(1);
  });

  it("záporný vzorek se ošetří na 0", () => {
    expect(readinessOf(-2).sample).toBe(0);
    expect(readinessOf(-2).level).toBe("low");
  });
});

describe("computeReadiness", () => {
  it("plný vzorek u obou → ok", () => {
    const r = computeReadiness(team(10), team(10));
    expect(r.sample).toBe(10);
    expect(r.level).toBe("ok");
    expect(r.score).toBe(1);
  });

  it("nejslabší vstup určuje připravenost (min ze 4)", () => {
    // Host má tenkou obranu venku (1 zápas) → to gatuje celé.
    const away = team(10, [{ metric: "GOALS_AGAINST", venue: "AWAY", sampleSize: 1 }]);
    const r = computeReadiness(team(10), away);
    expect(r.sample).toBe(1);
    expect(r.level).toBe("low");
  });

  it("prázdná venue varianta → fallback na TOTAL", () => {
    // HOME/AWAY vzorek 0, ale TOTAL 8 → readiness z TOTAL (neutrální reprezentace).
    const t = team(0, [
      { metric: "GOALS_FOR", venue: "TOTAL", sampleSize: 8 },
      { metric: "GOALS_AGAINST", venue: "TOTAL", sampleSize: 8 },
    ]);
    const r = computeReadiness(t, t);
    expect(r.sample).toBe(8);
    expect(r.level).toBe("ok");
  });

  it("žádná data → sample 0, low", () => {
    const empty: TeamComparison = {
      team: { id: 1, name: "X", logoUrl: "", country: "" },
      values: [],
      summary: [],
    };
    const r = computeReadiness(empty, empty);
    expect(r.sample).toBe(0);
    expect(r.level).toBe("low");
  });
});
