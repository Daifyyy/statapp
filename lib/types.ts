// Doménové typy aplikace pro porovnání fotbalových týmů.

export type EntityType = "CLUB" | "NATIONAL";

export type Venue = "HOME" | "AWAY" | "TOTAL";

export type Metric =
  | "GOALS_FOR"
  | "GOALS_AGAINST"
  | "XG"
  | "SHOTS"
  | "SHOTS_ON_TARGET"
  | "SHOTS_OFF_TARGET"
  | "BLOCKED_SHOTS"
  | "SHOTS_INSIDE_BOX"
  | "SHOTS_OUTSIDE_BOX"
  | "POSSESSION"
  | "PASSES_TOTAL"
  | "PASSES_ACCURATE"
  | "PASS_ACCURACY"
  | "CORNERS"
  | "OFFSIDES"
  | "FOULS"
  | "YELLOW_CARDS"
  | "RED_CARDS"
  | "SAVES";

/** Okna pro kluby (počtová) a reprezentace (časová). */
export type WindowKey =
  | "SEASON"
  | "LAST10"
  | "LAST5" // kluby
  | "BASE"
  | "LAST12"
  | "LAST6"; // reprezentace

/** Zdroj dat zvolený rozhodovacím stromem (§3.2 plánu). */
export type DataSource =
  | "LEAGUE"
  | "EURO_CUPS"
  | "FALLBACK"
  | "NATIONAL"
  | "NATIONAL_FB";

/** Pořadí = pořadí řádků v UI (logické skupiny: góly → střely → držení/přihrávky → standardky → disciplína). */
export const ALL_METRICS: Metric[] = [
  "GOALS_FOR",
  "GOALS_AGAINST",
  "XG",
  "SHOTS",
  "SHOTS_ON_TARGET",
  "SHOTS_OFF_TARGET",
  "BLOCKED_SHOTS",
  "SHOTS_INSIDE_BOX",
  "SHOTS_OUTSIDE_BOX",
  "POSSESSION",
  "PASSES_TOTAL",
  "PASSES_ACCURATE",
  "PASS_ACCURACY",
  "CORNERS",
  "OFFSIDES",
  "FOULS",
  "YELLOW_CARDS",
  "RED_CARDS",
  "SAVES",
];

/**
 * Metriky, které u reprezentací typicky chybí v API (/fixtures/statistics bývá
 * neúplné) nebo je mock neumí věrně modelovat – pro NATIONAL je vynecháme. §3.4
 */
const NATIONAL_EXCLUDED: Metric[] = [
  "XG",
  "POSSESSION",
  "PASS_ACCURACY",
  "PASSES_TOTAL",
  "PASSES_ACCURATE",
  "SAVES",
  "BLOCKED_SHOTS",
  "SHOTS_INSIDE_BOX",
  "SHOTS_OUTSIDE_BOX",
];

export const METRICS_BY_ENTITY: Record<EntityType, Metric[]> = {
  CLUB: ALL_METRICS,
  NATIONAL: ALL_METRICS.filter((m) => !NATIONAL_EXCLUDED.includes(m)),
};

/** Metriky, u kterých je NIŽŠÍ hodnota lepší (obrácená logika zvýraznění). */
export const LOWER_IS_BETTER: Set<Metric> = new Set<Metric>([
  "GOALS_AGAINST",
  "FOULS",
  "YELLOW_CARDS",
  "RED_CARDS",
  "OFFSIDES",
]);

export const METRIC_LABELS: Record<Metric, string> = {
  GOALS_FOR: "Vstřelené góly",
  GOALS_AGAINST: "Obdržené góly",
  XG: "xG",
  SHOTS: "Střely",
  SHOTS_ON_TARGET: "Střely na branku",
  SHOTS_OFF_TARGET: "Střely mimo",
  BLOCKED_SHOTS: "Zblokované střely",
  SHOTS_INSIDE_BOX: "Střely z vápna",
  SHOTS_OUTSIDE_BOX: "Střely mimo vápno",
  POSSESSION: "Držení míče (%)",
  PASSES_TOTAL: "Přihrávky",
  PASSES_ACCURATE: "Přesné přihrávky",
  PASS_ACCURACY: "Přesnost přihrávek (%)",
  CORNERS: "Rohy",
  OFFSIDES: "Ofsajdy",
  FOULS: "Fauly",
  YELLOW_CARDS: "Žluté karty",
  RED_CARDS: "Červené karty",
  SAVES: "Zákroky brankáře",
};

export const WINDOW_LABELS: Record<WindowKey, string> = {
  SEASON: "Minulá sezóna",
  LAST10: "Posl. 10 zápasů",
  LAST5: "Posl. 5 zápasů",
  BASE: "Předchozí rok",
  LAST12: "Posl. 12 měsíců",
  LAST6: "Posl. 6 měsíců",
};

/** Statistiky jednoho odehraného zápasu z pohledu jednoho týmu. */
export interface MatchStat {
  fixtureId: number;
  date: string; // ISO 8601
  isHome: boolean;
  isNeutral: boolean; // turnaje na neutrální půdě (reprezentace)
  competitive: boolean; // false = přátelák
  season: number; // ligová sezóna zápasu (rok začátku); 0 = nerelevantní (reprez.)
  /** Patří do baseline („minulá sezóna") okna – dopočítáno při sestavení. */
  isBaseline: boolean;
  metrics: Partial<Record<Metric, number>>; // xG může chybět
}

