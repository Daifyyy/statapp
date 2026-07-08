import { describe, expect, it } from "vitest";
import {
  generateLeague,
  LEAGUE_SIZE,
  standingsToTeams,
  amplifySpread,
  injectYourTeam,
  teamById,
} from "./teams";
import {
  evaluateSeason,
  teamPrestige,
  leagueStars,
  seasonObjective,
  teamStrengthScore,
  nextTransition,
  isSecondTier,
  secondTierOf,
  firstTierOf,
  seasonHeadline,
} from "./leagues";
import { expectedRank, updateReputation, isHireable } from "./reputation";
import { teamSeasonStats } from "./analysis";
import { cleanSheetsOf } from "./career";
import { roundRobin } from "./schedule";
import { buildTable } from "./standings";
import {
  matchLambdas,
  predictProbs,
  simulateMatch,
  homeAdvantage,
  NEUTRAL_ADJUST,
} from "./simulate";
import {
  newSeason,
  playRound,
  simulateToEnd,
  isSeasonOver,
  currentTable,
  setPlan,
  setInstruction,
  yourNextMatch,
  resolveAdjust,
} from "./engine";
import { summarizeSeason, startNextSeason, careerStats } from "./career";
import { resolvePlan } from "./plans";
import { moraleFactor, updateMorale } from "./morale";
import { maybeEvent, applyEventChoice, EVENTS, getEvent } from "./events";
import { mulberry32, randomSeed, deriveSeed } from "./rng";
import {
  applyDevelopment,
  developmentPoints,
  youthRegression,
} from "./development";
import { fitnessDelta, fitnessFactor, updateFitness } from "./fitness";
import { INSTRUCTIONS, resolveInstruction } from "./instructions";
import {
  COUNTER_BONUS,
  DRIFT_REGRESSION,
  HOME_BOOST_CAP,
  MAX_DEV_POINTS,
  SCOUT_CONFIDENCE,
  SCOUT_CONFIDENCE_BOOSTED,
} from "./balance";
import { ADJUST_MAX, ADJUST_MIN } from "./balance";
import { scoutOpponent } from "./scouting";
import { emptyProfile, foldSeason, coachedAllTop5, startCareer, TOP5_LEAGUE_IDS } from "./profile";
import { newlyEarned, evaluateAchievements, ACHIEVEMENTS } from "./achievements";
import type { GameTeam, MatchResult, SeasonState, SeasonSummary } from "./types";

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

  // Regrese: dřívější orientace `(r + i) % 2` byla invariantní vůči rotaci kruhové
  // metody → 15 z 16 týmů odehrálo 15 zápasů v kuse doma nebo venku.
  it.each([14, 16, 18, 20])(
    "%i týmů: vyvážený rozpis bez dlouhých sérií doma/venku",
    (n) => {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const schedule = roundRobin(ids);
      expect(schedule).toHaveLength(2 * (n - 1));

      // Sekvence prostředí každého týmu v pořadí kol.
      const venues = new Map<number, string[]>(ids.map((id) => [id, []]));
      const ordered = new Set<string>();
      for (const round of schedule) {
        expect(round).toHaveLength(n / 2);
        const seen = new Set<number>();
        for (const f of round) {
          expect(seen.has(f.homeId)).toBe(false);
          expect(seen.has(f.awayId)).toBe(false);
          seen.add(f.homeId);
          seen.add(f.awayId);
          venues.get(f.homeId)!.push("H");
          venues.get(f.awayId)!.push("A");
          ordered.add(`${f.homeId}v${f.awayId}`);
        }
        // Každý tým hraje v každém kole právě jednou.
        expect(seen.size).toBe(n);
      }
      // Každá uspořádaná dvojice právě jednou → n*(n-1) zápasů.
      expect(ordered.size).toBe(n * (n - 1));

      for (const [id, seq] of venues) {
        expect(seq).toHaveLength(2 * (n - 1));
        // Přesně půl doma, půl venku.
        expect(seq.filter((v) => v === "H")).toHaveLength(n - 1);
        // Nejdelší série stejného prostředí ≤ 3.
        let max = 1;
        let cur = 1;
        for (let i = 1; i < seq.length; i++) {
          cur = seq[i] === seq[i - 1] ? cur + 1 : 1;
          if (cur > max) max = cur;
        }
        expect(max, `tým ${id}: série ${max} (${seq.join("")})`).toBeLessThanOrEqual(3);
      }
    }
  );
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

  it("plná sezóna na malé reálně-tvarované lize (12 týmů) funguje end-to-end", () => {
    // Ne všechny GAME_LEAGUES mají 20 týmů (Skotsko/Rakousko apod. jsou menší) –
    // ověřit, že newSeason→simulateToEnd→summarizeSeason→updateReputation/evaluateSeason
    // fungují i mimo výchozí generateLeague velikost.
    const twelve = generateLeague(42).slice(0, 12);
    const yourTeamId = twelve[0].id;
    let s = newSeason(42, yourTeamId, {
      teams: twelve,
      leagueId: 179, // Skotsko – malá liga v LEAGUE_ACCESS
      leagueName: "Premiership",
    });
    expect(s.teams).toHaveLength(12);
    s = simulateToEnd(s);
    expect(isSeasonOver(s)).toBe(true);
    const table = currentTable(s);
    expect(table).toHaveLength(12);
    // 12 týmů dvoukolově = 22 zápasů/tým
    for (const row of table) expect(row.played).toBe(22);
    const summary = summarizeSeason(s);
    expect(summary.yourRank).toBeGreaterThanOrEqual(1);
    expect(summary.yourRank).toBeLessThanOrEqual(12);
    const rep = updateReputation(50, summary);
    expect(rep).toBeGreaterThanOrEqual(0);
    expect(rep).toBeLessThanOrEqual(100);
  });
});

