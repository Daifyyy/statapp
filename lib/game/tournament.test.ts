import { describe, expect, it } from "vitest";
import { generateLeague } from "./teams";
import { singleRoundRobin, roundRobin } from "./schedule";
import { buildTable, groupTable, rankAcrossGroups } from "./standings";
import { teamStrengthScore } from "./leagues";
import { mulberry32 } from "./rng";
import { RNG_SALT_TOURNAMENT } from "./agency";
import { playKnockoutTie } from "./tournament";
import {
  EURO_FORMAT,
  WORLD_CUP_FORMAT,
  bracketSeedOrder,
  drawGroups,
  firstKnockoutStage,
  groupIndexOf,
  isTournamentOver,
  knockoutSize,
  newTournament,
  playTournamentRound,
  seedBracket,
  simulateTournamentToEnd,
} from "./tournament";
import type { GameTeam, MatchResult } from "./types";

/** Turnajové pole: recykluje generovanou ligu, přečísluje id a nastaví neutrální půdu. */
function field(n: number, seed = 500): GameTeam[] {
  const out: GameTeam[] = [];
  let s = seed;
  while (out.length < n) {
    for (const t of generateLeague(s)) {
      if (out.length >= n) break;
      out.push({ ...t, id: out.length + 1, name: `N${out.length + 1}`, homeBoost: 1 });
    }
    s++;
  }
  return out;
}

describe("singleRoundRobin", () => {
  it("skupina 4 týmů = 3 kola po 2 zápasech, každá dvojice právě jednou", () => {
    const s = singleRoundRobin([10, 20, 30, 40]);
    expect(s).toHaveLength(3);
    for (const round of s) expect(round).toHaveLength(2);

    const pairs = new Set<string>();
    for (const round of s) {
      const seen = new Set<number>();
      for (const f of round) {
        expect(seen.has(f.homeId)).toBe(false);
        expect(seen.has(f.awayId)).toBe(false);
        seen.add(f.homeId);
        seen.add(f.awayId);
        pairs.add([f.homeId, f.awayId].sort((a, b) => a - b).join("-"));
      }
    }
    expect(pairs.size).toBe(6); // C(4,2)
  });

  it("roundRobin je pořád jen zrcadlo jednokolového rozpisu", () => {
    const ids = [1, 2, 3, 4, 5, 6];
    expect(roundRobin(ids)).toHaveLength(2 * singleRoundRobin(ids).length);
  });

  it("odmítne lichý počet", () => {
    expect(() => singleRoundRobin([1, 2, 3])).toThrow();
  });
});

