// Doménové typy aplikace pro porovnání fotbalových týmů.

export type EntityType = "CLUB" | "NATIONAL";

export type Venue = "HOME" | "AWAY" | "TOTAL";

export type Metric =
  | "GOALS_FOR"
  | "GOALS_AGAINST"
  | "CORNERS"
  | "FOULS"
  | "XG"
  | "SHOTS";

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

export const ALL_METRICS: Metric[] = [
  "GOALS_FOR",
  "GOALS_AGAINST",
  "CORNERS",
  "FOULS",
  "XG",
  "SHOTS",
];

/** Reprezentace nepoužívají xG (§3.4). */
export const METRICS_BY_ENTITY: Record<EntityType, Metric[]> = {
  CLUB: ALL_METRICS,
  NATIONAL: ALL_METRICS.filter((m) => m !== "XG"),
};

export const METRIC_LABELS: Record<Metric, string> = {
  GOALS_FOR: "Vstřelené góly",
  GOALS_AGAINST: "Obdržené góly",
  CORNERS: "Rohy",
  FOULS: "Fauly",
  XG: "xG",
  SHOTS: "Střely",
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
  insights: Insight[];
}

export interface CompareResult {
  source: DataSource;
  /** Lidsky čitelné upozornění k zdroji dat (badge), pokud je relevantní. */
  sourceNote?: string;
  metrics: Metric[];
  home: TeamComparison;
  away: TeamComparison;
}

export interface Insight {
  type: string;
  severity: "info" | "warning" | "positive";
  text: string;
  metric?: Metric;
}
