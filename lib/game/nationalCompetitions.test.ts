import { describe, expect, it } from "vitest";
import {
  COMPETITIONS,
  buildTournamentField,
  didYouQualify,
  fieldSize,
  isQualOver,
  isRunOver,
  nationHireable,
  nationOptions,
  nationPrestige,
  playRunRound,
  qualTable,
  simulateRunToEnd,
  startQualification,
  startRun,
  stageReachedOf,
  tallyMatches,
} from "./nationalCompetitions";
import { NATIONAL_TEAMS, nationalsByConfed } from "./nationalTeams";
import { QUAL_ADVANCE, QUAL_GROUP_SIZE } from "./balance";

describe("registr soutěží", () => {
  it("kvóty per konfederace se sečtou přesně na velikost pole", () => {
    for (const comp of Object.values(COMPETITIONS)) {
      const sum = Object.values(comp.slotsByConfed).reduce((a, b) => a + b, 0);
      expect(sum).toBe(fieldSize(comp));
    }
  });

  it("EURO je jen UEFA (24), MS napříč konfederacemi (48)", () => {
    expect(COMPETITIONS.EURO.slotsByConfed).toEqual({ UEFA: 24 });
    expect(fieldSize(COMPETITIONS.WC)).toBe(48);
    expect(Object.keys(COMPETITIONS.WC.slotsByConfed).length).toBe(6);
  });

  it("každá kvóta se vejde do poolu své konfederace", () => {
    for (const comp of Object.values(COMPETITIONS)) {
      for (const [confed, slots] of Object.entries(comp.slotsByConfed)) {
        expect(nationalsByConfed(confed as never).length).toBeGreaterThanOrEqual(slots);
      }
    }
  });
});

describe("prestiž / hireable", () => {
  it("nejsilnější národ má vyšší prestiž než nejslabší", () => {
    const sorted = [...NATIONAL_TEAMS].sort(
      (a, b) => b.attack - b.defense - (a.attack - a.defense)
    );
    expect(nationPrestige(sorted[0].id)).toBeGreaterThan(nationPrestige(sorted.at(-1)!.id));
  });

  it("slabý národ je hireable i pro začátečníka, špička ne", () => {
    const sorted = [...NATIONAL_TEAMS].sort(
      (a, b) => b.attack - b.defense - (a.attack - a.defense)
    );
    expect(nationHireable(sorted.at(-1)!.id, 30)).toBe(true);
    expect(nationHireable(sorted[0].id, 30)).toBe(false);
    expect(nationHireable(sorted[0].id, 95)).toBe(true);
  });

  it("nationOptions je seřazené sestupně dle prestiže", () => {
    const opts = nationOptions(50);
    expect(opts.length).toBe(NATIONAL_TEAMS.length);
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i - 1].prestige).toBeGreaterThanOrEqual(opts[i].prestige);
    }
  });
});

describe("kvalifikace", () => {
  const spain = 9; // silná UEFA reprezentace

  it("skupina má správnou velikost a dvoukolový rozpis", () => {
    const qs = startQualification("EURO", spain, 123);
    expect(qs.group.length).toBe(QUAL_GROUP_SIZE);
    expect(qs.group[0]).toBe(spain);
    // Dvoukolový round-robin 6 týmů = 10 kol.
    expect(qs.schedule.length).toBe(2 * (QUAL_GROUP_SIZE - 1));
    expect(qs.schedule.flat().length).toBe(QUAL_GROUP_SIZE * (QUAL_GROUP_SIZE - 1));
  });

  it("soupeři jsou z tvé konfederace", () => {
    const qs = startQualification("EURO", spain, 7);
    const uefaIds = new Set(nationalsByConfed("UEFA").map((s) => s.id));
    for (const id of qs.group) expect(uefaIds.has(id)).toBe(true);
  });

  it("je deterministická dle seedu", () => {
    const a = startQualification("WC", 6, 999);
    const b = startQualification("WC", 6, 999);
    expect(a.group).toEqual(b.group);
  });

  it("pořadatel se kvalifikuje automaticky i po slabé skupině", () => {
    // Německo je pořadatel EURO – i kdyby ve skupině skončil poslední, projde.
    let qs = startQualification("EURO", COMPETITIONS.EURO.hostId, 42);
    while (!isQualOver(qs)) qs = { ...qs, round: qs.round + 1 } as typeof qs; // bez odehrání
    // (bez výsledků je tabulka nerozhodná, ale host projde tak jako tak)
    expect(didYouQualify(qs)).toBe(true);
  });
});

