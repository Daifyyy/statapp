// Typy herního modulu „Manažer" (klubový simulátor ligy). Čistě serializovatelné –
// celý SaveState putuje do DB (Json) bez ztráty. Žádné metody/třídy.

// `import type` je při kompilaci ERASED → žádný runtime cyklus (types ↔ nationalCompetitions).
import type { TournamentRun } from "./nationalCompetitions";

/**
 * Zápasový plán tvého týmu – hlavní páka trenéra. Proti stylu soupeře funguje jako
 * counter (správný protitah = výhoda, špatný = postih; viz plans.ts).
 */
export type Plan = "balanced" | "open" | "low_block" | "press" | "counter";

/**
 * Vedlejší instrukce vedle plánu. Na rozdíl od plánu (counter proti STYLU soupeře) míří
 * na konkrétní **traity** ze scout reportu. Efekt je záměrně menší než u plánu.
 */
export type Instruction =
  | "none"
  | "man_mark" // osobní obrana na jejich hvězdu
  | "wing_play" // hra po křídlech
  | "set_pieces" // důraz na standardky
  | "high_line"; // vysoká obranná linie

/**
 * Herní styl soupeře – vstup pro counter logiku plánu (`COUNTER_MATRIX` v balance.ts).
 * Žije tady, a ne ve `scouting.ts`, aby ho mohly číst `balance.ts` i `plans.ts`, aniž by
 * na scouting vznikl cyklus (scouting od nich naopak potřebuje `recommendPlan`).
 */
export type OppStyle = "attacking" | "defensive" | "balanced";

/** Konkrétní rys soupeře – cíl vedlejší instrukce (`MATCHUP` v instructions.ts). */
export type Trait =
  | "strongAttack"
  | "weakDefense"
  | "solidDefense"
  | "inForm"
  | "poorForm"
  | "favourite"
  | "underdog";

/** Sezónní cíl vedení klubu (dle očekávaného umístění). Splnění → bonus k reputaci. */
export interface Objective {
  kind: "title" | "europe" | "midtable" | "survival" | "promotion";
  /** Umístění, které je třeba dosáhnout (met = yourRank ≤ targetRank). */
  targetRank: number;
  text: string;
}

/** Dočasný modifikátor λ z náhodného eventu (platí do daného kola včetně). */
export interface Modifier {
  untilRound: number;
  attack?: number;
  concede?: number;
  label: string;
}

/** Nevyřešený náhodný event navázaný na kolo (choices žijí v registru events.ts). */
export interface PendingEvent {
  id: string;
  round: number;
}

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

/**
 * Access key ligy: které umístění vede do kterého poháru (a zda do ZÁKLADNÍ fáze nebo
 * PŘEDKOLA) + kolik posledních míst sestupuje. Buď kurátorovaný fallback (`LEAGUE_ACCESS`
 * v leagues.ts), nebo odvozený z reálných dat sezóny (`deriveLeagueAccess` v
 * lib/data/standings.ts) a zachycený na `SeasonState.leagueAccess`.
 */
export interface LeagueAccess {
  /** Umístění → evropská příčka (jen místa, která do Evropy vedou). */
  slots: { rank: number; spot: EuropeSpot }[];
  /**
   * Kolik posledních míst sestupuje. `null` = z dat neodvoditelné (typicky ligy
   * s nadstavbou, kde API značí spodní skupinu jako fázi "Relegation Round", ne jako
   * sestupovou příčku) → volající spadne na kurátorovanou hodnotu (`accessFor`).
   * Nikdy ne `0`: nula by znamenala "liga bez sestupu" a zkratovala by fallback.
   */
  relegBottom: number | null;
}

/** Kompaktní souhrn dohrané sezóny (do historie kariéry – ne všech ~380 zápasů). */
export interface SeasonSummary {
  season: number;
  leagueId: number;
  leagueName: string;
  yourTeamId: number;
  yourName: string;
  /** URL loga tvého klubu (reálné týmy z API); u fiktivní ligy chybí. */
  yourLogo?: string;
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
  /** Sestup z ligy (z nejvyšší → 2. liga; z 2. ligy → vyhazov). */
  relegated: boolean;
  /** Postup do vyšší ligy (jen z 2. ligy: umístění v postupové zóně). */
  promoted?: boolean;
  championId: number;
  championName: string;
  /** Byl splněn sezónní cíl vedení? (bonus k reputaci) */
  objectiveMet: boolean;
  /**
   * Prestiž tvého klubu v této sezóně (`teamPrestige`) – strop pro KLADNÝ přírůstek reputace
   * (`REP_CEILING_MARGIN`). Volitelné = staré summary (fallback = strop 100 = bez efektu).
   */
  yourPrestige?: number;
}

