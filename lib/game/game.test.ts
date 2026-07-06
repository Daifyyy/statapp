import { describe, expect, it } from "vitest";
import { generateLeague, LEAGUE_SIZE, standingsToTeams, amplifySpread } from "./teams";
import { evaluateSeason, teamPrestige, leagueStars, seasonObjective, teamStrengthScore } from "./leagues";
import { expectedRank, updateReputation, isHireable } from "./reputation";
import { teamSeasonStats } from "./analysis";
import { cleanSheetsOf } from "./career";
import { roundRobin } from "./schedule";
import { buildTable } from "./standings";
import { matchLambdas, predictProbs, simulateMatch, NEUTRAL_ADJUST } from "./simulate";
import {
  newSeason,
  simulateToEnd,
  isSeasonOver,
  currentTable,
  setPlan,
  yourNextMatch,
} from "./engine";
import { summarizeSeason, startNextSeason, careerStats } from "./career";
import { resolvePlan } from "./plans";
import { moraleFactor, updateMorale } from "./morale";
import { maybeEvent, applyEventChoice, EVENTS, getEvent } from "./events";
import { mulberry32 } from "./rng";
import type { GameTeam, MatchResult, SeasonState } from "./types";

describe("generateLeague", () => {
  it("dá 20 týmů s validními ratingy a je deterministická", () => {
    const a = generateLeague(123);
    const b = generateLeague(123);
    expect(a).toHaveLength(LEAGUE_SIZE);
    expect(a).toEqual(b); // stejný seed = stejná liga
    for (const t of a) {
      expect(t.attack).toBeGreaterThan(0);
      expect(t.defense).toBeGreaterThan(0);
      expect(t.homeBoost).toBeGreaterThanOrEqual(1);
    }
    // Různý seed → jiná liga
    expect(generateLeague(999)).not.toEqual(a);
  });
});

describe("roundRobin", () => {
  it("38 kol, každé kolo 10 zápasů, každý s každým 2× (jednou doma, jednou venku)", () => {
    const ids = generateLeague(1).map((t) => t.id);
    const schedule = roundRobin(ids);
    expect(schedule).toHaveLength(38);
    for (const round of schedule) expect(round).toHaveLength(10);

    const pairCount = new Map<string, number>();
    const homeAway = new Map<string, Set<string>>();
    let total = 0;
    for (const round of schedule) {
      const seen = new Set<number>();
      for (const f of round) {
        total++;
        // V rámci kola hraje každý tým max jednou
        expect(seen.has(f.homeId)).toBe(false);
        expect(seen.has(f.awayId)).toBe(false);
        seen.add(f.homeId);
        seen.add(f.awayId);
        const key = [f.homeId, f.awayId].sort((a, b) => a - b).join("-");
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        const hk = `${f.homeId}v${f.awayId}`;
        if (!homeAway.has(key)) homeAway.set(key, new Set());
        homeAway.get(key)!.add(hk);
      }
    }
    // 20*19 = 380 zápasů celkem
    expect(total).toBe(380);
    // Každá dvojice hraje přesně 2× a v obou variantách domácí/venku
    for (const [, c] of pairCount) expect(c).toBe(2);
    for (const [, set] of homeAway) expect(set.size).toBe(2);
  });

  it("odmítne lichý počet týmů", () => {
    expect(() => roundRobin([1, 2, 3])).toThrow();
  });
});