describe("groupTable – tiebreaky", () => {
  const G = [1, 2, 3, 4];
  const m = (h: number, a: number, hg: number, ag: number): MatchResult => ({
    round: 0,
    homeId: h,
    awayId: a,
    homeGoals: hg,
    awayGoals: ag,
  });

  // Regrese: `buildTable` řadí při plné shodě podle `teamId` – ve skupině o 3 kolech by
  // o postupu do osmifinále rozhodovalo databázové id.
  it("při naprosté shodě NErozhoduje teamId, ale seedovaný los", () => {
    // 1 a 2 mají vše stejné (i vzájemný zápas remíza), 3 a 4 taky.
    const results = [m(1, 2, 1, 1), m(3, 4, 1, 1), m(1, 3, 2, 0), m(2, 4, 2, 0), m(1, 4, 0, 1), m(2, 3, 0, 1)];
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const winners = new Set(seeds.map((s) => groupTable(G, results, s)[0].teamId));
    // Při různých seedech vyjde nahoře různý tým → nerozhoduje id.
    expect(winners.size).toBeGreaterThan(1);
    // Ale pro daný seed je to deterministické.
    expect(groupTable(G, results, 42)).toEqual(groupTable(G, results, 42));
  });

  it("vzájemný zápas přebije gólový rozdíl", () => {
    // 1 i 2 mají 6 bodů; 2 má výrazně lepší celkový rozdíl (+7 vs +1), ale 1 ho porazil.
    const results = [
      m(1, 2, 1, 0), // vzájemný: 1 vyhrál
      m(1, 3, 1, 0),
      m(1, 4, 0, 1),
      m(2, 3, 5, 0),
      m(2, 4, 3, 0),
      m(3, 4, 1, 0),
    ];
    const base = buildTable(G, results);
    const t = groupTable(G, results, 7);
    // Kontrola předpokladu: ligové řazení (bez vzájemných) by dalo nahoru dvojku.
    expect(base[0].teamId).toBe(2);
    expect(base.find((r) => r.teamId === 1)!.points).toBe(6);
    expect(base.find((r) => r.teamId === 2)!.points).toBe(6);
    // Turnajové řazení dá nahoru jedničku.
    expect(t[0].teamId).toBe(1);
    expect(t[1].teamId).toBe(2);
  });

  /**
   * Reálný a nepříjemný případ: tři týmy mají 6 bodů a jejich vzájemné zápasy tvoří cyklus
   * (1>2, 2>4, 4>1). Minitabulka pak nerozhodne body, ale gólovým rozdílem v ní.
   * Zároveň je to důvod, proč se řadí PO BLOCÍCH – takový vztah není tranzitivní a jediný
   * komparátor by ve V8 vrátil libovolné pořadí.
   */
  it("trojitá shoda s cyklem se rozsekne rozdílem v minitabulce", () => {
    const results = [
      m(1, 2, 1, 0), // 1 > 2
      m(2, 4, 5, 0), // 2 > 4
      m(1, 4, 0, 1), // 4 > 1
      m(1, 3, 1, 0),
      m(2, 3, 5, 0),
      m(3, 4, 0, 1),
    ];
    const t = groupTable(G, results, 7);
    for (const id of [1, 2, 4]) {
      expect(t.find((r) => r.teamId === id)!.points).toBe(6);
    }
    // Rozdíl ve vzájemných: 2 → +4, 1 → 0, 4 → −4.
    expect(t.map((r) => r.teamId)).toEqual([2, 1, 4, 3]);
    // A je to stabilní: stejný vstup, stejné pořadí.
    expect(groupTable(G, results, 7).map((r) => r.teamId)).toEqual([2, 1, 4, 3]);
  });

  it("los nezávisí na pořadí týmů ve vstupu", () => {
    const results = [m(1, 2, 1, 1), m(3, 4, 1, 1), m(1, 3, 2, 0), m(2, 4, 2, 0), m(1, 4, 0, 1), m(2, 3, 0, 1)];
    const a = groupTable([1, 2, 3, 4], results, 42).map((r) => r.teamId);
    const b = groupTable([4, 3, 2, 1], results, 42).map((r) => r.teamId);
    expect(a).toEqual(b);
  });

  it("rankAcrossGroups řadí třetí místa dle bodů → rozdílu → vstřelených", () => {
    const rows = [
      { teamId: 1, points: 3, goalsDiff: 0, goalsFor: 3 },
      { teamId: 2, points: 4, goalsDiff: -1, goalsFor: 2 },
      { teamId: 3, points: 3, goalsDiff: 1, goalsFor: 2 },
    ].map((r) => ({ ...r, played: 3, win: 1, draw: 0, loss: 2, goalsAgainst: 0, rank: 3 }));
    expect(rankAcrossGroups(rows, 1).map((r) => r.teamId)).toEqual([2, 3, 1]);
  });
});

