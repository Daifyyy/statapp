import { describe, it, expect } from "vitest";
import { selectCurrentInjuries, INJURY_MAX_AGE_DAYS } from "./injuries";
import type { ApiInjury } from "./apiFootball";

const NOW = new Date("2026-06-18T12:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function inj(
  id: number,
  name: string,
  date: string | null | undefined,
  reason?: string
): ApiInjury {
  return {
    player: { id, name },
    reason: reason ?? "Zranění kolene",
    type: "Missing Fixture",
    fixture: date === undefined ? undefined : { date },
  };
}

describe("selectCurrentInjuries", () => {
  it("ponechá nedávné zranění (v okně)", () => {
    const out = selectCurrentInjuries([inj(1, "A", daysAgo(3))], NOW);
    expect(out).toEqual([{ playerId: 1, name: "A", reason: "Zranění kolene" }]);
  });

  it("zahodí zastaralé zranění (starší než práh)", () => {
    const out = selectCurrentInjuries(
      [inj(1, "A", daysAgo(INJURY_MAX_AGE_DAYS + 5))],
      NOW
    );
    expect(out).toEqual([]);
  });

  it("zahodí záznam bez data zápasu", () => {
    expect(selectCurrentInjuries([inj(1, "A", null)], NOW)).toEqual([]);
    expect(selectCurrentInjuries([inj(1, "A", undefined)], NOW)).toEqual([]);
  });

  it("dedup dle hráče – ponechá nejnovější záznam", () => {
    const raw = [
      inj(1, "A", daysAgo(10), "Staré"),
      inj(1, "A", daysAgo(2), "Aktuální"),
    ];
    const out = selectCurrentInjuries(raw, NOW);
    expect(out).toEqual([{ playerId: 1, name: "A", reason: "Aktuální" }]);
  });

  it("fallback reason: type, pak 'Zranění'", () => {
    const a: ApiInjury = {
      player: { id: 1, name: "A" },
      reason: null,
      type: "Suspended",
      fixture: { date: daysAgo(1) },
    };
    const b: ApiInjury = {
      player: { id: 2, name: "B" },
      reason: null,
      type: null,
      fixture: { date: daysAgo(1) },
    };
    const out = selectCurrentInjuries([a, b], NOW);
    expect(out).toEqual([
      { playerId: 1, name: "A", reason: "Suspended" },
      { playerId: 2, name: "B", reason: "Zranění" },
    ]);
  });

  it("smíšený seznam: jen aktuální, seřazené nejnovější první", () => {
    const raw = [
      inj(1, "Old", daysAgo(40)),
      inj(2, "Fresh2", daysAgo(5)),
      inj(3, "NoDate", null),
      inj(4, "Fresh1", daysAgo(1)),
    ];
    const out = selectCurrentInjuries(raw, NOW);
    expect(out.map((o) => o.playerId)).toEqual([4, 2]);
  });
});
