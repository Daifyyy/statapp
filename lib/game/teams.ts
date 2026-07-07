// Generace fiktivní ligy 20 týmů s ratingy útoku/obrany. Deterministické dle seedu
// (stejný seed = stejná liga). Jména jsou vymyšlená (žádné reálné kluby → žádné TM).

import { mulberry32 } from "./rng";
import {
  ATTACK_MAX,
  ATTACK_MIN,
  DEFENSE_BEST,
  DEFENSE_WORST,
  HOME_BOOST_MAX,
  HOME_BOOST_MIN,
  SHRINK_K,
  SPREAD,
  SPREAD_ATTACK_MAX,
  SPREAD_ATTACK_MIN,
  SPREAD_DEFENSE_MAX,
  SPREAD_DEFENSE_MIN,
} from "./balance";
import type { GameTeam } from "./types";

/** Počet týmů v lize (38 kol). */
export const LEAGUE_SIZE = 20;

/**
 * Roztáhne rozptyl sil ligy kolem jejího průměru (`rating' = mean + (rating−mean)·SPREAD`).
 * Mistr silnější, dno slabší → realistická dominance favorita. Čistá funkce; volá se na
 * konci každého trychtýře ratingů (generateLeague/standingsToTeams i po driftTeams).
 */
export function amplifySpread(teams: GameTeam[]): GameTeam[] {
  if (teams.length === 0) return teams;
  const meanAtk = teams.reduce((s, t) => s + t.attack, 0) / teams.length;
  const meanDef = teams.reduce((s, t) => s + t.defense, 0) / teams.length;
  return teams.map((t) => ({
    ...t,
    attack: round2(
      clamp(
        meanAtk + (t.attack - meanAtk) * SPREAD,
        SPREAD_ATTACK_MIN,
        SPREAD_ATTACK_MAX
      )
    ),
    defense: round2(
      clamp(
        meanDef + (t.defense - meanDef) * SPREAD,
        SPREAD_DEFENSE_MIN,
        SPREAD_DEFENSE_MAX
      )
    ),
  }));
}

/** Kosmetika 20 klubů (jméno, kód pro odznak, barva). Pořadí ≠ síla (ta se losuje). */
const TEAM_META: { name: string; short: string; color: string }[] = [
  { name: "FC Aurora", short: "AUR", color: "#1d4ed8" },
  { name: "Real Valdez", short: "VAL", color: "#b91c1c" },
  { name: "Athletic Kingsport", short: "KNG", color: "#047857" },
  { name: "Sporting Marisol", short: "MAR", color: "#7c3aed" },
  { name: "Dynamo Belport", short: "BEL", color: "#0e7490" },
  { name: "FC Northgate", short: "NOR", color: "#c2410c" },
  { name: "United Ravensford", short: "RAV", color: "#334155" },
  { name: "Olympia Verdant", short: "VER", color: "#15803d" },
  { name: "Cardinal SC", short: "CAR", color: "#be123c" },
  { name: "FC Solaris", short: "SOL", color: "#a16207" },
  { name: "Riverton FC", short: "RIV", color: "#0369a1" },
  { name: "Ironside United", short: "IRO", color: "#44403c" },
  { name: "FC Montclair", short: "MON", color: "#6d28d9" },
  { name: "Harborough City", short: "HAR", color: "#0d9488" },
  { name: "Vanguard FC", short: "VAN", color: "#4338ca" },
  { name: "FC Emberton", short: "EMB", color: "#dc2626" },
  { name: "Lakeside Rovers", short: "LAK", color: "#0891b2" },
  { name: "FC Castellan", short: "CAS", color: "#9333ea" },
  { name: "Granite City", short: "GRA", color: "#525252" },
  { name: "FC Meridian", short: "MER", color: "#2563eb" },
];

/** Fisher–Yates s daným RNG (deterministické). */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Vygeneruje ligu 20 týmů. Síla se rozprostře od nejsilnějšího po nejslabší (lineární
 * gradient + šum), pak se náhodně přiřadí ke klubům, aby seznam nebyl seřazený podle síly.
 * `id` = index 1..20 (stabilní klíč do rozpisu i tabulky).
 */