describe("pavouk", () => {
  it("bracketSeedOrder drží jedničku a dvojku na opačných polovinách", () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const o16 = bracketSeedOrder(16);
    expect(o16).toHaveLength(16);
    expect(new Set(o16).size).toBe(16);
    // Jednička v první polovině, dvojka ve druhé → potkají se nejdřív ve finále.
    expect(o16.indexOf(1)).toBeLessThan(8);
    expect(o16.indexOf(2)).toBeGreaterThanOrEqual(8);
  });

  it("odmítne velikost, která není mocnina dvou", () => {
    expect(() => bracketSeedOrder(12)).toThrow();
  });

  // Naivní `1v16, 2v15, …` s párováním sousedních vítězů by poslalo jedničku na dvojku
  // už ve čtvrtfinále. Tenhle test to hlídá simulací postupu vždy lepšího nasazení.
  it("nejlepší dva nasazení se potkají až ve finále", () => {
    const qualified = Array.from({ length: 16 }, (_, i) => i + 1); // id = nasazení
    let ties = seedBracket(qualified, () => -1); // žádné skupinové odvety
    let stages = 0;
    while (ties.length > 1) {
      const winners = ties.map((t) => Math.min(t.homeId, t.awayId)); // vyhraje lepší nasazení
      ties = Array.from({ length: winners.length / 2 }, (_, i) => ({
        homeId: winners[2 * i],
        awayId: winners[2 * i + 1],
      }));
      stages++;
    }
    expect(stages).toBe(3); // R16 → QF → SF, zbylo finále
    expect([ties[0].homeId, ties[0].awayId].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("odvetě ze stejné skupiny se v prvním kole vyhne", () => {
    const qualified = [1, 2, 3, 4, 5, 6, 7, 8];
    // 1 a 8 jsou ze skupiny 0 → naivní klíč (1v8) by byl odveta.
    const groupOf = (id: number) => (id === 1 || id === 8 ? 0 : id);
    const ties = seedBracket(qualified, groupOf);
    for (const t of ties) expect(groupOf(t.homeId)).not.toBe(groupOf(t.awayId));
  });
});

describe("vyřazovací zápas", () => {
  const a: GameTeam = { id: 1, name: "A", short: "A", color: "#000", attack: 1.6, defense: 1.3, homeBoost: 1 };
  const b: GameTeam = { id: 2, name: "B", short: "B", color: "#000", attack: 1.6, defense: 1.3, homeBoost: 1 };

  it("nikdy nevrátí remízu a vítěz je jeden z týmů", () => {
    for (let s = 0; s < 300; s++) {
      const rand = mulberry32(s);
      const tie = playKnockoutTie(a, b, { attack: 1, concede: 1 }, { attack: 1, concede: 1 }, rand, "qf", 4);
      expect([a.id, b.id]).toContain(tie.winnerId);
      if (!tie.penalties) expect(tie.homeGoals).not.toBe(tie.awayGoals);
      else expect(tie.homeGoals).toBe(tie.awayGoals); // rozstřel jen při remíze po prodloužení
    }
  });

  it("prodloužení i penalty nastávají v realistickém poměru", () => {
    let et = 0;
    let pk = 0;
    const N = 800;
    for (let s = 0; s < N; s++) {
      const tie = playKnockoutTie(a, b, { attack: 1, concede: 1 }, { attack: 1, concede: 1 }, mulberry32(s), "qf", 4);
      if (tie.afterExtraTime) et++;
      if (tie.penalties) pk++;
    }
    // Reálně jde do prodloužení zhruba čtvrtina KO zápasů, z toho asi polovina na penalty.
    expect(et / N).toBeGreaterThan(0.15);
    expect(et / N).toBeLessThan(0.35);
    expect(pk).toBeGreaterThan(0);
    expect(pk).toBeLessThan(et);
  });

  it("silnější tým má v rozstřelu jen mírnou výhodu (není to jistota)", () => {
    const strong: GameTeam = { ...a, attack: 2.4 };
    const weak: GameTeam = { ...b, attack: 0.9 };
    let wins = 0;
    let shootouts = 0;
    for (let s = 0; s < 4000; s++) {
      const tie = playKnockoutTie(strong, weak, { attack: 1, concede: 1 }, { attack: 1, concede: 1 }, mulberry32(s), "qf", 4);
      if (!tie.penalties) continue;
      shootouts++;
      if (tie.winnerId === strong.id) wins++;
    }
    expect(shootouts).toBeGreaterThan(20);
    const p = wins / shootouts;
    expect(p).toBeGreaterThan(0.5); // výhoda existuje
    expect(p).toBeLessThan(0.68); // ale rozstřel není o kvalitě
  });
});

describe("turnaj end-to-end", () => {
  it.each([
    [EURO_FORMAT, 24, 16, 36, 15],
    [WORLD_CUP_FORMAT, 48, 32, 72, 31],
  ])("$name: správný počet skupin, zápasů a KO kol", (format, n, koSize, groupMatches, koMatches) => {
    expect(knockoutSize(format)).toBe(koSize);
    const teams = field(n);
    const s0 = newTournament(999, teams[7].id, teams, format);
    expect(s0.groups).toHaveLength(format.groups);
    expect(s0.groupSchedule.flat()).toHaveLength(groupMatches);
    expect(s0.stage).toBe("group");
    expect(s0.rngSalt).toBe(RNG_SALT_TOURNAMENT);

    const done = simulateTournamentToEnd(s0, format);
    expect(isTournamentOver(done)).toBe(true);
    expect(done.knockout).toHaveLength(koMatches);
    expect(done.results).toHaveLength(groupMatches + koMatches);
    expect(done.champion).not.toBeNull();
    expect(teams.some((t) => t.id === done.champion)).toBe(true);
    // Vyřazovací fáze nikdy neskončí remízou.
    for (const k of done.knockout) {
      expect(k.winnerId === k.homeId || k.winnerId === k.awayId).toBe(true);
    }
  });

  it("firstKnockoutStage sedí na velikost pavouka", () => {
    expect(firstKnockoutStage(EURO_FORMAT)).toBe("r16");
    expect(firstKnockoutStage(WORLD_CUP_FORMAT)).toBe("r32");
  });

  it("los z košíků: dva nejsilnější nejsou ve stejné skupině", () => {
    const teams = field(24);
    const groups = drawGroups(teams, EURO_FORMAT, 4242);
    expect(groups.flat()).toHaveLength(24);
    expect(new Set(groups.flat()).size).toBe(24); // žádný tým dvakrát
    const ranked = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    const g0 = groups.findIndex((g) => g.includes(ranked[0].id));
    const g1 = groups.findIndex((g) => g.includes(ranked[1].id));
    expect(g0).not.toBe(g1);
  });

  it("je deterministický dle seedu", () => {
    const teams = field(24);
    const a = simulateTournamentToEnd(newTournament(7, teams[3].id, teams, EURO_FORMAT), EURO_FORMAT);
    const b = simulateTournamentToEnd(newTournament(7, teams[3].id, teams, EURO_FORMAT), EURO_FORMAT);
    expect(a.champion).toBe(b.champion);
    expect(a.results).toEqual(b.results);
  });

  it("vypadnutí ve skupině ukončí tvůj turnaj, ale soutěž se dohraje", () => {
    const teams = field(24);
    // Vezmi nejslabší tým – ze skupiny skoro jistě neprojde.
    const weakest = [...teams].sort((a, b) => teamStrengthScore(a) - teamStrengthScore(b))[0];
    let s = newTournament(11, weakest.id, teams, EURO_FORMAT);
    while (s.stage === "group") s = playTournamentRound(s, EURO_FORMAT);
    if (s.eliminated) {
      expect(s.yourStage).toBe("group");
      expect(s.pendingEvent).toBeNull(); // vypadlému se eventy nenabízejí
      const done = simulateTournamentToEnd(s, EURO_FORMAT);
      expect(done.champion).not.toBe(weakest.id);
      expect(isTournamentOver(done)).toBe(true);
    }
  });

  it("mistr má yourStage 'final', ne 'done' (je to „kam jsi to dotáhl“)", () => {
    const teams = field(24);
    for (let seed = 0; seed < 40; seed++) {
      const strongest = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a))[0];
      const done = simulateTournamentToEnd(
        newTournament(seed, strongest.id, teams, EURO_FORMAT),
        EURO_FORMAT
      );
      if (done.champion === strongest.id) {
        expect(done.yourStage).toBe("final");
        expect(done.eliminated).toBe(false);
        return;
      }
    }
    throw new Error("nejsilnější tým nevyhrál ani jednou ze 40 turnajů – podezřelé");
  });

  it("skupinová tabulka počítá jen zápasy v rámci skupiny", () => {
    const teams = field(24);
    const done = simulateTournamentToEnd(newTournament(3, teams[0].id, teams, EURO_FORMAT), EURO_FORMAT);
    const g = groupIndexOf(done, teams[0].id);
    const table = groupTable(done.groups[g], done.results, done.seed, g);
    // 4 týmy × 3 zápasy, i když `results` obsahuje celý turnaj včetně pavouka.
    for (const row of table) expect(row.played).toBe(3);
  });
});