export interface League {
  id: number;
  name: string;
  country: string;
  logoUrl: string;
  kind: "CLUB_LEAGUE" | "NATIONAL_COMP";
  confederation?: string;
}

export interface Team {
  id: number;
  name: string;
  logoUrl: string;
  country: string;
  entityType: EntityType;
  leagueId: number; // domácí liga (klub) / „pseudoliga" reprezentací
  /** Zápasy v domácí lize / soutěžní internacionály. */
  leagueMatches: MatchStat[];
  /** Zápasy v evropských pohárech (UCL/UEL/UECL), pokud tým hraje. */
  euroMatches?: MatchStat[];
}

/** Výsledek jednoho zápasu z pohledu týmu (forma). */
export type MatchResult = "W" | "D" | "L";

/**
 * Souhrn aktuální výkonnosti týmu pro jednu variantu (Doma/Venku/Celkově).
 * Forma = posledních 5 zápasů; čisté konto / bez gólu = % z posledních 10.
 * Mimo vážený průměr – procenta mají jeden jasný jmenovatel (`sampleSize`).
 */
export interface TeamSummary {
  venue: Venue;
  form: MatchResult[]; // nejnovější první, max 5
  formSampleSize: number; // kolik zápasů reálně tvoří formu (0–5)
  cleanSheetPct: number | null; // 0–100, null když je vzorek prázdný
  failedToScorePct: number | null; // 0–100, null když je vzorek prázdný
  sampleSize: number; // jmenovatel pro CS/FTS (0–10)
}

/** Zraněný hráč (samostatná, líně načítaná data – ne ze zápasových statistik). */
export interface Injury {
  playerId: number;
  name: string;
  reason: string;
}

/** Příspěvek jednoho časového okna do váženého průměru (pro tooltip). */
export interface WindowBreakdown {
  window: WindowKey;
  label: string;
  value: number | null;
  weight: number;
}

/** Spočítaná hodnota jedné metriky v jedné variantě pro jeden tým. */
export interface MetricValue {
  metric: Metric;
  venue: Venue;
  value: number | null;
  /** Nízká spolehlivost = malý efektivní vzorek (§3.4c). */
  lowConfidence: boolean;
  sampleSize: number;
  /** Rozpad váženého průměru po oknech (Sezóna/L10/L5 …). */
  breakdown: WindowBreakdown[];
}

export interface TeamComparison {
  team: Pick<Team, "id" | "name" | "logoUrl" | "country">;
  values: MetricValue[];
  /** Souhrn formy a CS/FTS pro každou variantu (HOME/AWAY/TOTAL). */
  summary: TeamSummary[];
}

/** Predikce zápasu z očekávaných gólů (Poisson). Domácí = první tým. */
export interface MatchPrediction {
  lambdaHome: number; // očekávané góly domácích
  lambdaAway: number; // očekávané góly hostů
  homeWin: number; // 0–1
  draw: number; // 0–1
  awayWin: number; // 0–1
  bttsYes: number; // 0–1 (oba skórují)
  over25: number; // 0–1 (3+ gólů celkem)
  lowConfidence: boolean; // malý vzorek pod predikcí
}

/** Kategorie signálu (pro ikonu, vyvážení top N a ladění vah). */
export type InsightCategory =
  | "attack"
  | "defense"
  | "form"
  | "tempo"
  | "setpiece"
  | "discipline"
  | "keeper"
  | "efficiency"
  | "matchup";

export type InsightSeverity = "info" | "warning" | "positive";

/** Jeden ohodnocený signál z rule-enginu (s konkrétními čísly v textu). */
export interface ScoredInsight {
  id: string; // id pravidla (+ scope)
  category: InsightCategory;
  severity: InsightSeverity;
  score: number; // 0–1 důležitost (řazení)
  text: string; // lokalizovaný, s čísly
  metric?: Metric;
  scope: "home" | "away" | "matchup";
  lowConfidence: boolean; // malý vzorek pod signálem
}

/** Výstup insights enginu pro jedno porovnání. */
export interface InsightReport {
  verdict: string; // jednovětné shrnutí
  keySignals: ScoredInsight[]; // top N napříč scope (řazené dle score)
  home: ScoredInsight[]; // per-tým (řazené)
  away: ScoredInsight[];
}

export interface CompareResult {
  source: DataSource;
  /** Lidsky čitelné upozornění k zdroji dat (badge), pokud je relevantní. */
  sourceNote?: string;
  metrics: Metric[];
  home: TeamComparison;
  away: TeamComparison;
  /** Predikce výsledku (domácí vs host). PRO – ve FREE výsledku chybí (viz `locked`). */
  prediction?: MatchPrediction;
  /** Insights: verdikt, klíčové signály a per-tým výroky. PRO – ve FREE chybí. */
  insightReport?: InsightReport;
  /** true = PRO sekce (predikce/insights/zranění) jsou zamčené (FREE bez trialu). */
  locked?: boolean;
}