export function generateLeague(seed: number): GameTeam[] {
  const rand = mulberry32(seed);
  // Pořadí síly (0 = nejsilnější slot) rozházené mezi kluby.
  const order = shuffle(
    Array.from({ length: LEAGUE_SIZE }, (_, i) => i),
    rand
  );

  const base = TEAM_META.map((meta, idx) => {
    const slot = order[idx]; // 0 (top) .. 19 (bottom)
    const t = slot / (LEAGUE_SIZE - 1); // 0=top, 1=dno
    const jitter = (rand() - 0.5) * 0.2; // ±0.1 šum, ať nejsou týmy stejné tier klony
    const attack = clamp(
      ATTACK_MAX - t * (ATTACK_MAX - ATTACK_MIN) + jitter,
      ATTACK_MIN,
      ATTACK_MAX
    );
    const defense = clamp(
      DEFENSE_BEST + t * (DEFENSE_WORST - DEFENSE_BEST) + jitter,
      DEFENSE_BEST,
      DEFENSE_WORST
    );
    const homeBoost = HOME_BOOST_MIN + rand() * (HOME_BOOST_MAX - HOME_BOOST_MIN);
    return {
      id: idx + 1,
      name: meta.name,
      short: meta.short,
      color: meta.color,
      attack: round2(attack),
      defense: round2(defense),
      homeBoost: round2(homeBoost),
    };
  });
  return amplifySpread(base);
}

/**
 * Vloží tvůj klub do cílové ligy (postup/sestup) – tvůj tým si nese SVÉ ratingy
 * (kontinuita síly), soupeři přijdou z reálné tabulky cílové ligy. Udrží sudý počet
 * (roundRobin ho vyžaduje): tvůj tým nahradí nejslabšího soupeře, když by byl počet lichý.
 * Ratingy se ZÁMĚRNĚ nepřepočítávají spreadem – jinak by se tvá síla stáhla k průměru
 * nové ligy (sestoupivší klub má být v nižší lize relativně silný a naopak).
 */
export function injectYourTeam(leagueTeams: GameTeam[], you: GameTeam): GameTeam[] {
  const others = leagueTeams
    .filter((t) => t.id !== you.id)
    .sort((a, b) => b.attack - b.defense - (a.attack - a.defense)); // nejsilnější první
  let roster = [you, ...others];
  if (roster.length % 2 === 1) roster = roster.slice(0, -1); // dropni nejslabšího soupeře
  return roster;
}

/** Rychlé vyhledání týmu podle id. */
export function teamById(teams: GameTeam[], id: number): GameTeam {
  const t = teams.find((x) => x.id === id);
  if (!t) throw new Error(`Neznámý tým ${id}`);
  return t;
}

/** Minimální řádek ligové tabulky (adaptér z API-Football) pro odvození ratingů. */
export interface RawStandingRow {
  teamId: number;
  name: string;
  logo?: string;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  homePlayed?: number;
  homeGoalsFor?: number;
}

/** Shrink k ligovému průměru při malém vzorku (méně šumu na začátku sezóny). */
function shrink(value: number, mean: number, n: number, k = SHRINK_K): number {
  return (value * n + mean * k) / (n + k);
}

/** Krátký kód pro odznak z názvu týmu (fallback když se nenačte logo). */
function shortCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
  }
  return name.slice(0, 3).toUpperCase();
}

/** Stabilní barva odznaku z id týmu (fallback pod logem). */
function colorFromId(id: number): string {
  const hue = (id * 137) % 360;
  return `hsl(${hue} 55% 42%)`;
}

/**
 * Převede ligovou tabulku na herní týmy s ratingy útoku/obrany (góly na zápas,
 * shrink k ligovému průměru). Domácí výhoda z home splitu. Lichý počet → dropne
 * poslední (roundRobin potřebuje sudý počet).
 */
export function standingsToTeams(
  rows: RawStandingRow[],
  leagueAvg?: { goalsFor: number; goalsAgainst: number } | null
): GameTeam[] {
  const meanFor = leagueAvg?.goalsFor ?? 1.35;
  const meanAgainst = leagueAvg?.goalsAgainst ?? 1.35;
  const seen = new Set<number>();
  const teams: GameTeam[] = [];
  for (const row of rows) {
    if (seen.has(row.teamId)) continue;
    seen.add(row.teamId);
    const played = row.played;
    const attack =
      played > 0 ? shrink(row.goalsFor / played, meanFor, played) : meanFor;
    const defense =
      played > 0
        ? shrink(row.goalsAgainst / played, meanAgainst, played)
        : meanAgainst;
    const homePlayed = row.homePlayed ?? 0;
    const homeFor = row.homeGoalsFor ?? 0;
    const homeBoost =
      homePlayed > 0 && attack > 0
        ? clamp(homeFor / homePlayed / attack, 1.0, 1.3)
        : 1.1;
    teams.push({
      id: row.teamId,
      name: row.name,
      short: shortCode(row.name),
      color: colorFromId(row.teamId),
      logo: row.logo,
      attack: round2(clamp(attack, 0.3, 3.2)),
      defense: round2(clamp(defense, 0.3, 3.2)),
      homeBoost: round2(homeBoost),
    });
  }
  if (teams.length % 2 === 1) teams.pop();
  return amplifySpread(teams);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
