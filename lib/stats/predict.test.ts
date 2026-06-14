import { describe, expect, it } from "vitest";
import type { Metric, MetricValue, TeamComparison, Venue } from "@/lib/types";
import { predictMatch } from "./predict";

/** Postaví minimální TeamComparison s danými hodnotami metrik (stejné pro všechny venue). */
function team(
  vals: Partial<Record<Metric, number>>,
  lowConfidence = false
): TeamComparison {
  const venues: Venue[] = ["HOME", "AWAY", "TOTAL"];
  const values: MetricValue[] = [];
  for (const [metric, value] of Object.entries(vals)) {
    for (const venue of venues) {
      values.push({
        metric: metric as Metric,
        venue,
        value,
        lowConfidence,
        sampleSize: 10,
        breakdown: [],
      });
    }
  }
  return {
    team: { id: 1, name: "T", logoUrl: "", country: "" },
    values,
    summary: [],
  };
}

describe("predictMatch", () => {
  it("symetrické týmy → homeWin ≈ awayWin a součet ≈ 1", () => {
    const a = team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 });
    const b = team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 });
    const p = predictMatch(a, b);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 5);
    expect(Math.abs(p.homeWin - p.awayWin)).toBeLessThan(0.02);
  });

  it("silný útok doma vs slabá obrana hosta → výrazně vyšší homeWin", () => {
    const home = team({ GOALS_FOR: 2.6, GOALS_AGAINST: 0.8 });
    const away = team({ GOALS_FOR: 0.7, GOALS_AGAINST: 2.4 });
    const p = predictMatch(home, away);
    expect(p.homeWin).toBeGreaterThan(p.awayWin);
    expect(p.homeWin).toBeGreaterThan(0.5);
    expect(p.lambdaHome).toBeGreaterThan(p.lambdaAway);
  });

  it("over25 roste s očekávanými góly", () => {
    const low = predictMatch(
      team({ GOALS_FOR: 0.6, GOALS_AGAINST: 0.6 }),
      team({ GOALS_FOR: 0.6, GOALS_AGAINST: 0.6 })
    );
    const high = predictMatch(
      team({ GOALS_FOR: 2.5, GOALS_AGAINST: 2.5 }),
      team({ GOALS_FOR: 2.5, GOALS_AGAINST: 2.5 })
    );
    expect(high.over25).toBeGreaterThan(low.over25);
    expect(low.bttsYes).toBeGreaterThanOrEqual(0);
    expect(high.bttsYes).toBeLessThanOrEqual(1);
  });

  it("chybějící venue hodnoty → fallback na TOTAL (stále počítá)", () => {
    // Jen TOTAL hodnoty (žádné HOME/AWAY) – fallback v valueOrTotal.
    const onlyTotal = (gf: number, ga: number): TeamComparison => ({
      team: { id: 1, name: "T", logoUrl: "", country: "" },
      values: [
        { metric: "GOALS_FOR", venue: "TOTAL", value: gf, lowConfidence: false, sampleSize: 8, breakdown: [] },
        { metric: "GOALS_AGAINST", venue: "TOTAL", value: ga, lowConfidence: false, sampleSize: 8, breakdown: [] },
      ],
      summary: [],
    });
    const p = predictMatch(onlyTotal(2, 1), onlyTotal(1, 2));
    expect(p.lambdaHome).toBeGreaterThan(0);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 5);
  });

  it("lowConfidence se propíše z podkladových metrik", () => {
    const p = predictMatch(
      team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 }, true),
      team({ GOALS_FOR: 1.5, GOALS_AGAINST: 1.5 }, true)
    );
    expect(p.lowConfidence).toBe(true);
  });
});
