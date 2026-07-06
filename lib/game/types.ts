// Typy herního modulu „Manažer" (klubový simulátor ligy). Čistě serializovatelné –
// celý SaveState putuje do DB (Json) bez ztráty. Žádné metody/třídy.

/** Taktika tvého týmu – jediná páka, kterou hráč posouvá sílu útoku/obrany. */
export type Tactic = "attack" | "balanced" | "defense";

/** Tým v lize = dvě čísla (síla útoku/obrany) + kosmetika pro odznak/logo. */
export interface GameTeam {
  id: number;
  name: string;
  /** Krátký kód (3 písmena) pro odznak bez loga. */
  short: string;
  /** Barva pozadí odznaku (hex) – fallback když není logo. */
  color: string;
  /** URL loga (reálné týmy z API); u fiktivní ligy chybí. */
  logo?: string;
  /** Průměrné vstřelené góly na zápas (baseline útoku). */
  attack: number;
  /** Průměrné obdržené góly na zápas (baseline obrany, nižší = lepší). */
  defense: number;
  /** Násobič útoku doma (>1 = silnější doma) = domácí výhoda. */
  homeBoost: number;
}

/** Rozpis jednoho zápasu (bez výsledku). */
export interface Fixture {
  round: number;
  homeId: number;
  awayId: number;
}

/** Odehraný zápas (skóre). */
export interface MatchResult {
  round: number;
  homeId: number;
  awayId: number;
  homeGoals: number;
  awayGoals: number;
}

/** Řádek ligové tabulky (odvozený z výsledků). */
export interface TableRow {
  teamId: number;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDiff: number;
  points: number;
  rank: number;
}

/** Pravděpodobnosti výsledku 1X2 (z predikčního enginu, naučný display). */
export interface MatchProbs {
  homeWin: number;
  draw: number;
  awayWin: number;
}

/**
 * Evropská příčka, kam tvé umístění vede – rozlišuje ZÁKLADNÍ fázi vs. PŘEDKOLO
 * (kvalifikaci). Odvozeno z kurátorovaného UEFA access listu per liga (leagues.ts).
 */
export type EuropeSpot =
  | "UCL" // Liga mistrů – ligová/skupinová fáze
  | "UCL_Q" // Liga mistrů – předkolo
  | "UEL" // Evropská liga
  | "UEL_Q" // Evropská liga – předkolo
  | "UECL" // Konferenční liga
  | "UECL_Q" // Konferenční liga – předkolo
  | "NONE"; // bez evropského poháru

/** Kompaktní souhrn dohrané sezóny (do historie kariéry – ne všech ~380 zápasů). */
export interface SeasonSummary {
  season: number;
  leagueId: number;
  leagueName: string;
  yourTeamId: number;
  yourName: string;
  yourRank: number;
  /** Očekávané umístění dle síly týmu (pro over/under-performance). */
  expectedRank: number;
  yourPoints: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  /** Mistr ligy (1. místo). */
  champion: boolean;
  /** Kam vede umístění evropsky (vč. předkola). */
  europe: EuropeSpot;
  /** Sestup z ligy. */
  relegated: boolean;
  championId: number;
  championName: string;
}

/** Stav probíhající sezóny. */
export interface SeasonState {
  /** 1-based pořadí sezóny v kariéře. */
  season: number;
  /** Liga, ve které aktuálně hraješ (reálné id z katalogu, 0 = fiktivní/mock). */
  leagueId: number;
  leagueName: string;
  /** Seed pro rozpis (deterministický). */
  seed: number;
  teams: GameTeam[];
  yourTeamId: number;
  /** Rozpis po kolech (schedule[round] = zápasy kola). */
  schedule: Fixture[][];
  /** Akumulované výsledky odehraných kol. */
  results: MatchResult[];
  /** Index dalšího kola k odehrání (= schedule.length když je sezóna dohraná). */
  round: number;
  /** Zvolená taktika pro nejbližší zápas tvého týmu. */
  tactic: Tactic;
}

/** Kariérní profil trenéra (napříč sezónami). */
export interface Manager {
  /** Reputace 0–100 – řídí, které týmy si tě „najmou" (job market). */
  reputation: number;
}

/** Verze tvaru save – bump při nekompatibilní změně (starý save se zahodí). */
export const SAVE_VERSION = 3;

/** Kompletní uložená hra (v DB na profil). */
export interface SaveState {
  version: number;
  manager: Manager;
  current: SeasonState;
  history: SeasonSummary[];
}

/** Liga nabízená ve výběru (job market / start kariéry). */
export interface LeagueInfo {
  id: number;
  name: string;
  country: string;
  logo?: string;
}

/** Kandidát na trénování v job marketu (tým + zda je dostupný dle reputace). */
export interface JobCandidate {
  team: GameTeam;
  prestige: number;
  hireable: boolean;
}