describe("resolveAdjust – stohování plán×counter×morálka×eventy", () => {
  const teams: GameTeam[] = [
    { id: 1, name: "You", short: "YOU", color: "#000", attack: 1.4, defense: 1.4, homeBoost: 1.1 },
    { id: 2, name: "Attacker", short: "ATK", color: "#000", attack: 2.0, defense: 1.4, homeBoost: 1.1 },
  ];

  it("clamp zabrání extrémní kombinaci jít mimo ADJUST_MIN/ADJUST_MAX", () => {
    let s = newSeason(1, 1, { teams });
    s = {
      ...s,
      morale: 100, // moraleFactor > 1 (nahoru)
      modifiers: [
        { untilRound: 5, attack: 1.3, label: "Event A" },
        { untilRound: 5, attack: 1.3, label: "Event B" },
        { untilRound: 5, concede: 0.5, label: "Event C" },
      ],
    };
    // "open" proti "attacking" soupeři = counter navíc nahoru → bez clampu by attack
    // vyšlo výrazně nad 1.4 (PLAN_BASE≈1.15 × counter≈1.1 × morálka≈1.06 × 1.3 × 1.3 ≈ 2.3).
    const adj = resolveAdjust(s, 2, "open", "none");
    expect(adj.attack).toBeLessThanOrEqual(ADJUST_MAX);
    expect(adj.concede).toBeGreaterThanOrEqual(ADJUST_MIN);
  });

  it("bez extrémního stohování zůstává v mezích i naprosto neutrální kombinace", () => {
    const s = newSeason(1, 1, { teams });
    const adj = resolveAdjust(s, 2, "balanced", "none");
    expect(adj.attack).toBeGreaterThanOrEqual(ADJUST_MIN);
    expect(adj.attack).toBeLessThanOrEqual(ADJUST_MAX);
    expect(adj.concede).toBeGreaterThanOrEqual(ADJUST_MIN);
    expect(adj.concede).toBeLessThanOrEqual(ADJUST_MAX);
  });
});

describe("scoutOpponent", () => {
  const teams: GameTeam[] = [
    { id: 1, name: "You", short: "YOU", color: "#000", attack: 1.4, defense: 1.4, homeBoost: 1.1 },
    { id: 2, name: "Attacker", short: "ATK", color: "#000", attack: 2.0, defense: 1.4, homeBoost: 1.1 },
    { id: 3, name: "Defender", short: "DEF", color: "#000", attack: 1.4, defense: 0.9, homeBoost: 1.1 },
    { id: 4, name: "Balanced", short: "BAL", color: "#000", attack: 1.4, defense: 1.4, homeBoost: 1.1 },
  ];

  it("klasifikuje styl (attacking/defensive/balanced) a traity dle ratingů vůči průměru", () => {
    const state = newSeason(1, 1, { teams });
    const attacker = scoutOpponent(state, 2);
    expect(attacker.style).toBe("attacking");
    expect(attacker.traits).toContain("strongAttack");

    const defender = scoutOpponent(state, 3);
    expect(defender.style).toBe("defensive");
    expect(defender.traits).toContain("solidDefense");

    const balanced = scoutOpponent(state, 4);
    expect(balanced.style).toBe("balanced");
  });

  it("favourite/underdog dle rozdílu síly vůči tvému týmu", () => {
    const strongVsWeak: GameTeam[] = [
      { id: 1, name: "You", short: "YOU", color: "#000", attack: 1.4, defense: 1.4, homeBoost: 1.1 },
      { id: 2, name: "Much stronger", short: "STR", color: "#000", attack: 2.2, defense: 0.8, homeBoost: 1.1 },
      { id: 3, name: "Much weaker", short: "WEK", color: "#000", attack: 1.0, defense: 1.9, homeBoost: 1.1 },
      { id: 4, name: "Filler", short: "FIL", color: "#000", attack: 1.4, defense: 1.4, homeBoost: 1.1 },
    ];
    const state = newSeason(1, 1, { teams: strongVsWeak });
    expect(scoutOpponent(state, 2).traits).toContain("favourite");
    expect(scoutOpponent(state, 3).traits).toContain("underdog");
  });
});

