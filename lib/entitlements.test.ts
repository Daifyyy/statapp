import { describe, it, expect } from "vitest";
import { getEntitlement, toFreeResult } from "./entitlements";
import type { CompareResult } from "./types";

describe("getEntitlement", () => {
  it("PRO tier má vždy plný přístup, bez spotřeby trialu", () => {
    expect(getEntitlement({ tier: "PRO", proTrialUsed: false })).toEqual({
      pro: true,
      consumeTrial: false,
    });
    expect(
      getEntitlement({ tier: "PRO", proTrialUsed: true }, { unlockTrial: true })
    ).toEqual({ pro: true, consumeTrial: false });
  });

  it("FREE bez žádosti o trial → jen FREE obsah", () => {
    expect(getEntitlement({ tier: "FREE", proTrialUsed: false })).toEqual({
      pro: false,
      consumeTrial: false,
    });
  });

  it("FREE + žádost o trial + nevyužitý → odemkne a spotřebuje trial", () => {
    expect(
      getEntitlement({ tier: "FREE", proTrialUsed: false }, { unlockTrial: true })
    ).toEqual({ pro: true, consumeTrial: true });
  });

  it("FREE + žádost o trial, ale už využitý → zůstává zamčeno", () => {
    expect(
      getEntitlement({ tier: "FREE", proTrialUsed: true }, { unlockTrial: true })
    ).toEqual({ pro: false, consumeTrial: false });
  });

  it("anonym (null) nemá trial ani s žádostí", () => {
    expect(getEntitlement(null, { unlockTrial: true })).toEqual({
      pro: false,
      consumeTrial: false,
    });
  });
});

describe("toFreeResult", () => {
  const full: CompareResult = {
    source: "LEAGUE",
    sourceNote: "pozn",
    metrics: ["GOALS_FOR"] as CompareResult["metrics"],
    home: { team: { id: 1, name: "A", logoUrl: "", country: "" }, values: [], summary: [] },
    away: { team: { id: 2, name: "B", logoUrl: "", country: "" }, values: [], summary: [] },
    prediction: {
      available: true,
      lambdaHome: 1.5,
      lambdaAway: 1.1,
      homeWin: 0.4,
      draw: 0.3,
      awayWin: 0.3,
      bttsYes: 0.5,
      over25: 0.5,
      lowConfidence: false,
    },
    insightReport: { verdict: "x", keySignals: [], home: [], away: [] },
  };

  it("ořeže predikci a insights, zachová metriky/formu a označí locked", () => {
    const free = toFreeResult(full);
    expect(free.prediction).toBeUndefined();
    expect(free.insightReport).toBeUndefined();
    expect(free.locked).toBe(true);
    expect(free.metrics).toEqual(full.metrics);
    expect(free.home).toBe(full.home);
    expect(free.away).toBe(full.away);
    expect(free.source).toBe("LEAGUE");
    expect(free.sourceNote).toBe("pozn");
  });
});