/**
 * Kompaktní souhrn dohraného reprezentačního „běhu" (kvalifikace + turnaj) do síně slávy.
 * Vzniká **paralelně** k `SeasonSummary` – recyklovat ligový souhrn nejde, `champion: true`
 * z poháru by rozbil `AllTimeRecords.titles` i ligové achievementy.
 */
export interface TournamentSummary {
  competitionId: string;
  competitionName: string;
  /** Pořadové číslo turnaje v reprezentační kariéře (1-based). */
  edition: number;
  teamId: number;
  teamName: string;
  teamLogo?: string;
  /** Prošel jsi kvalifikací na závěrečný turnaj? */
  qualified: boolean;
  /** Nejdál dosažená fáze (Stage z tournament.ts); `group` = nedostal ses z kvalifikace/skupiny. */
  stageReached: string;
  /** Vyhrál jsi turnaj? */
  champion: boolean;
  played: number;
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Prestiž reprezentace (`nationPrestige`) – strop pro kladný přírůstek reputace. Volitelné. */
  teamPrestige?: number;
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
  /** RNG proud režimu (`RNG_SALT_LEAGUE`) – odděluje ligu od turnaje. Viz `agency.ts`. */
  rngSalt: number;
  teams: GameTeam[];
  yourTeamId: number;
  /** Rozpis po kolech (schedule[round] = zápasy kola). */
  schedule: Fixture[][];
  /** Akumulované výsledky odehraných kol. */
  results: MatchResult[];
  /** Index dalšího kola k odehrání (= schedule.length když je sezóna dohraná). */
  round: number;
  /** Zvolený zápasový plán pro nejbližší zápas tvého týmu. */
  plan: Plan;
  /** Vedlejší instrukce k plánu – funguje proti konkrétním traitům soupeře. */
  instruction: Instruction;
  /** Morálka/momentum týmu 0–100 (start 50) – ovlivňuje λ. */
  morale: number;
  /**
   * Kondice týmu 0–100 (start 100). Náročné plány (`press`/`open`) ji ubírají rychleji,
   * než ji regenerace doplní → „vždycky presuj" přestane být zadarmo. Jen postih λ.
   */
  fitness: number;
  /**
   * Investice do mládeže (0–`DEV_YOUTH_MAX`), kumulativně napříč sezónami U TOHOTO KLUBU.
   * Snižuje mezisezónní regresi tvého klubu (drží vydřený rating). Při převzetí jiného
   * klubu se ztrácí – patří klubu, ne trenérovi.
   */
  youth: number;
  /**
   * Investice do skautského oddělení (0–`SCOUT_LEVEL_MAX`), kumulativně U TOHOTO KLUBU.
   * Zvedá konfidenci skautského hlášení (`scoutConfidence`), na λ nesahá. Při převzetí
   * jiného klubu se ztrácí – patří klubu, stejně jako akademie.
   */
  scouting: number;
  /** Bonus/malus k rozvojovým bodům na konci sezóny (z eventů). */
  devBonus: number;
  /** Sezónní cíl vedení (fixní pro celou sezónu). */
  objective: Objective;
  /** Aktivní dočasné modifikátory z eventů. */
  modifiers: Modifier[];
  /**
   * Do kterého kola (včetně) má scouting zvýšenou spolehlivost (investice z eventu).
   * `null` = konfidence se počítá běžně (`scoutConfidence`).
   */
  scoutBoostUntilRound: number | null;
  /** Nevyřešený event pro aktuální kolo (nutno zvolit před odehráním), nebo null. */
  pendingEvent: PendingEvent | null;
  /**
   * Access key zachycený při výběru ligy – odvozený z reálné aktuální sezóny
   * (`deriveLeagueAccess`), nebo `null` (mock režim / odvození selhalo → `evaluateSeason`
   * padne na kurátorovaný fallback `LEAGUE_ACCESS`). Zachycen JEDNOU při startu sezóny,
   * aby se v jejím průběhu neměnil, i kdyby se mezitím reálná tabulka posunula.
   */
  leagueAccess: LeagueAccess | null;
}