describe("buildTable", () => {
  it("správně počítá body, zápasy a řadí podle bodů → rozdílu → vstřelených", () => {
    const results: MatchResult[] = [
      { round: 0, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0 }, // 1 vyhraje
      { round: 0, homeId: 3, awayId: 4, homeGoals: 1, awayGoals: 1 }, // remíza
      { round: 1, homeId: 1, awayId: 3, homeGoals: 1, awayGoals: 1 }, // remíza
      { round: 1, homeId: 2, awayId: 4, homeGoals: 3, awayGoals: 0 }, // 2 vyhraje
    ];
    const table = buildTable([1, 2, 3, 4], results);
    const byId = new Map(table.map((r) => [r.teamId, r]));

    expect(byId.get(1)!.points).toBe(4); // V + R
    expect(byId.get(1)!.played).toBe(2);
    expect(byId.get(2)!.points).toBe(3); // P + V
    expect(byId.get(3)!.points).toBe(2); // R + R
    expect(byId.get(4)!.points).toBe(1); // R + P

    // Součet odehraných zápasů = 2× počet výsledků
    const sumPlayed = table.reduce((a, r) => a + r.played, 0);
    expect(sumPlayed).toBe(results.length * 2);
    // Součet vstřelených = součet obdržených
    const gf = table.reduce((a, r) => a + r.goalsFor, 0);
    const ga = table.reduce((a, r) => a + r.goalsAgainst, 0);
    expect(gf).toBe(ga);

    expect(table[0].teamId).toBe(1); // nejvíc bodů → rank 1
    expect(table.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("simulate", () => {
  it("silnější útok → vyšší λ; predikce 1X2 dá součet 1", () => {
    const strong = { id: 1, name: "A", short: "A", color: "#000", attack: 2.2, defense: 0.8, homeBoost: 1.1 };
    const weak = { id: 2, name: "B", short: "B", color: "#000", attack: 1.0, defense: 1.7, homeBoost: 1.1 };
    const [lh, la] = matchLambdas(strong, weak);
    expect(lh).toBeGreaterThan(la);
    const p = predictProbs(strong, weak);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 6);
    expect(p.homeWin).toBeGreaterThan(p.awayWin);
  });

  it("vysamplované skóre dlouhodobě sedí na λ", () => {
    const a = { id: 1, name: "A", short: "A", color: "#000", attack: 1.6, defense: 1.2, homeBoost: 1.0 };
    const b = { id: 2, name: "B", short: "B", color: "#000", attack: 1.6, defense: 1.2, homeBoost: 1.0 };
    const [lh, la] = matchLambdas(a, b);
    const rand = mulberry32(42);
    const N = 8000;
    let sumH = 0;
    let sumA = 0;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch(a, b, NEUTRAL_ADJUST, NEUTRAL_ADJUST, rand);
      expect(r.homeGoals).toBeGreaterThanOrEqual(0);
      expect(r.awayGoals).toBeGreaterThanOrEqual(0);
      sumH += r.homeGoals;
      sumA += r.awayGoals;
    }
    expect(sumH / N).toBeCloseTo(lh, 1);
    expect(sumA / N).toBeCloseTo(la, 1);
  });

  it("otevřená hra zvýší očekávané góly na obou stranách oproti nízkému bloku", () => {
    const a = { id: 1, name: "A", short: "A", color: "#000", attack: 1.5, defense: 1.2, homeBoost: 1.0 };
    const b = { id: 2, name: "B", short: "B", color: "#000", attack: 1.5, defense: 1.2, homeBoost: 1.0 };
    const open = resolvePlan("open", "balanced");
    const block = resolvePlan("low_block", "balanced");
    const [ohH, ohA] = matchLambdas(a, b, open, NEUTRAL_ADJUST);
    const [blH, blA] = matchLambdas(a, b, block, NEUTRAL_ADJUST);
    expect(ohH).toBeGreaterThan(blH); // víc dáš
    expect(ohA).toBeGreaterThan(blA); // ale i víc dostaneš (soupeř těží z tvé otevřenosti)
  });
});

describe("engine – sezóna", () => {
  it("odehraje celou sezónu, tabulka je konzistentní", () => {
    let s = newSeason(7, 1);
    expect(isSeasonOver(s)).toBe(false);
    s = simulateToEnd(s);
    expect(isSeasonOver(s)).toBe(true);
    expect(s.results).toHaveLength(380);
    const table = currentTable(s);
    // Každý tým odehrál 38 zápasů
    for (const row of table) expect(row.played).toBe(38);
    // Součet bodů: každý zápas rozdá 2 (remíza) nebo 3 (rozhodnutý) body
    const totalPoints = table.reduce((a, r) => a + r.points, 0);
    const draws = s.results.filter((r) => r.homeGoals === r.awayGoals).length;
    expect(totalPoints).toBe(380 * 3 - draws);
  });

  it("je deterministická (stejný seed + plán = stejné výsledky)", () => {
    const a = simulateToEnd(newSeason(55, 3));
    const b = simulateToEnd(newSeason(55, 3));
    expect(a.results).toEqual(b.results);
  });

  it("yourNextMatch vrací zápas tvého týmu s predikcí a scoutem", () => {
    const s = setPlan(newSeason(9, 5), "open");
    const next = yourNextMatch(s);
    expect(next).not.toBeNull();
    expect(
      next!.fixture.homeId === 5 || next!.fixture.awayId === 5
    ).toBe(true);
    expect(next!.probs.homeWin + next!.probs.draw + next!.probs.awayWin).toBeCloseTo(1, 6);
    expect(["attacking", "defensive", "balanced"]).toContain(next!.scout.style);
  });

  it("silnější tým vyhraje titul výrazně častěji než slabý", () => {
    // Napříč mnoha ligami: nejsilnější tým skončí 1. častěji než nejslabší.
    let strongTitles = 0;
    let weakTitles = 0;
    const N = 60;
    for (let seed = 0; seed < N; seed++) {
      const league = generateLeague(seed);
      const strongest = [...league].sort((a, b) => b.attack - b.defense - (a.attack - a.defense))[0];
      const weakest = [...league].sort((a, b) => a.attack - a.defense - (b.attack - b.defense))[0];
      const table = currentTable(simulateToEnd(newSeason(seed, strongest.id)));
      const championId = table[0].teamId;
      if (championId === strongest.id) strongTitles++;
      if (championId === weakest.id) weakTitles++;
    }
    expect(strongTitles).toBeGreaterThan(weakTitles);
  });
});

describe("career", () => {
  it("summarizeSeason označí mistra a tvé umístění, startNextSeason posune sezónu", () => {
    const s = simulateToEnd(newSeason(11, 2));
    const summary = summarizeSeason(s);
    expect(summary.season).toBe(1);
    expect(summary.yourTeamId).toBe(2);
    expect(summary.yourRank).toBeGreaterThanOrEqual(1);
    expect(summary.yourRank).toBeLessThanOrEqual(20);
    expect(summary.championName).toBeTruthy();

    const next = startNextSeason(s);
    expect(next.season).toBe(2);
    expect(next.yourTeamId).toBe(2);
    expect(next.results).toHaveLength(0);
    expect(next.round).toBe(0);
    // Kluby zůstávají (stejná jména), ratingy driftují
    expect(next.teams.map((t) => t.name).sort()).toEqual(
      s.teams.map((t) => t.name).sort()
    );
  });

  it("careerStats agreguje historii", () => {
    const history = [
      summarizeSeason(simulateToEnd(newSeason(1, 1))),
      summarizeSeason(simulateToEnd(newSeason(2, 1))),
    ];
    const stats = careerStats(history)!;
    expect(stats.seasons).toBe(2);
    expect(stats.bestRank).toBeLessThanOrEqual(stats.worstRank);
    expect(stats.avgGoalsFor).toBeGreaterThan(0);
    expect(careerStats([])).toBeNull();
  });

  it("cleanSheetsOf počítá zápasy bez inkasovaného gólu", () => {
    const results = [
      { round: 0, homeId: 1, awayId: 2, homeGoals: 2, awayGoals: 0 }, // tým 1 čisté konto
      { round: 1, homeId: 3, awayId: 1, homeGoals: 0, awayGoals: 1 }, // tým 1 čisté konto (venku)
      { round: 2, homeId: 1, awayId: 4, homeGoals: 1, awayGoals: 1 }, // ne
    ];
    expect(cleanSheetsOf(results, 1)).toBe(2);
  });
});

describe("leagues – hodnocení sezóny", () => {
  it("evaluateSeason velké ligy: 1.–4. do LM, 5. EL, 6. EKL, sestup dole", () => {
    expect(evaluateSeason(1, 20, 39)).toEqual({
      champion: true,
      europe: "UCL",
      relegated: false,
    });
    expect(evaluateSeason(3, 20, 39).europe).toBe("UCL");
    expect(evaluateSeason(5, 20, 39).europe).toBe("UEL");
    expect(evaluateSeason(6, 20, 39).europe).toBe("UECL");
    expect(evaluateSeason(10, 20, 39).europe).toBe("NONE");
    expect(evaluateSeason(19, 20, 39).relegated).toBe(true);
  });

  it("malá liga (Fortuna) dává mistrovi PŘEDKOLO LM, ne přímou skupinu", () => {
    const champ = evaluateSeason(1, 16, 345);
    expect(champ.champion).toBe(true);
    expect(champ.europe).toBe("UCL_Q"); // předkolo, ne "UCL"
    expect(evaluateSeason(2, 16, 345).europe).toBe("UEL_Q");
    expect(evaluateSeason(3, 16, 345).europe).toBe("UECL_Q");
  });

  it("teamPrestige: silnější tým a prestižnější liga = vyšší prestiž", () => {
    const league = generateLeague(3);
    const sorted = [...league].sort(
      (a, b) => b.attack - b.defense - (a.attack - a.defense)
    );
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    expect(teamPrestige(top, 39, league)).toBeGreaterThan(
      teamPrestige(bottom, 39, league)
    );
    // Stejný (relativně) tým v prestižnější lize má vyšší prestiž.
    expect(teamPrestige(top, 39, league)).toBeGreaterThan(
      teamPrestige(top, 345, league)
    );
  });
});

describe("reputation", () => {
  it("titul zvýší reputaci, sestup ji sníží", () => {
    const base = 50;
    const win = updateReputation(base, {
      season: 1,
      leagueId: 39,
      leagueName: "PL",
      yourTeamId: 1,
      yourName: "A",
      yourRank: 1,
      expectedRank: 5,
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
      championName: "A",
      objectiveMet: true,
    });
    const releg = updateReputation(base, {
      season: 1,
      leagueId: 39,
      leagueName: "PL",
      yourTeamId: 1,
      yourName: "A",
      yourRank: 19,
      expectedRank: 12,
      yourPoints: 20,
      win: 4,
      draw: 8,
      loss: 26,
      goalsFor: 25,
      goalsAgainst: 70,
      cleanSheets: 2,
      champion: false,
      europe: "NONE",
      relegated: true,
      championId: 2,
      championName: "B",
      objectiveMet: false,
    });
    expect(win).toBeGreaterThan(base);
    expect(releg).toBeLessThan(base);
  });

  it("isHireable: prestižní tým chce vysokou reputaci", () => {
    const league = generateLeague(4);
    const top = [...league].sort(
      (a, b) => b.attack - b.defense - (a.attack - a.defense)
    )[0];
    expect(isHireable(top, 39, league, 10)).toBe(false);
    expect(isHireable(top, 39, league, 100)).toBe(true);
  });

  it("expectedRank: nejsilnější tým má očekávané umístění 1", () => {
    const league = generateLeague(5);
    const top = [...league].sort(
      (a, b) => b.attack - b.defense - (a.attack - a.defense)
    )[0];
    expect(expectedRank(top, league)).toBe(1);
  });
});

describe("analysis – statistiky sezóny", () => {
  it("teamSeasonStats agreguje odehrané zápasy tvého týmu", () => {
    const s = simulateToEnd(newSeason(8, 4));
    const stats = teamSeasonStats(s, 4);
    expect(stats.played).toBe(38);
    expect(stats.form).toHaveLength(5);
    expect(stats.avgFor).toBeGreaterThan(0);
    expect(stats.cleanSheetPct).toBeGreaterThanOrEqual(0);
    expect(stats.cleanSheetPct).toBeLessThanOrEqual(100);
    expect(stats.rank).toBeGreaterThanOrEqual(1);
  });
});

describe("standingsToTeams", () => {
  it("odvodí ratingy z tabulky a zaručí sudý počet", () => {
    const rows = [
      { teamId: 1, name: "Alpha FC", logo: "a.png", played: 10, goalsFor: 25, goalsAgainst: 8, homePlayed: 5, homeGoalsFor: 15 },
      { teamId: 2, name: "Beta United", played: 10, goalsFor: 8, goalsAgainst: 22 },
      { teamId: 3, name: "Gamma", played: 10, goalsFor: 14, goalsAgainst: 14 },
    ];
    const teams = standingsToTeams(rows, { goalsFor: 1.4, goalsAgainst: 1.4 });
    // lichý počet (3) → dropne poslední → 2
    expect(teams).toHaveLength(2);
    const alpha = teams.find((t) => t.id === 1)!;
    const beta = teams.find((t) => t.id === 2)!;
    expect(alpha.attack).toBeGreaterThan(beta.attack); // víc vstřelených
    expect(alpha.defense).toBeLessThan(beta.defense); // míň obdržených
    expect(alpha.logo).toBe("a.png");
    expect(alpha.short).toBe("AF"); // iniciály slov
    expect(alpha.homeBoost).toBeGreaterThanOrEqual(1);
  });
});

// ───────────────────────── Phase 1: realismus ─────────────────────────

describe("amplifySpread + leagueStars (realismus)", () => {
  it("roztáhne rozptyl kolem průměru (zachová pořadí, zvětší rozestup)", () => {
    const flat: GameTeam[] = [
      { id: 1, name: "T1", short: "T1", color: "#000", attack: 1.6, defense: 1.2, homeBoost: 1.1 },
      { id: 2, name: "T2", short: "T2", color: "#000", attack: 1.4, defense: 1.2, homeBoost: 1.1 },
      { id: 3, name: "T3", short: "T3", color: "#000", attack: 1.2, defense: 1.2, homeBoost: 1.1 },
    ];
    const spread = amplifySpread(flat);
    // Pořadí síly zachováno
    expect(spread[0].attack).toBeGreaterThan(spread[1].attack);
    expect(spread[1].attack).toBeGreaterThan(spread[2].attack);
    // Rozestup top↔dno se zvětšil (SPREAD>1)
    const before = flat[0].attack - flat[2].attack;
    const after = spread[0].attack - spread[2].attack;
    expect(after).toBeGreaterThan(before);
  });

  it("generovaná liga je po roztažení výrazně rozvrstvená (top nad spodní třetinou)", () => {
    const league = generateLeague(7);
    const scores = league.map(teamStrengthScore).sort((a, b) => b - a);
    const topAvg = (scores[0] + scores[1]) / 2;
    const bottomThird = scores.slice(-Math.ceil(scores.length / 3));
    const bottomAvg = bottomThird.reduce((a, b) => a + b, 0) / bottomThird.length;
    expect(topAvg).toBeGreaterThan(bottomAvg + 0.6);
  });

  it("leagueStars dá rozprostřené 1–5 (nejsilnější 5, nejslabší 1)", () => {
    const league = generateLeague(3);
    const sorted = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    expect(leagueStars(sorted[0], league)).toBe(5);
    expect(leagueStars(sorted[sorted.length - 1], league)).toBe(1);
    for (const t of league) {
      const s = leagueStars(t, league);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(5);
    }
  });

  it("seasonObjective: nejsilnější → titul, nejslabší → záchrana", () => {
    const league = generateLeague(9);
    const sorted = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    expect(seasonObjective(sorted[0], league, 39).kind).toBe("title");
    expect(seasonObjective(sorted[sorted.length - 1], league, 39).kind).toBe("survival");
  });
});

// ───────────────────────── Phase 2: agency ─────────────────────────

describe("plans – countery", () => {
  it("kontry proti ofenzivnímu soupeři = útok nahoru, obdržené dolů vs neutrál", () => {
    const vsAtk = resolvePlan("counter", "attacking");
    const vsBal = resolvePlan("counter", "balanced");
    expect(vsAtk.attack).toBeGreaterThan(vsBal.attack);
    expect(vsAtk.concede).toBeLessThan(vsBal.concede);
  });

  it("presink proti ofenzivnímu soupeři zvedne riziko (víc obdržených)", () => {
    const vsAtk = resolvePlan("press", "attacking");
    const vsDef = resolvePlan("press", "defensive");
    expect(vsAtk.concede).toBeGreaterThan(vsDef.concede);
  });

  it("balanced je bez counteru (neutrál napříč styly)", () => {
    const a = resolvePlan("balanced", "attacking");
    const b = resolvePlan("balanced", "defensive");
    expect(a).toEqual(b);
  });
});

describe("morale", () => {
  it("moraleFactor roste s morálkou (100 > 50 > 0)", () => {
    expect(moraleFactor(100)).toBeGreaterThan(moraleFactor(50));
    expect(moraleFactor(50)).toBeGreaterThan(moraleFactor(0));
    expect(moraleFactor(50)).toBeCloseTo(1, 6);
  });

  it("updateMorale: výhra zvedá, prohra sráží, clamp 0–100", () => {
    expect(updateMorale(50, "W", false)).toBeGreaterThan(50);
    expect(updateMorale(50, "L", false)).toBeLessThan(50);
    expect(updateMorale(100, "W", true)).toBeLessThanOrEqual(100);
    expect(updateMorale(0, "L", false)).toBeGreaterThanOrEqual(0);
    // Překvapivá výhra nad silnějším > obyčejná výhra
    expect(updateMorale(50, "W", true)).toBeGreaterThan(updateMorale(50, "W", false));
  });
});

describe("events", () => {
  it("maybeEvent je deterministický dle seedu+kola", () => {
    expect(maybeEvent(123, 4)).toEqual(maybeEvent(123, 4));
    // Napříč koly aspoň někdy event nastane
    let hits = 0;
    for (let r = 0; r < 38; r++) if (maybeEvent(123, r)) hits++;
    expect(hits).toBeGreaterThan(0);
    // Vrácené id existuje v registru
    const ev = maybeEvent(123, 4);
    if (ev) expect(getEvent(ev.id)).toBeDefined();
  });

  it("applyEventChoice mění morálku/modifikátory a čistí pendingEvent", () => {
    const base = newSeason(50, 1);
    const withEvent: SeasonState = {
      ...base,
      pendingEvent: { id: EVENTS[0].id, round: base.round },
      morale: 50,
      modifiers: [],
    };
    const after = applyEventChoice(withEvent, 0);
    expect(after.pendingEvent).toBeNull();
    // Aspoň jeden efekt (morálka nebo modifikátor) se projevil
    const changed = after.morale !== 50 || after.modifiers.length > 0;
    expect(changed).toBe(true);
  });
});

describe("objective v souhrnu", () => {
  it("summarizeSeason nese objectiveMet a splněný cíl zvedne reputaci", () => {
    const s = simulateToEnd(newSeason(11, 2));
    const summary = summarizeSeason(s);
    expect(typeof summary.objectiveMet).toBe("boolean");
    const met = updateReputation(50, { ...summary, objectiveMet: true });
    const missed = updateReputation(50, { ...summary, objectiveMet: false });
    expect(met).toBeGreaterThan(missed);
  });
});