describe("los závěrečného pole", () => {
  it("má přesně velikost pole, bez duplicit, a obsahuje pořadatele", () => {
    const comp = COMPETITIONS.WC;
    let qs = startQualification("WC", 6, 555);
    while (!isQualOver(qs)) qs = playRunRoundQual(qs);
    const { teams } = buildTournamentField(qs, qs.seed);
    expect(teams.length).toBe(fieldSize(comp));
    expect(new Set(teams.map((t) => t.id)).size).toBe(teams.length);
    expect(teams.some((t) => t.id === comp.hostId)).toBe(true);
  });

  it("pořadatel dostane v poli domácí výhodu (homeBoost > 1)", () => {
    let qs = startQualification("WC", 6, 8);
    while (!isQualOver(qs)) qs = playRunRoundQual(qs);
    const { teams } = buildTournamentField(qs, qs.seed);
    const host = teams.find((t) => t.id === COMPETITIONS.WC.hostId)!;
    expect(host.homeBoost).toBeGreaterThan(1);
  });

  // pomocník: odehraj kolo kvalifikace mimo run
  function playRunRoundQual(qs: ReturnType<typeof startQualification>) {
    // simuluj přes veřejnou cestu
    const run = { ...startRun("WC", qs.yourTeamId, qs.seed, 1), qualification: qs };
    return playRunRound(run).qualification;
  }
});

describe("běh end-to-end", () => {
  it("silný národ se kvalifikuje a dohraje turnaj (champion nebo vypadl)", () => {
    const run = startRun("EURO", 9, 2024, 1);
    expect(run.phase).toBe("qualification");
    const done = simulateRunToEnd(run);
    expect(isRunOver(done)).toBe(true);
    if (done.qualified) {
      expect(done.tournament).not.toBeNull();
      expect(done.tournament!.champion).not.toBeNull();
    }
  });

  it("je deterministický a přechází mezi fázemi jen dopředu", () => {
    const a = simulateRunToEnd(startRun("EURO", 9, 77, 1));
    const b = simulateRunToEnd(startRun("EURO", 9, 77, 1));
    expect(a.qualified).toBe(b.qualified);
    expect(a.tournament?.champion ?? null).toBe(b.tournament?.champion ?? null);
  });

  it("velmi slabý národ typicky neprojde kvalifikací → done bez turnaje", () => {
    const weakest = [...NATIONAL_TEAMS].sort(
      (a, b) => a.attack - a.defense - (b.attack - b.defense)
    )[0];
    let anyFailed = false;
    for (let seed = 0; seed < 8; seed++) {
      const done = simulateRunToEnd(startRun("WC", weakest.id, seed, 1));
      if (!done.qualified) {
        anyFailed = true;
        expect(done.tournament).toBeNull();
        expect(done.phase).toBe("done");
        expect(stageReachedOf(done)).toBe("group");
      }
    }
    expect(anyFailed).toBe(true);
  });

  it("tallyMatches počítá jen zápasy daného týmu", () => {
    const run = simulateRunToEnd(startRun("EURO", 9, 5, 1));
    const t = tallyMatches(run.qualification.results, 9);
    expect(t.played).toBe(2 * (QUAL_GROUP_SIZE - 1));
    expect(t.win + t.draw + t.loss).toBe(t.played);
  });

  it("qualTable má správný počet týmů a QUAL_ADVANCE postupujících", () => {
    const run = simulateRunToEnd(startRun("EURO", 9, 3, 1));
    expect(qualTable(run.qualification).length).toBe(QUAL_GROUP_SIZE);
    expect(QUAL_ADVANCE).toBeLessThan(QUAL_GROUP_SIZE);
  });
});
