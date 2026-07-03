import { describe, it, expect } from "vitest";
import { pickTeamScorers } from "./scorers";
import type { ApiTopScorer } from "./apiFootball";

function sc(id: number, name: string, teamId: number, goals: number | null): ApiTopScorer {
  return {
    player: { id, name },
    statistics: [
      { team: { id: teamId, name: `T${teamId}`, logo: "" }, goals: { total: goals } },
    ],
  };
}

describe("pickTeamScorers", () => {
  it("vybere hráče daného týmu, seřazené sestupně dle gólů, top N", () => {
    const raw = [
      sc(1, "A", 10, 18),
      sc(2, "B", 20, 15),
      sc(3, "C", 10, 12),
      sc(4, "D", 10, 9),
      sc(5, "E", 10, 5),
    ];
    const out = pickTeamScorers(raw, 10, 3);
    expect(out).toEqual([
      { playerId: 1, name: "A", goals: 18 },
      { playerId: 3, name: "C", goals: 12 },
      { playerId: 4, name: "D", goals: 9 },
    ]);
  });

  it("tým bez střelce ve špičce → prázdné", () => {
    expect(pickTeamScorers([sc(1, "A", 10, 18)], 99)).toEqual([]);
  });

  it("zahodí hráče bez gólů / bez klubu", () => {
    const raw: ApiTopScorer[] = [
      sc(1, "A", 10, 0),
      sc(2, "B", 10, null),
      { player: { id: 3, name: "C" }, statistics: [] },
    ];
    expect(pickTeamScorers(raw, 10)).toEqual([]);
  });
});
