import { describe, expect, it } from "vitest";
import { emptyProfile, foldSeason, foldTournament } from "./profile";
import { updateReputation, updateReputationTournament } from "./reputation";
import {
  newlyEarnedTournament,
  evaluateTournamentAchievements,
  ALL_ACHIEVEMENTS,
  ACHIEVEMENTS,
  TOURNAMENT_ACHIEVEMENTS,
} from "./achievements";
import { simulateRunToEnd, startRun, summarizeRun } from "./nationalCompetitions";
import {
  TOURN_CHAMPION_REP,
  TOURN_MISS_REP,
  TOURN_QUALIFY_REP,
  TOURN_STAGE_REP,
} from "./balance";
import type { SeasonSummary, TournamentSummary } from "./types";

function tsummary(over: Partial<TournamentSummary> = {}): TournamentSummary {
  return {
    competitionId: "EURO",
    competitionName: "ME",
    edition: 1,
    teamId: 9,
    teamName: "Spain",
    qualified: true,
    stageReached: "qf",
    champion: false,
    played: 10,
    win: 6,
    draw: 2,
    loss: 2,
    goalsFor: 18,
    goalsAgainst: 8,
    ...over,
  };
}

function ssummary(over: Partial<SeasonSummary> = {}): SeasonSummary {
  return {
    season: 1,
    leagueId: 39,
    leagueName: "PL",
    yourTeamId: 1,
    yourName: "T",
    yourRank: 1,
    expectedRank: 1,
    yourPoints: 90,
    win: 28,
    draw: 6,
    loss: 4,
    goalsFor: 80,
    goalsAgainst: 30,
    cleanSheets: 15,
    champion: true,
    europe: "UCL",
    relegated: false,
    championId: 1,
    championName: "T",
    objectiveMet: true,
    ...over,
  };
}

describe("emptyProfile", () => {
  it("inicializuje reprezentační pole", () => {
    const a = emptyProfile().allTime;
    expect(a.tournamentsPlayed).toBe(0);
    expect(a.majorTitles).toBe(0);
    expect(a.finalsReached).toBe(0);
    expect(a.nationsCoached).toEqual([]);
  });
});

describe("foldTournament", () => {
  it("nesahá na ligové rekordy (titles/bestRank/leaguesCoached)", () => {
    // Nejdřív ligová sezóna → titul, pak turnaj.
    let p = foldSeason(emptyProfile(), ssummary(), 60);
    expect(p.allTime.titles).toBe(1);
    const before = { ...p.allTime };
    p = foldTournament(p, tsummary({ champion: true, stageReached: "final" }));
    expect(p.allTime.titles).toBe(before.titles); // ligové tituly beze změny
    expect(p.allTime.bestRank).toBe(before.bestRank);
    expect(p.allTime.leaguesCoached).toEqual(before.leaguesCoached);
    // Reprezentační pole se naplnila.
    expect(p.allTime.tournamentsPlayed).toBe(1);
    expect(p.allTime.majorTitles).toBe(1);
    expect(p.allTime.finalsReached).toBe(1);
    expect(p.allTime.nationsCoached).toEqual([9]);
  });

  it("distinct nationsCoached", () => {
    let p = foldTournament(emptyProfile(), tsummary({ teamId: 9 }));
    p = foldTournament(p, tsummary({ teamId: 9 }));
    p = foldTournament(p, tsummary({ teamId: 2 }));
    expect(p.allTime.nationsCoached).toEqual([9, 2]);
    expect(p.allTime.tournamentsPlayed).toBe(3);
  });

  it("funguje i na starém profilu bez reprezentačních polí", () => {
    const legacy = emptyProfile();
    delete legacy.allTime.tournamentsPlayed;
    delete legacy.allTime.nationsCoached;
    const p = foldTournament(legacy, tsummary({ champion: true }));
    expect(p.allTime.tournamentsPlayed).toBe(1);
    expect(p.allTime.majorTitles).toBe(1);
    expect(p.allTime.nationsCoached).toEqual([9]);
  });
});

describe("updateReputationTournament", () => {
  it("neúspěch v kvalifikaci reputaci ubere", () => {
    expect(updateReputationTournament(50, tsummary({ qualified: false, stageReached: "group" })))
      .toBe(50 + TOURN_MISS_REP);
  });

  it("postup + fáze + titul se sčítají", () => {
    const champ = tsummary({ qualified: true, stageReached: "final", champion: true });
    expect(updateReputationTournament(50, champ)).toBe(
      50 + TOURN_QUALIFY_REP + TOURN_STAGE_REP.final + TOURN_CHAMPION_REP
    );
  });

  it("clampuje 0–100", () => {
    expect(updateReputationTournament(0, tsummary({ qualified: false }))).toBeGreaterThanOrEqual(0);
    expect(
      updateReputationTournament(98, tsummary({ stageReached: "final", champion: true }))
    ).toBe(100);
  });

  it("nelze zaměnit s ligovou updateReputation (jiný typ vstupu)", () => {
    // sanity: ligová stále funguje nezávisle
    expect(updateReputation(50, ssummary({ champion: false, europe: "NONE", yourRank: 10, expectedRank: 10 })))
      .toBeTypeOf("number");
  });
});

describe("summarizeRun", () => {
  it("agreguje kvalifikaci i turnaj a označí mistra", () => {
    const done = simulateRunToEnd(startRun("EURO", 9, 4242, 1));
    const sum = summarizeRun(done);
    expect(sum.competitionId).toBe("EURO");
    expect(sum.teamId).toBe(9);
    expect(sum.win + sum.draw + sum.loss).toBe(sum.played);
    expect(sum.played).toBeGreaterThanOrEqual(10); // aspoň kvalifikace
    expect(sum.qualified).toBe(done.qualified);
    if (done.tournament?.champion === 9) expect(sum.champion).toBe(true);
  });
});

describe("reprezentační achievementy", () => {
  it("debut + kvalifikace se odemknou", () => {
    const profile = foldTournament(emptyProfile(), tsummary({ qualified: true }));
    const earned = newlyEarnedTournament([], {
      allTime: profile.allTime,
      last: tsummary({ qualified: true }),
      reputation: 55,
    });
    const ids = earned.map((a) => a.id);
    expect(ids).toContain("nat_debut");
    expect(ids).toContain("nat_qualify");
  });

  it("Euro vs MS titul se rozlišuje dle competitionId", () => {
    const ctxEuro = {
      allTime: emptyProfile().allTime,
      last: tsummary({ champion: true, competitionId: "EURO", stageReached: "final" }),
      reputation: 70,
    };
    expect(evaluateTournamentAchievements(ctxEuro)).toContain("nat_euro");
    expect(evaluateTournamentAchievements(ctxEuro)).not.toContain("nat_world");
  });

  it("ALL_ACHIEVEMENTS sjednocuje oba registry bez kolize id", () => {
    expect(ALL_ACHIEVEMENTS.length).toBe(ACHIEVEMENTS.length + TOURNAMENT_ACHIEVEMENTS.length);
    expect(new Set(ALL_ACHIEVEMENTS.map((a) => a.id)).size).toBe(ALL_ACHIEVEMENTS.length);
  });
});
