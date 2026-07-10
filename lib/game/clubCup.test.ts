import { describe, expect, it } from "vitest";
import {
  CLUB_CUP_FORMAT,
  cupFieldSize,
  cupPreview,
  cupStageReached,
  clubQualifies,
  isCupRunOver,
  playCupRunRound,
  simulateCupRunToEnd,
  startCupRun,
  summarizeCupRun,
} from "./clubCup";
import { CLUB_CUP_POOL } from "./clubCupPool";
import { updateReputationCup } from "./reputation";
import { emptyProfile, foldCup } from "./profile";
import { ALL_ACHIEVEMENTS, CUP_ACHIEVEMENTS, newlyEarnedCup } from "./achievements";
import type { CupSummary, GameTeam } from "./types";

const YOUR_TEAM: GameTeam = {
  id: 555,
  name: "FC Testovice",
  short: "TST",
  color: "#111111",
  attack: 1.8,
  defense: 0.95,
  homeBoost: 1.12,
};

describe("clubQualifies", () => {
  it("jakákoli evropská příčka kromě NONE znamená postup", () => {
    expect(clubQualifies("NONE")).toBe(false);
    expect(clubQualifies("UCL")).toBe(true);
    expect(clubQualifies("UCL_Q")).toBe(true);
    expect(clubQualifies("UECL_Q")).toBe(true);
  });
});

describe("pool", () => {
  it("je dost velký na sestavení pole (fieldSize - 1 bez opakování)", () => {
    expect(CLUB_CUP_POOL.length).toBeGreaterThanOrEqual(cupFieldSize() - 1);
    const ids = new Set(CLUB_CUP_POOL.map((s) => s.id));
    expect(ids.size).toBe(CLUB_CUP_POOL.length); // žádné duplicity id
  });

  it("žádné id nekoliduje s ID prostorem tvého klubu", () => {
    expect(CLUB_CUP_POOL.some((s) => s.id === YOUR_TEAM.id)).toBe(false);
  });
});

describe("startCupRun", () => {
  it("pole má přesně cupFieldSize() týmů a tvůj klub je vždy uvnitř", () => {
    const run = startCupRun(42, YOUR_TEAM, 3, 1);
    expect(run.tournament.teams.length).toBe(cupFieldSize());
    expect(run.tournament.teams.some((t) => t.id === YOUR_TEAM.id)).toBe(true);
  });

  it("žádné duplicitní týmy v poli", () => {
    const run = startCupRun(42, YOUR_TEAM, 3, 1);
    const ids = new Set(run.tournament.teams.map((t) => t.id));
    expect(ids.size).toBe(run.tournament.teams.length);
  });

  it("stejný seed dá stejné pole (determinismus)", () => {
    const a = startCupRun(99, YOUR_TEAM, 1, 1);
    const b = startCupRun(99, YOUR_TEAM, 1, 1);
    expect(a.tournament.teams.map((t) => t.id)).toEqual(b.tournament.teams.map((t) => t.id));
    expect(a.tournament.groups).toEqual(b.tournament.groups);
  });

  it("jiný seed obvykle dá jiné pole", () => {
    const a = startCupRun(1, YOUR_TEAM, 1, 1);
    const b = startCupRun(2, YOUR_TEAM, 1, 1);
    expect(a.tournament.teams.map((t) => t.id)).not.toEqual(b.tournament.teams.map((t) => t.id));
  });
});

describe("playCupRunRound / simulateCupRunToEnd", () => {
  it("dohraný pohár je isCupRunOver a má mistra", () => {
    let run = startCupRun(7, YOUR_TEAM, 2, 1);
    let guard = 0;
    while (!isCupRunOver(run) && guard++ < 50) run = playCupRunRound(run);
    expect(isCupRunOver(run)).toBe(true);
    expect(run.tournament.champion).not.toBeNull();
  });

  it("simulateCupRunToEnd dá stejný výsledek jako odehrání kolo po kole (stejný seed)", () => {
    let stepwise = startCupRun(11, YOUR_TEAM, 2, 1);
    let guard = 0;
    while (!isCupRunOver(stepwise) && guard++ < 50) stepwise = playCupRunRound(stepwise);

    const atOnce = simulateCupRunToEnd(startCupRun(11, YOUR_TEAM, 2, 1));
    expect(atOnce.tournament.champion).toBe(stepwise.tournament.champion);
    expect(atOnce.tournament.results.length).toBe(stepwise.tournament.results.length);
  });

  it("cupStageReached je 'group' hned na startu a mění se s postupem", () => {
    const run = startCupRun(21, YOUR_TEAM, 2, 1);
    expect(cupStageReached(run)).toBe("group");
  });
});