describe("rng", () => {
  it("randomSeed vrací hodnoty v uint32 rozsahu, prakticky vždy různé", () => {
    const seeds = Array.from({ length: 20 }, () => randomSeed());
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(0x100000000);
    }
    expect(new Set(seeds).size).toBeGreaterThan(15);
  });

  it("deriveSeed je deterministický a nekoliduje pro sousední kola", () => {
    expect(deriveSeed(42, 0)).toBe(deriveSeed(42, 0));
    expect(deriveSeed(42, 0)).not.toBe(deriveSeed(42, 1));
    const seeds = new Set(Array.from({ length: 100 }, (_, i) => deriveSeed(42, i)));
    expect(seeds.size).toBe(100);
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
      promoted: false,
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

  it("evaluateSeason s explicitním override ignoruje kurátorovanou LEAGUE_ACCESS", () => {
    const override = { slots: [{ rank: 1, spot: "UEL" as const }], relegBottom: 1 };
    // Liga 39 (Anglie) by bez override dala rank 1 → "UCL"; s override musí dát "UEL".
    expect(evaluateSeason(1, 20, 39, override).europe).toBe("UEL");
    expect(evaluateSeason(20, 20, 39, override).relegated).toBe(true);
    expect(evaluateSeason(19, 20, 39, override).relegated).toBe(false);
  });

  // Regrese: ligy s nadstavbou dávají odvoditelné evropské sloty, ale NE sestup.
  // Dřív takový override (relegBottom: 0) zkratoval fallback → nikdo nesestoupil.
  it("override bez sestupu (relegBottom null) vezme sloty z dat a sestup z kurátorované tabulky", () => {
    const override = {
      slots: [{ rank: 1, spot: "UECL_Q" as const }],
      relegBottom: null,
    };
    // Fortuna liga (345, 16 týmů): kurátorovaný relegBottom = 1 → poslední sestupuje.
    expect(evaluateSeason(1, 16, 345, override).europe).toBe("UECL_Q"); // sloty z dat
    expect(evaluateSeason(16, 16, 345, override).relegated).toBe(true); // sestup z fallbacku
    expect(evaluateSeason(15, 16, 345, override).relegated).toBe(false);
  });

  it("override s prázdnými sloty vezme sloty z kurátorované tabulky, sestup z dat", () => {
    const override = { slots: [], relegBottom: 4 };
    expect(evaluateSeason(1, 20, 39, override).europe).toBe("UCL"); // sloty z fallbacku
    expect(evaluateSeason(17, 20, 39, override).relegated).toBe(true); // sestup z dat (4)
    expect(evaluateSeason(16, 20, 39, override).relegated).toBe(false);
  });

  it("evaluateSeason bez override se chová beze změny (fallback na LEAGUE_ACCESS)", () => {
    expect(evaluateSeason(1, 20, 39, null).europe).toBe("UCL");
    expect(evaluateSeason(1, 20, 39, undefined).europe).toBe("UCL");
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

describe("sestup/postup mezi 1. a 2. ligou", () => {
  it("2. liga: postupová zóna (top 2) = promoted, žádná Evropa, sestup dole", () => {
    // Championship (40) = 2. liga Anglie, 24 týmů, 2 postupová místa.
    const first = evaluateSeason(1, 24, 40);
    expect(first.promoted).toBe(true);
    expect(first.europe).toBe("NONE"); // z 2. ligy se do Evropy nejde
    expect(first.champion).toBe(true);
    expect(evaluateSeason(2, 24, 40).promoted).toBe(true);
    expect(evaluateSeason(3, 24, 40).promoted).toBe(false);
    expect(evaluateSeason(24, 24, 40).relegated).toBe(true);
  });

  it("nejvyšší liga nikdy nemá promoted", () => {
    expect(evaluateSeason(1, 20, 39).promoted).toBe(false);
    expect(evaluateSeason(2, 20, 39).promoted).toBe(false);
  });

  it("mapa 1.↔2. liga (Top-5) je konzistentní", () => {
    expect(isSecondTier(40)).toBe(true);
    expect(isSecondTier(39)).toBe(false);
    expect(secondTierOf(39)?.id).toBe(40);
    expect(firstTierOf(40)).toBe(39);
    expect(secondTierOf(345)).toBeUndefined(); // Fortuna liga = malá liga bez modelu 2. ligy
  });

  it("nextTransition: sestup z Top-5 → do 2. ligy; z malé ligy → vyhazov", () => {
    expect(nextTransition({ relegated: true }, 39)).toEqual({
      type: "down",
      leagueId: 40,
      leagueName: "Championship",
    });
    expect(nextTransition({ relegated: true }, 345)).toEqual({ type: "sacked" });
    expect(nextTransition({ relegated: false }, 39)).toEqual({ type: "stay" });
  });

  it("nextTransition: 2. liga → postup nahoru / sestup = vyhazov / jinak stay", () => {
    expect(nextTransition({ relegated: false, promoted: true }, 40)).toEqual({
      type: "up",
      leagueId: 39,
      leagueName: "Premier League",
    });
    expect(nextTransition({ relegated: true, promoted: false }, 40)).toEqual({ type: "sacked" });
    expect(nextTransition({ relegated: false, promoted: false }, 40)).toEqual({ type: "stay" });
  });

  it("seasonObjective ve 2. lize míří na postup", () => {
    const league = standingsToTeams(
      Array.from({ length: 24 }, (_, i) => ({
        teamId: i + 1,
        name: `T${i + 1}`,
        played: 10,
        goalsFor: 20 - i * 0.5,
        goalsAgainst: 5 + i * 0.5,
      }))
    );
    const strongest = [...league].sort(
      (a, b) => teamStrengthScore(b) - teamStrengthScore(a)
    )[0];
    const obj = seasonObjective(strongest, league, 40, null);
    expect(obj.kind).toBe("promotion");
  });

  // Kariéru lze ve 2. lize i ZAČÍT (slabý klub) → outsider nesmí dostat cíl
  // „Zabojuj o postup — skonči do 21. místa", ale záchranu.
  it("seasonObjective ve 2. lize dá outsiderovi záchranu, ne postup", () => {
    const league = standingsToTeams(
      Array.from({ length: 24 }, (_, i) => ({
        teamId: i + 1,
        name: `T${i + 1}`,
        played: 10,
        goalsFor: 20 - i * 0.5,
        goalsAgainst: 5 + i * 0.5,
      }))
    );
    const byStrength = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    // Championship (40): relegBottom 3 → bezpečné je 21. místo, poslední tři padají.
    expect(seasonObjective(byStrength[23], league, 40, null).kind).toBe("survival");
    // Těsně pod postupovou zónou → pořád „zabojuj o postup".
    expect(seasonObjective(byStrength[3], league, 40, null).text).toContain("postup");
    // Střed tabulky → ani postup, ani záchrana.
    const mid = seasonObjective(byStrength[11], league, 40, null);
    expect(mid.kind).toBe("midtable");
    expect(mid.text).toContain("Potvrď sílu");
  });

  it("seasonHeadline hlásí postup", () => {
    expect(seasonHeadline({ champion: false, europe: "NONE", relegated: false, promoted: true })).toContain(
      "Postup"
    );
    expect(
      seasonHeadline({ champion: true, europe: "NONE", relegated: false, promoted: true })
    ).toContain("Postup");
  });

  it("injectYourTeam vloží tvůj klub a udrží sudý počet", () => {
    const league = generateLeague(7); // 20 týmů, id 1..20
    const you: GameTeam = {
      id: 999,
      name: "Tvůj klub",
      short: "TVU",
      color: "#000",
      attack: 1.8,
      defense: 0.9,
      homeBoost: 1.1,
    };
    const roster = injectYourTeam(league, you);
    expect(roster.length % 2).toBe(0);
    expect(roster.some((t) => t.id === 999)).toBe(true);
    // Tvůj tým si nese své ratingy (nepřepočítané spreadem).
    expect(roster.find((t) => t.id === 999)?.attack).toBe(1.8);
    // Když tvůj klub v lize už je, nezdvojí se.
    const withDup = injectYourTeam([...league, you], you);
    expect(withDup.filter((t) => t.id === 999)).toHaveLength(1);
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

  it("pojistka: nejslabší klub malé ligy tě vezme i při nulové reputaci", () => {
    const league = generateLeague(4);
    const bottom = [...league].sort(
      (a, b) => b.attack - b.defense - (a.attack - a.defense)
    )[league.length - 1];
    // I s reputací 0 existuje klub k převzetí (kariéra neuvízne).
    expect(isHireable(bottom, 345, league, 0)).toBe(true);
  });

  it("postup zvýší reputaci", () => {
    const summary: SeasonSummary = {
      season: 1,
      leagueId: 40,
      leagueName: "Championship",
      yourTeamId: 1,
      yourName: "A",
      yourRank: 1,
      expectedRank: 3,
      yourPoints: 90,
      win: 28,
      draw: 6,
      loss: 4,
      goalsFor: 80,
      goalsAgainst: 30,
      cleanSheets: 15,
      champion: true,
      europe: "NONE",
      relegated: false,
      promoted: true,
      championId: 1,
      championName: "A",
      objectiveMet: true,
    };
    expect(updateReputation(50, summary)).toBeGreaterThan(50);
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

  it("seasonObjective respektuje explicitní leagueAccess override (méně euro slotů)", () => {
    const league = generateLeague(9);
    const sorted = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    // Override s jen 1 evropským slotem → 2. nejsilnější tým už nemá "europe", jen "midtable".
    const override = { slots: [{ rank: 1, spot: "UCL" as const }], relegBottom: 3 };
    expect(seasonObjective(sorted[1], league, 39, override).kind).not.toBe("europe");
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
  it("maybeEvent je deterministický dle seedu+kola a losuje jen z eventů se splněnou podmínkou", () => {
    const base = newSeason(123, 1);
    expect(maybeEvent(base)).toEqual(maybeEvent(base));
    // Napříč koly aspoň někdy event nastane
    let hits = 0;
    for (let r = 0; r < 38; r++) if (maybeEvent({ ...base, round: r })) hits++;
    expect(hits).toBeGreaterThan(0);
    // Vrácené id existuje v registru a jeho podmínka na daný stav sedí
    const ev = maybeEvent(base);
    if (ev) {
      const def = getEvent(ev.id);
      expect(def).toBeDefined();
      expect(def!.condition?.(base) ?? true).toBe(true);
    }
  });

  it("state-blind eventy zmizely: krizová porada nepadne s vysokou morálkou", () => {
    const happy = { ...newSeason(1, 1), morale: 90 };
    const crisis = getEvent("losing_streak_crisis")!;
    expect(crisis.condition!(happy)).toBe(false);
    expect(crisis.condition!({ ...happy, morale: 20 })).toBe(true);
  });

  it("žádná volba eventu není zadarmo lepší (každá má cenu v nějaké měně)", () => {
    for (const ev of EVENTS) {
      for (const c of ev.choices) {
        const e = c.effect;
        const gains =
          (e.moraleDelta ?? 0) > 0 ||
          (e.fitnessDelta ?? 0) > 0 ||
          (e.devBonus ?? 0) > 0 ||
          (e.scoutBoostRounds ?? 0) > 0 ||
          (e.modifier?.attack ?? 1) > 1 ||
          (e.modifier?.concede ?? 1) < 1;
        const costs =
          (e.moraleDelta ?? 0) < 0 ||
          (e.fitnessDelta ?? 0) < 0 ||
          (e.devBonus ?? 0) < 0 ||
          (e.modifier?.attack ?? 1) < 1 ||
          (e.modifier?.concede ?? 1) > 1;
        // Volba smí být čistě neutrální/opatrná, ale nesmí být čistý zisk bez ceny…
        if (gains && !costs) {
          // …s výjimkou drobného morálkového zisku bez λ efektu (bezpečná varianta).
          expect(
            e.modifier === undefined && (e.moraleDelta ?? 0) <= 7,
            `${ev.id} / ${c.label}: zisk bez ceny`
          ).toBe(true);
        }
      }
    }
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

// ───────────────────────── trvalý profil + achievementy ─────────────────────────

function mkSummary(over: Partial<SeasonSummary>): SeasonSummary {
  return {
    season: 1,
    leagueId: 39,
    leagueName: "PL",
    yourTeamId: 1,
    yourName: "A",
    yourRank: 5,
    expectedRank: 5,
    yourPoints: 60,
    win: 18,
    draw: 6,
    loss: 14,
    goalsFor: 55,
    goalsAgainst: 45,
    cleanSheets: 8,
    champion: false,
    europe: "NONE",
    relegated: false,
    championId: 2,
    championName: "B",
    objectiveMet: false,
    ...over,
  };
}

describe("profile – trvalé rekordy", () => {
  it("foldSeason přičte sezónu do rekordů (min rank, max body/góly, union lig)", () => {
    let p = emptyProfile();
    p = foldSeason(p, mkSummary({ leagueId: 39, yourRank: 3, yourPoints: 70, goalsFor: 62, champion: false, europe: "UCL" }), 55);
    p = foldSeason(p, mkSummary({ leagueId: 140, yourRank: 1, yourPoints: 88, goalsFor: 80, champion: true, europe: "UCL", loss: 0 }), 70);
    const a = p.allTime;
    expect(a.seasons).toBe(2);
    expect(a.titles).toBe(1);
    expect(a.uclQualifs).toBe(2);
    expect(a.europeanQualifs).toBe(2);
    expect(a.bestRank).toBe(1); // min
    expect(a.bestSeasonPoints).toBe(88); // max
    expect(a.mostGoalsSeason).toBe(80); // max
    expect(a.bestReputation).toBe(70); // max
    expect([...a.leaguesCoached].sort((x, y) => x - y)).toEqual([39, 140]);
    expect(a.invincibleSeasons).toBe(1); // druhá sezóna bez prohry
  });

  it("startCareer navýší počítadlo kariér", () => {
    const p = emptyProfile();
    expect(p.allTime.careers).toBe(0);
    const afterFirst = startCareer(p);
    expect(afterFirst.allTime.careers).toBe(1);
    const afterSecond = startCareer(afterFirst);
    expect(afterSecond.allTime.careers).toBe(2);
    // Zbytek profilu (achievementy, ostatní rekordy) se startem kariéry nemění.
    expect(afterSecond.achievements).toEqual(p.achievements);
  });

  it("coachedAllTop5 až po pokrytí všech Top-5 lig", () => {
    let p = emptyProfile();
    expect(coachedAllTop5(p.allTime)).toBe(false);
    for (const id of TOP5_LEAGUE_IDS) p = foldSeason(p, mkSummary({ leagueId: id }), 40);
    expect(coachedAllTop5(p.allTime)).toBe(true);
  });
});

describe("achievements", () => {
  it("first_title/first_win se odemknou u titulové sezóny, ne dřív", () => {
    let p = emptyProfile();
    // Před titulem: fold prohrané-ish sezóny bez výher? mkSummary má win=18 → first_win padne.
    const noWin = foldSeason(emptyProfile(), mkSummary({ win: 0, draw: 5, loss: 33 }), 30);
    const before = newlyEarned([], { allTime: noWin.allTime, last: mkSummary({ win: 0, draw: 5, loss: 33, champion: false }), reputation: 30 }).map((x) => x.id);
    expect(before).not.toContain("first_title");

    p = foldSeason(p, mkSummary({ champion: true, yourRank: 1 }), 60);
    const earned = newlyEarned([], { allTime: p.allTime, last: mkSummary({ champion: true, yourRank: 1 }), reputation: 60 }).map((x) => x.id);
    expect(earned).toContain("first_title");
    expect(earned).toContain("first_win");
  });

  it("newlyEarned vynechá už držené a je deterministické", () => {
    const p = foldSeason(emptyProfile(), mkSummary({ champion: true }), 60);
    const ctx = { allTime: p.allTime, last: mkSummary({ champion: true }), reputation: 60 };
    const all = evaluateAchievements(ctx);
    expect(all).toContain("first_title");
    const fresh = newlyEarned(["first_title"], ctx).map((x) => x.id);
    expect(fresh).not.toContain("first_title");
    // determinismus
    expect(evaluateAchievements(ctx)).toEqual(all);
  });

  it("invincible padne jen když sezóna bez prohry", () => {
    const inv = { allTime: emptyProfile().allTime, last: mkSummary({ loss: 0 }), reputation: 40 };
    const notInv = { allTime: emptyProfile().allTime, last: mkSummary({ loss: 3 }), reputation: 40 };
    expect(evaluateAchievements(inv)).toContain("invincible");
    expect(evaluateAchievements(notInv)).not.toContain("invincible");
  });

  it("registr má unikátní id", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ───────────────────────── Phase B: rozvoj klubu ─────────────────────────

describe("development", () => {
  const league = generateLeague(3);
  const mid = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a))[10];

  function summary(over: Partial<SeasonSummary>): SeasonSummary {
    return {
      season: 1,
      leagueId: 0,
      leagueName: "L",
      yourTeamId: mid.id,
      yourName: mid.name,
      yourRank: 10,
      expectedRank: 10,
      yourPoints: 50,
      win: 14,
      draw: 8,
      loss: 16,
      goalsFor: 45,
      goalsAgainst: 45,
      cleanSheets: 8,
      champion: false,
      europe: "NONE",
      relegated: false,
      promoted: false,
      championId: league[0].id,
      championName: league[0].name,
      objectiveMet: false,
      ...over,
    };
  }

  it("developmentPoints nikdy nepřekročí strop ani neklesne pod nulu", () => {
    const best = developmentPoints(
      summary({ yourRank: 1, champion: true, europe: "UCL", objectiveMet: true }),
      100,
      20,
      5
    );
    expect(best).toBe(MAX_DEV_POINTS);
    const worst = developmentPoints(
      summary({ yourRank: 20, relegated: true, objectiveMet: false }),
      10,
      20,
      -5
    );
    expect(worst).toBe(0);
  });

  it("developmentPoints odměňuje lepší sezónu", () => {
    const weak = developmentPoints(summary({ yourRank: 15 }), 40, 20);
    const strong = developmentPoints(
      summary({ yourRank: 3, europe: "UCL", objectiveMet: true }),
      40,
      20
    );
    expect(strong).toBeGreaterThan(weak);
  });

  it("applyDevelopment nepřeskočí špičku ligy (DEV_LEAGUE_CEILING)", () => {
    const best = Math.max(...league.filter((t) => t.id !== mid.id).map((t) => t.attack));
    const boosted = applyDevelopment(mid, { attack: 6, defense: 0, youth: 0, stadium: 0 }, league);
    expect(boosted.attack).toBeLessThanOrEqual(best * 1.05 + 1e-9);
    expect(boosted.attack).toBeGreaterThan(mid.attack); // a přesto se posunul nahoru
  });

  it("applyDevelopment: obrana klesá (nižší = lepší), stadion má strop", () => {
    const d = applyDevelopment(mid, { attack: 0, defense: 3, youth: 0, stadium: 0 }, league);
    expect(d.defense).toBeLessThan(mid.defense);
    const st = applyDevelopment(mid, { attack: 0, defense: 0, youth: 0, stadium: 99 }, league);
    expect(st.homeBoost).toBeLessThanOrEqual(1.3);
  });

  it("youthRegression tlumí regresi, nikdy pod nulu", () => {
    expect(youthRegression(0)).toBeCloseTo(DRIFT_REGRESSION);
    expect(youthRegression(3)).toBeLessThan(DRIFT_REGRESSION);
    expect(youthRegression(99)).toBeGreaterThanOrEqual(0);
  });

  // Přímý požadavek na balanc: progrese ano, superklub za rok ne.
  it("jedna maximální sezóna z průměru neudělá nejsilnější tým", () => {
    const teams = generateLeague(42);
    const you = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a))[10];
    let s = newSeason(42, you.id, { teams });
    s = simulateToEnd(s);
    s = startNextSeason(s, { attack: MAX_DEV_POINTS, defense: 0, youth: 0, stadium: 0 });
    const ranked = [...s.teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    expect(ranked[0].id).not.toBe(you.id);
  });

  // Regrese: dřív `driftTeams` volal `amplifySpread` každou sezónu (×1.35) a regrese
  // vracela jen ×0.9 → liga se za ~10 sezón polarizovala do clampů (std 0.56 → 0.91).
  it("drift zachovává rozptyl ligy napříč sezónami", () => {
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    let s = newSeason(7, generateLeague(7)[0].id, { teams: generateLeague(7) });
    const before = sd(s.teams.map((t) => t.attack));
    for (let i = 0; i < 10; i++) {
      s = simulateToEnd(s);
      s = startNextSeason(s);
    }
    const after = sd(s.teams.map((t) => t.attack));
    expect(after / before).toBeGreaterThan(0.8);
    expect(after / before).toBeLessThan(1.2);
  });

  // Regrese: `startNextSeason` dřív `leagueAccess` do další sezóny vůbec nepředal
  // → od 2. sezóny se tiše přepnulo na kurátorovaný fallback.
  it("startNextSeason přenáší leagueAccess i mládež", () => {
    const teams = generateLeague(11);
    const access = { slots: [{ rank: 1, spot: "UECL_Q" as const }], relegBottom: null };
    let s = newSeason(11, teams[3].id, {
      teams,
      leagueId: 345,
      leagueName: "FL",
      leagueAccess: access,
    });
    s = simulateToEnd(s);
    const next = startNextSeason(s, { attack: 0, defense: 0, youth: 2, stadium: 0 });
    expect(next.leagueAccess).toEqual(access);
    expect(next.youth).toBe(2);
  });
});

describe("domácí výhoda", () => {
  const T = (attack: number, defense: number, homeBoost: number, id: number): GameTeam => ({
    id,
    name: `T${id}`,
    short: "T",
    color: "#000",
    attack,
    defense,
    homeBoost,
  });

  it("domácí dají víc a zároveň dostanou míň", () => {
    const home = T(1.65, 1.3, 1.15, 1);
    const away = T(1.65, 1.3, 1.15, 2);
    const [lh, la] = matchLambdas(home, away);
    const [lhFlat, laFlat] = matchLambdas({ ...home, homeBoost: 1 }, away);
    expect(lh).toBeGreaterThan(lhFlat);
    expect(la).toBeLessThan(laFlat);
  });

  it("domácí výhoda je ADITIVNÍ posun λ v gólech, nezávislý na ratinzích", () => {
    const { homeBonus, awayPenalty } = homeAdvantage(1.15);
    // Slabý i silný tým dostanou doma stejný gólový bonus.
    const weak = matchLambdas(T(0.9, 1.8, 1.15, 1), T(1.65, 1.3, 1.1, 2));
    const weakFlat = matchLambdas(T(0.9, 1.8, 1, 1), T(1.65, 1.3, 1.1, 2));
    const strong = matchLambdas(T(2.4, 0.8, 1.15, 1), T(1.65, 1.3, 1.1, 2));
    const strongFlat = matchLambdas(T(2.4, 0.8, 1, 1), T(1.65, 1.3, 1.1, 2));
    expect(weak[0] - weakFlat[0]).toBeCloseTo(homeBonus);
    expect(strong[0] - strongFlat[0]).toBeCloseTo(homeBonus);
    expect(weakFlat[1] - weak[1]).toBeCloseTo(awayPenalty);
    expect(strongFlat[1] - strong[1]).toBeCloseTo(awayPenalty);
  });

  /**
   * Jádro celé aditivní přestavby: bod do útoku a bod do obrany musí hýbat λ stejně,
   * a to DOMA i VENKU. V multiplikativní verzi se doma útok násobil a obrana dělila,
   * takže investice do útoku byla strukturálně výnosnější (+1.16 vs +0.84 b/sezónu)
   * a nešlo to spravit žádnou hodnotou `DEV_DEFENSE_STEP`.
   */
  it("λ-parita: bod do útoku a do obrany hýbe λ stejně, doma i venku", () => {
    const d = 0.08;
    const me = T(1.65, 1.3, 1.15, 1);
    const opp = T(1.65, 1.3, 1.12, 2);

    // Doma: můj útok zvedá moje λ; moje obrana snižuje λ soupeře.
    const homeBase = matchLambdas(me, opp);
    const homeAtk = matchLambdas({ ...me, attack: me.attack + d }, opp);
    const homeDef = matchLambdas({ ...me, defense: me.defense - d }, opp);
    expect(homeAtk[0] - homeBase[0]).toBeCloseTo(homeBase[1] - homeDef[1]);

    // Venku: totéž z druhé strany.
    const awayBase = matchLambdas(opp, me);
    const awayAtk = matchLambdas(opp, { ...me, attack: me.attack + d });
    const awayDef = matchLambdas(opp, { ...me, defense: me.defense - d });
    expect(awayAtk[1] - awayBase[1]).toBeCloseTo(awayBase[0] - awayDef[0]);

    // A doma i venku je ten posun stejně velký (žádné zesílení/tlumení dle prostředí).
    expect(homeAtk[0] - homeBase[0]).toBeCloseTo(awayAtk[1] - awayBase[1]);
    expect(homeBase[1] - homeDef[1]).toBeCloseTo(awayBase[0] - awayDef[0]);
  });

  it("identické týmy: domácí mají výhodu, ale ne drtivou", () => {
    const p = predictProbs(T(1.65, 1.3, 1.1, 1), T(1.65, 1.3, 1.1, 2));
    expect(p.homeWin).toBeGreaterThan(p.awayWin);
    expect(p.homeWin).toBeGreaterThan(0.4);
    expect(p.homeWin).toBeLessThan(0.55);
  });

  it("homeAdvantage je stropovaná HOME_BOOST_CAP i pro absurdní vstup", () => {
    const capped = homeAdvantage(HOME_BOOST_CAP);
    expect(homeAdvantage(5)).toEqual(capped);
    expect(homeAdvantage(0.5)).toEqual({ homeBonus: 0, awayPenalty: 0 }); // pod 1 = neutrál
    // Hostům se odečte míň, než se domácím přičte.
    expect(capped.awayPenalty).toBeLessThan(capped.homeBonus);
    expect(capped.awayPenalty).toBeGreaterThan(0);
  });

  // Regrese: `homeBoost` je poměr REÁLNÝCH gólů, ne modelových ratingů. Kdyby se dělil
  // post-spread útokem, dostaly by slabé týmy (kterým spread útok stlačí) nejvyšší poměr
  // a aditivní model by jim dal největší domácí bonus.
  it("homeBoost = poměr reálných gólů, nezávislý na amplifySpread", () => {
    // Bez zaokrouhlování na celé góly: všichni mají doma přesně +18 %.
    const rows = Array.from({ length: 20 }, (_, i) => {
      const gpg = 2.3 - i * 0.07;
      return {
        teamId: i + 1,
        name: `T${i + 1}`,
        played: 38,
        goalsFor: gpg * 38,
        goalsAgainst: (0.8 + i * 0.05) * 38,
        homePlayed: 19,
        homeGoalsFor: gpg * 1.18 * 19,
      };
    });
    const teams = standingsToTeams(rows, { goalsFor: 1.35, goalsAgainst: 1.35 });
    // Stejná domácí převaha → stejný homeBoost i stejný gólový bonus, bez ohledu na to,
    // jak moc `amplifySpread` daný tým v útoku roztáhl nebo stlačil.
    for (const t of teams) expect(t.homeBoost, t.name).toBeCloseTo(1.18, 2);
    const bonuses = teams.map((t) => homeAdvantage(t.homeBoost).homeBonus);
    expect(Math.max(...bonuses) - Math.min(...bonuses)).toBeLessThan(0.01);
  });

  // Reálná data jsou celočíselná → poměr má šum. Podstatné je, že šum NEKORELUJE se silou:
  // s původním jmenovatelem (post-spread útok) rostl bonus monotónně se slabostí týmu
  // (0.26 gólu pro nejlepší, 0.50 pro nejhorší), přestože všichni měli doma stejných +18 %.
  it("gólový bonus nekoreluje se silou týmu ani na celočíselných datech", () => {
    const rows = Array.from({ length: 20 }, (_, i) => {
      const gpg = 2.3 - i * 0.07;
      return {
        teamId: i + 1,
        name: `T${i + 1}`,
        played: 38,
        goalsFor: Math.round(gpg * 38),
        goalsAgainst: Math.round((0.8 + i * 0.05) * 38),
        homePlayed: 19,
        homeGoalsFor: Math.round(gpg * 1.18 * 19),
      };
    });
    const teams = standingsToTeams(rows, { goalsFor: 1.35, goalsAgainst: 1.35 });
    const bonus = (t: (typeof teams)[number]) => homeAdvantage(t.homeBoost).homeBonus;
    const strongest = teams[0];
    const weakest = teams[teams.length - 1];
    expect(Math.abs(bonus(weakest) - bonus(strongest))).toBeLessThan(0.05);
    // Ani průměr horní a dolní poloviny se nesmí systematicky lišit.
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const top = avg(teams.slice(0, 10).map(bonus));
    const bottom = avg(teams.slice(10).map(bonus));
    expect(Math.abs(top - bottom)).toBeLessThan(0.03);
  });

  it("investice do stadionu nepřekročí HOME_BOOST_CAP ani po mnoha sezónách", () => {
    const league = generateLeague(3);
    let me = { ...league[0], homeBoost: 1.1 };
    for (let season = 0; season < 30; season++) {
      me = applyDevelopment(me, { attack: 0, defense: 0, youth: 0, stadium: 6 }, league);
    }
    expect(me.homeBoost).toBeLessThanOrEqual(HOME_BOOST_CAP);
    expect(me.homeBoost).toBeCloseTo(HOME_BOOST_CAP);
  });

  it("stadion na rozdíl od útoku/obrany neregreduje mezi sezónami", () => {
    const teams = generateLeague(21);
    let s = newSeason(21, teams[5].id, { teams });
    const before = teamById(s.teams, s.yourTeamId).homeBoost;
    s = startNextSeason(simulateToEnd(s));
    expect(teamById(s.teams, s.yourTeamId).homeBoost).toBe(before);
  });
});

describe("fitness", () => {
  it("fitnessFactor je monotónní, plná kondice = bez postihu, nikdy bonus", () => {
    expect(fitnessFactor(100)).toBe(1);
    expect(fitnessFactor(50)).toBeLessThan(1);
    expect(fitnessFactor(0)).toBeLessThan(fitnessFactor(50));
  });

  it("press/open unavují, low_block regeneruje", () => {
    expect(fitnessDelta("press")).toBeLessThan(0);
    expect(fitnessDelta("open")).toBeLessThan(0);
    expect(fitnessDelta("low_block")).toBeGreaterThan(0);
    expect(updateFitness(100, "press")).toBeLessThan(100);
    expect(updateFitness(50, "low_block")).toBeGreaterThan(50);
    expect(updateFitness(0, "press")).toBeGreaterThanOrEqual(0);
    expect(updateFitness(100, "low_block")).toBeLessThanOrEqual(100);
  });

  it("pořád presovat se nevyplatí – kondice dlouhodobě klesá a bere λ", () => {
    let f = 100;
    for (let i = 0; i < 20; i++) f = updateFitness(f, "press");
    expect(f).toBeLessThan(50);
    expect(fitnessFactor(f)).toBeLessThan(0.96);
  });
});

describe("instructions", () => {
  it("správná instrukce proti traitu pomáhá, špatná škodí, jinak nic", () => {
    const hit = resolveInstruction("wing_play", ["weakDefense"]);
    expect(hit.attack).toBeGreaterThan(1);
    const miss = resolveInstruction("wing_play", ["solidDefense"]);
    expect(miss.attack).toBeLessThan(1);
    expect(resolveInstruction("wing_play", ["inForm"])).toEqual({ attack: 1, concede: 1 });
    expect(resolveInstruction("none", ["weakDefense"])).toEqual({ attack: 1, concede: 1 });
  });

  it("oba traity zároveň se vyruší", () => {
    expect(resolveInstruction("wing_play", ["weakDefense", "solidDefense"])).toEqual({
      attack: 1,
      concede: 1,
    });
  });

  it("efekt instrukce nikdy nepřebije counter plánu", () => {
    for (const i of INSTRUCTIONS) {
      const r = resolveInstruction(i, ["strongAttack", "poorForm"]);
      expect(Math.abs(r.attack - 1)).toBeLessThanOrEqual(COUNTER_BONUS);
      expect(Math.abs(r.concede - 1)).toBeLessThanOrEqual(COUNTER_BONUS);
    }
  });

  // `man_mark` měl původně rewards=strongAttack a punishedBy=solidDefense. Špičkové týmy
  // mají oba traity → vyrušily se a instrukce byla k něčemu jen v 8 % zápasů. Bonusový
  // a postihový trait spolu proto nesmí korelovat: musí jít potkat každý zvlášť.
  // Vlastnost je statistická (jedna sezóna nemusí potkat všechny traity) → víc seedů.
  it("každá instrukce je v reálných sezónách opravdu k něčemu (bonus i postih nastanou)", () => {
    const hits: Record<string, { bonus: number; malus: number }> = {};
    for (const i of INSTRUCTIONS) hits[i] = { bonus: 0, malus: 0 };

    for (let seed = 300; seed < 305; seed++) {
      const teams = generateLeague(seed);
      let s = newSeason(seed, teams[8].id, { teams });
      while (!isSeasonOver(s)) {
        const f = s.schedule[s.round].find(
          (x) => x.homeId === s.yourTeamId || x.awayId === s.yourTeamId
        );
        if (f) {
          const oppId = f.homeId === s.yourTeamId ? f.awayId : f.homeId;
          const { traits } = scoutOpponent(s, oppId);
          for (const i of INSTRUCTIONS) {
            if (i === "none") continue;
            const r = resolveInstruction(i, traits);
            const gain = r.attack - 1 + (1 - r.concede);
            if (gain > 1e-9) hits[i].bonus++;
            else if (gain < -1e-9) hits[i].malus++;
          }
        }
        s = playRound(s);
      }
    }
    for (const i of INSTRUCTIONS) {
      if (i === "none") continue;
      expect(hits[i].bonus, `${i}: nikdy nedal bonus`).toBeGreaterThan(0);
      expect(hits[i].malus, `${i}: nikdy nedal postih`).toBeGreaterThan(0);
    }
  });
});

describe("scouting – nejistota", () => {
  const teams = generateLeague(5);

  it("hlášený styl je stabilní přes rendery a někdy se liší od pravdy", () => {
    const s = newSeason(5, teams[0].id, { teams });
    const a = scoutOpponent(s, teams[1].id);
    const b = scoutOpponent(s, teams[1].id);
    expect(a.reportedStyle).toBe(b.reportedStyle);
    expect(a.confidence).toBeCloseTo(SCOUT_CONFIDENCE);

    let wrong = 0;
    let total = 0;
    for (let round = 0; round < 30; round++) {
      for (const t of teams.slice(1)) {
        const r = scoutOpponent({ ...s, round }, t.id);
        total++;
        if (r.reportedStyle !== r.style) wrong++;
      }
    }
    expect(wrong).toBeGreaterThan(0); // counter není jistota
    expect(wrong / total).toBeLessThan(0.45); // ale ani ruleta
  });

  it("investice do skautingu zvedne konfidenci", () => {
    const s = newSeason(5, teams[0].id, { teams });
    const boosted = scoutOpponent({ ...s, scoutBoostUntilRound: s.round + 2 }, teams[1].id);
    expect(boosted.confidence).toBeCloseTo(SCOUT_CONFIDENCE_BOOSTED);
  });

  it("náhled predikce neprozradí plán ani instrukci (nejde proklikat nejlepší %)", () => {
    const base = newSeason(5, teams[0].id, { teams });
    const a = yourNextMatch(setPlan(base, "open"));
    const b = yourNextMatch(setPlan(base, "low_block"));
    expect(a!.probs).toEqual(b!.probs);
    const c = yourNextMatch(setInstruction(base, "wing_play"));
    expect(a!.probs).toEqual(c!.probs);
  });
});
