// Generace fiktivní ligy 20 týmů s ratingy útoku/obrany. Deterministické dle seedu
// (stejný seed = stejná liga). Jména jsou vymyšlená (žádné reálné kluby → žádné TM).

import { mulberry32, shuffle } from "./rng";
import {
  ATTACK_MAX,
  ATTACK_MIN,
  DEFENSE_BEST,
  DEFENSE_WORST,
  HOME_BOOST_CAP,
  HOME_BOOST_FALLBACK,
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
 * Mistr silnější, dno slabší → realistická dominance favorita. Čistá funkce; volá se jen
 * na konci trychtýře ratingů čerstvě postavené ligy (generateLeague/standingsToTeams).
 * **Ne v mezisezónním driftu** – tam se rozptyl zachovává renormalizací (viz `driftTeams`).
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
    // ±0.1 šum ZVLÁŠŤ pro každou osu. Sdílený jitter (jedno losování do obou) se v síle
    // `attack − defense` odečte sám se sebou → žebřík sil by byl dokonale lineární
    // a šum by měnil jen styl (útočný/defenzivní), nikdy pořadí. Nezávislá losování
    // dají σ(síla) ≈ 0.08 proti rozestupu slotů 0.13 → sousedi se můžou prohodit.
    const attack = clamp(
      ATTACK_MAX - t * (ATTACK_MAX - ATTACK_MIN) + jitter(rand),
      ATTACK_MIN,
      ATTACK_MAX
    );
    const defense = clamp(
      DEFENSE_BEST + t * (DEFENSE_WORST - DEFENSE_BEST) + jitter(rand),
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

/**
 * Shrink k průměru populace při malém vzorku (méně šumu na začátku sezóny).
 * Exportované – používá i `scripts/buildNationalTeams.ts` pro reprezentace, které mají
 * často jen pár odehraných zápasů a jejich syrový průměr gólů je divoký.
 */
export function shrink(value: number, mean: number, n: number, k = SHRINK_K): number {
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
 *
 * **`homeBoost` = poměr SKUTEČNÝCH gólů: domácí góly/zápas ÷ celkové góly/zápas.** Je to
 * čistě reálná veličina, na herních ratinzích **nezávislá** – proto se počítá z hrubých
 * hodnot a `amplifySpread` na něj nesmí sáhnout. Kdyby se dělil post-spread útokem, dostaly
 * by slabé týmy (kterým spread útok stlačí) nejvyšší poměr, a `matchLambdas` jim aditivně
 * přidá největší domácí bonus: liga, kde všichni doma dávají +18 %, by dala nejlepšímu týmu
 * +0.26 gólu a nejhoršímu +0.50. `homeBoost` se pak ve `matchLambdas` převede na góly
 * (`homeAdvantage`), takže jeho jmenovatel musí být reálný, ne modelový.
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
    // Poměr reálných gólů doma vs celkově – nezávislý na spreadu i na shrinku.
    const homePlayed = row.homePlayed ?? 0;
    const overallGpg = played > 0 ? row.goalsFor / played : 0;
    const homeBoost =
      homePlayed > 0 && overallGpg > 0
        ? clamp((row.homeGoalsFor ?? 0) / homePlayed / overallGpg, 1, HOME_BOOST_CAP)
        : HOME_BOOST_FALLBACK;
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
  return amplifySpread(teams); // `amplifySpread` mění jen attack/defense, homeBoost nechává
}

/** ±0.1 šum ratingu. Volá se pro útok a obranu zvlášť – viz `generateLeague`. */
function jitter(rand: () => number): number {
  return (rand() - 0.5) * 0.2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
