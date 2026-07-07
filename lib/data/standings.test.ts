import { describe, it, expect } from "vitest";
import { deriveLeagueAccess, pickTeamStanding } from "./standings";
import type { ApiStandingRow } from "./apiFootball";

function row(
  id: number,
  rank: number,
  over: Partial<ApiStandingRow> = {}
): ApiStandingRow {
  return {
    rank,
    team: { id, name: `T${id}`, logo: "" },
    points: rank === 1 ? 40 : 20,
    goalsDiff: 5,
    form: "WWDLW",
    all: { played: 10, win: 6, draw: 2, lose: 2, goals: { for: 18, against: 10 } },
    home: { played: 5, win: 4, draw: 1, lose: 0, goals: { for: 12, against: 4 } },
    away: { played: 5, win: 2, draw: 1, lose: 2, goals: { for: 6, against: 6 } },
    ...over,
  };
}

describe("pickTeamStanding", () => {
  it("vybere řádek daného týmu a normalizuje splity", () => {
    const out = pickTeamStanding([row(1, 1), row(2, 5)], 2);
    expect(out).toEqual({
      rank: 5,
      points: 20,
      goalsDiff: 5,
      form: "WWDLW",
      all: { played: 10, win: 6, draw: 2, lose: 2, goalsFor: 18, goalsAgainst: 10 },
      home: { played: 5, win: 4, draw: 1, lose: 0, goalsFor: 12, goalsAgainst: 4 },
      away: { played: 5, win: 2, draw: 1, lose: 2, goalsFor: 6, goalsAgainst: 6 },
    });
  });

  it("tým mimo tabulku → null", () => {
    expect(pickTeamStanding([row(1, 1)], 99)).toBeNull();
  });

  it("chybějící číselná pole i splity doplní na 0 / null form", () => {
    const bare: ApiStandingRow = { rank: 3, team: { id: 7, name: "T7", logo: "" } };
    const out = pickTeamStanding([bare], 7);
    expect(out).toEqual({
      rank: 3,
      points: 0,
      goalsDiff: 0,
      form: null,
      all: { played: 0, win: 0, draw: 0, lose: 0, goalsFor: 0, goalsAgainst: 0 },
      home: { played: 0, win: 0, draw: 0, lose: 0, goalsFor: 0, goalsAgainst: 0 },
      away: { played: 0, win: 0, draw: 0, lose: 0, goalsFor: 0, goalsAgainst: 0 },
    });
  });
});

describe("deriveLeagueAccess", () => {
  it("odvodí evropské příčky a sestupový blok z reálných description řetězců", () => {
    const raw = [
      row(1, 1, { description: "Promotion - Champions League (Group Stage)" }),
      row(2, 2, { description: "Promotion - Champions League (Group Stage)" }),
      row(3, 3, { description: "Promotion - Champions League (Qualification)" }),
      row(4, 4, { description: "Promotion - Europa League (Play Offs)" }),
      row(5, 5, { description: "Promotion - Conference League (Qualification)" }),
      row(6, 6, { description: null }),
      row(7, 7, { description: null }),
      row(8, 8, { description: "Relegation - Relegation Play-offs" }),
      row(9, 9, { description: "Relegation" }),
      row(10, 10, { description: "Relegation" }),
    ];
    expect(deriveLeagueAccess(raw)).toEqual({
      slots: [
        { rank: 1, spot: "UCL" },
        { rank: 2, spot: "UCL" },
        { rank: 3, spot: "UCL_Q" },
        { rank: 4, spot: "UEL_Q" },
        { rank: 5, spot: "UECL_Q" },
      ],
      relegBottom: 3,
    });
  });

  it("žádný řádek s rozpoznatelným popisem → null (fallback na kurátorovanou tabulku)", () => {
    const raw = [row(1, 1, { description: null }), row(2, 2, { description: undefined })];
    expect(deriveLeagueAccess(raw)).toBeNull();
  });

  it("neznámý/neparsovatelný popis se ignoruje, ale nerozbije ostatní řádky", () => {
    const raw = [
      row(1, 1, { description: "Promotion - Champions League (Group Stage)" }),
      row(2, 2, { description: "Something unexpected" }),
    ];
    expect(deriveLeagueAccess(raw)).toEqual({
      slots: [{ rank: 1, spot: "UCL" }],
      relegBottom: 0,
    });
  });
});
