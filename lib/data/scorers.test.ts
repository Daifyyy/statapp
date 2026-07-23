import { describe, it, expect } from "vitest";
import { pickLeagueAssists, pickLeagueScorers, pickTeamScorers } from "./scorers";
import type { ApiTopScorer } from "./apiFootball";

function sc(
  id: number,
  name: string,
  teamId: number,
  goals: number | null,
  assists: number | null = null
): ApiTopScorer {
  return {
    player: { id, name },
    statistics: [
      {
        team: { id: teamId, name: `T${teamId}`, logo: `logo${teamId}.png` },
        goals: { total: goals, assists },
      },
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

describe("pickLeagueScorers", () => {
  it("vybere top N napříč CELOU ligou (bez filtru na tým), s klubem", () => {
    const raw = [sc(1, "A", 10, 18), sc(2, "B", 20, 15), sc(3, "C", 30, 5)];
    const out = pickLeagueScorers(raw, 2);
    expect(out).toEqual([
      { playerId: 1, name: "A", value: 18, teamId: 10, teamName: "T10", teamLogo: "logo10.png" },
      { playerId: 2, name: "B", value: 15, teamId: 20, teamName: "T20", teamLogo: "logo20.png" },
    ]);
  });
});

describe("pickLeagueAssists", () => {
  it("řadí dle asistencí, ne gólů", () => {
    const raw = [sc(1, "A", 10, 18, 2), sc(2, "B", 20, 0, 9)];
    const out = pickLeagueAssists(raw, 10);
    expect(out.map((s) => s.playerId)).toEqual([2, 1]);
    expect(out[0].value).toBe(9);
  });
});