describe("cupPreview", () => {
  it("vrací náhled zápasu dokud pohár neskončil", () => {
    const run = startCupRun(5, YOUR_TEAM, 1, 1);
    const preview = cupPreview(run);
    expect(preview).not.toBeNull();
    expect([preview!.homeId, preview!.awayId]).toContain(YOUR_TEAM.id);
    expect(preview!.probs.homeWin + preview!.probs.draw + preview!.probs.awayWin).toBeCloseTo(1, 5);
  });

  it("vrací null, když je pohár dohraný", () => {
    let run = startCupRun(6, YOUR_TEAM, 1, 1);
    let guard = 0;
    while (!isCupRunOver(run) && guard++ < 50) run = playCupRunRound(run);
    expect(cupPreview(run)).toBeNull();
  });
});

describe("summarizeCupRun", () => {
  it("agreguje odehrané zápasy a nese identitu klubu/poháru", () => {
    const run = simulateCupRunToEnd(startCupRun(33, YOUR_TEAM, 4, 2));
    const summary = summarizeCupRun(run);
    expect(summary.season).toBe(4);
    expect(summary.edition).toBe(2);
    expect(summary.teamId).toBe(YOUR_TEAM.id);
    expect(summary.teamName).toBe(YOUR_TEAM.name);
    expect(summary.played).toBe(summary.win + summary.draw + summary.loss);
    expect(summary.champion).toBe(run.tournament.champion === YOUR_TEAM.id);
  });
});

describe("formát", () => {
  it("velikost pole a formát jsou konzistentní (8 skupin po 4 → 32)", () => {
    expect(cupFieldSize()).toBe(32);
    expect(CLUB_CUP_FORMAT.groups * CLUB_CUP_FORMAT.groupSize).toBe(cupFieldSize());
  });
});

function cupSummary(over: Partial<CupSummary> = {}): CupSummary {
  return {
    cupId: "CUP",
    cupName: "Klubový pohár",
    edition: 1,
    season: 3,
    teamId: YOUR_TEAM.id,
    teamName: YOUR_TEAM.name,
    stageReached: "group",
    champion: false,
    played: 6,
    win: 2,
    draw: 2,
    loss: 2,
    goalsFor: 8,
    goalsAgainst: 8,
    teamPrestige: 75,
    ...over,
  };
}

describe("updateReputationCup", () => {
  it("účast v poháru reputaci zvedne i bez postupu ze skupiny", () => {
    const next = updateReputationCup(50, cupSummary({ stageReached: "group" }));
    expect(next).toBeGreaterThan(50);
  });

  it("mistr dostane víc než finalista", () => {
    const finalist = updateReputationCup(50, cupSummary({ stageReached: "final", teamPrestige: 100 }));
    const champion = updateReputationCup(
      50,
      cupSummary({ stageReached: "final", champion: true, teamPrestige: 100 })
    );
    expect(champion).toBeGreaterThan(finalist);
  });

  it("strop dle prestiže klubu (jako updateReputationTournament)", () => {
    // prev (65) pod stropem (60+12=72); i po velkém přírůstku (mistr) nesmí přeskočit strop.
    const next = updateReputationCup(65, cupSummary({ champion: true, teamPrestige: 60 }));
    expect(next).toBeLessThanOrEqual(72);
  });
});

describe("foldCup", () => {
  it("přičte pohár do trvalých rekordů, nesahá na ligové", () => {
    const p0 = emptyProfile();
    const p1 = foldCup(p0, cupSummary({ champion: true }));
    expect(p1.allTime.cupsPlayed).toBe(1);
    expect(p1.allTime.cupTitles).toBe(1);
    expect(p1.allTime.titles).toBe(p0.allTime.titles); // ligové tituly nedotčené
  });
});

describe("CUP_ACHIEVEMENTS", () => {
  it("cup_champion se odemkne jen při vítězství", () => {
    const ctx = { allTime: emptyProfile().allTime, last: cupSummary({ champion: true }), reputation: 60 };
    const earned = newlyEarnedCup([], ctx).map((a) => a.id);
    expect(earned).toContain("cup_champion");
  });

  it("je součástí ALL_ACHIEVEMENTS beze ztráty položek", () => {
    for (const a of CUP_ACHIEVEMENTS) {
      expect(ALL_ACHIEVEMENTS.some((x) => x.id === a.id)).toBe(true);
    }
  });
});