/** Kariérní profil trenéra (napříč sezónami). Per-kariéra (reset při „Nové kariéře"). */
export interface Manager {
  /** Reputace 0–100 – řídí, které týmy si tě „najmou" (job market). */
  reputation: number;
}

/** Odemčený achievement (trvale v profilu). */
export interface EarnedAchievement {
  id: string;
  /** Sezóna kariéry, ve které padl. */
  season: number;
  /** ISO datum odemčení (jen pro zobrazení). */
  date: string;
}

/**
 * Trvalé kariérní rekordy – inkrementálně foldované po každé dohrané sezóně napříč
 * VŠEMI kariérami (přežijí „Novou kariéru"). Vstup pro rekordy i achievementy.
 */
export interface AllTimeRecords {
  careers: number;
  seasons: number;
  titles: number;
  europeanQualifs: number;
  uclQualifs: number;
  relegations: number;
  totalWin: number;
  totalDraw: number;
  totalLoss: number;
  totalGoalsFor: number;
  totalGoalsAgainst: number;
  cleanSheets: number;
  /** Nejlepší (nejnižší) umístění v jakékoli sezóně; 0 = zatím žádné. */
  bestRank: number;
  bestSeasonPoints: number;
  mostGoalsSeason: number;
  bestReputation: number;
  /** Distinct id lig, které jsi kdy trénoval. */
  leaguesCoached: number[];
  /** Počet sezón bez jediné prohry. */
  invincibleSeasons: number;
  // ── reprezentační scéna (Phase 4) – vlastní pole, NEmíchá se s ligovými rekordy ──
  /** Kolik reprezentačních turnajů jsi absolvoval (vč. neúspěšné kvalifikace). Volitelné = staré profily. */
  tournamentsPlayed?: number;
  /** Vyhrané velké turnaje (Euro/MS). */
  majorTitles?: number;
  /** Kolikrát ses dostal do finále turnaje. */
  finalsReached?: number;
  /** Distinct id reprezentací, které jsi vedl. */
  nationsCoached?: number[];
}

/** Trvalý manažerský profil – síň slávy. Přežívá „Novou kariéru". */
export interface ManagerProfile {
  allTime: AllTimeRecords;
  achievements: EarnedAchievement[];
}

/** Verze tvaru save – bump při nekompatibilní změně (starý save se zahodí). */
export const SAVE_VERSION = 9;

/** Kompletní uložená hra (v DB na profil). */
export interface SaveState {
  version: number;
  /** Trvalý profil (rekordy + achievementy) – přežije reset kariéry. */
  profile: ManagerProfile;
  manager: Manager;
  /** Aktuální ligová sezóna, nebo null = bez aktivní klubové kariéry. */
  current: SeasonState | null;
  history: SeasonSummary[];
  /**
   * Probíhající reprezentační běh (kvalifikace + turnaj), nebo null. **Invariant:** `current`
   * a `tournament` nejsou nikdy oba non-null (v jednu chvíli vedeš buď klub, nebo reprezentaci).
   * `import type` (erased) → žádný runtime cyklus types ↔ nationalCompetitions. Volitelné =
   * staré v8 save bez tohoto pole (čte se s `?? null`).
   */
  tournament?: TournamentRun | null;
  /** Historie dohraných reprezentačních turnajů (síň slávy). Volitelné = staré save. */
  tournamentHistory?: TournamentSummary[];
}

/** Liga nabízená ve výběru (job market / start kariéry). */
export interface LeagueInfo {
  id: number;
  name: string;
  country: string;
  logo?: string;
  /** 1 = nejvyšší soutěž, 2 = druhá liga. Chybí u starších odpovědí → ber jako 1. */
  tier?: number;
}

/** Kandidát na trénování v job marketu (tým + zda je dostupný dle reputace). */
export interface JobCandidate {
  team: GameTeam;
  prestige: number;
  hireable: boolean;
}
