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
  | "SAVES"
  // Odvozené metriky (počítá je `metricOf` v aggregate.ts z gólů, NEukládají se a nejsou
  // v `ALL_METRICS` → nezobrazují se v UI a nevyžadují bump cache). Vážený průměr přes ně
  // dá **frekvenci jevu**: „jak často tým vůbec skóroval" / „jak často udržel nulu".
  // Poisson tyhle jevy jen ODVOZUJE z průměru gólů (P(≥1) = 1 − e^−λ); tady je měříme přímo.
  | "SCORED"
  | "CLEAN_SHEET"
  /**
   * xG, které tým **inkasoval** (= xG soupeře v tom zápase). Kvalita obrany: kolik šancí
   * tým pouští, nezávisle na tom, kolik z nich soupeř proměnil. Do `MatchStat` ho plní
   * ten, kdo má po ruce statistiky obou stran (`/fixtures/statistics` je vrací v jedné
   * odpovědi). Mimo `ALL_METRICS` → v UI se nezobrazuje.
   */
  | "XG_AGAINST";

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
  // Odvozené (mimo `ALL_METRICS` → v UI se nezobrazují); label jen kvůli úplnosti typu.
  SCORED: "Skóroval (podíl zápasů)",
  CLEAN_SHEET: "Čisté konto (podíl zápasů)",
  XG_AGAINST: "Inkasované xG",
};

/**
 * Krátká vysvětlení méně samozřejmých metrik (tooltip „ⓘ" u řádku v UI).
 * Jen tam, kde laik nemusí výraz znát; samozřejmé metriky (góly, rohy…) vynechány.
 */
export const METRIC_HINTS: Partial<Record<Metric, string>> = {
  XG: "Očekávané góly (expected goals): kolik gólů by tým měl vstřelit podle kvality svých šancí.",
  SHOTS_ON_TARGET: "Střely směřující do branky (gólman musel zasáhnout nebo skončily gólem).",
  BLOCKED_SHOTS: "Střely zablokované bránícím hráčem ještě před brankářem.",
  SHOTS_INSIDE_BOX: "Střely z pokutového území (z vápna).",
  SHOTS_OUTSIDE_BOX: "Střely mimo pokutové území.",
  POSSESSION: "Průměrný podíl času s míčem na noze (% z hrací doby).",
  PASS_ACCURACY: "Podíl úspěšných (přesných) přihrávek ze všech.",
  OFFSIDES: "Počet odpískaných ofsajdů týmu.",
  SAVES: "Počet zákroků (chytů) brankáře za zápas.",
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

/**
 * Lehký záznam nadcházejícího zápasu pro záložku „Zápasy" (seznam = navigace,
 * predikce se počítá až klikem přes deep-link do Porovnání). `national` = reprezentační
 * soutěž → klik míří do NATIONAL módu, kde „ligou" týmu je jeho **konfederace**
 * (`home/awayCompareLeagueId`); klubový zápas → CLUB mód s `leagueId` u obou.
 * Když u reprezentačního zápasu konfederaci nedohledáme (`null`), řádek je neklikací.
 */
export interface UpcomingFixture {
  fixtureId: number;
  leagueId: number;
  leagueName: string;
  leagueLogoUrl: string;
  kickoff: string;
  home: { id: number; name: string; logoUrl: string };
  away: { id: number; name: string; logoUrl: string };
  national: boolean;
  /** Mód cílového Porovnání (klub vs. reprezentace). */
  compareMode: EntityType;
  /** „Liga" pro deep-link: klub → `leagueId`, reprezentace → konfederace týmu (či null). */
  homeCompareLeagueId: number | null;
  awayCompareLeagueId: number | null;
  /** Pozice v ligové tabulce (FREE kontext; jen kluby, doplněno server-side). */
  homeRank?: number | null;
  awayRank?: number | null;
}

/** Zápasy jednoho dne (`date` = `YYYY-MM-DD`) pro záložku „Zápasy". */
export interface FixtureDay {
  date: string;
  fixtures: UpcomingFixture[];
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

/**
 * Hráč ze špičky střelců ligy patřící k danému týmu (FREE kontext v Porovnání – „kdo
 * z tohoto týmu střílí góly v lize"). Líně načítané mimo compareTeams; jen kluby.
 */
export interface Scorer {
  playerId: number;
  name: string;
  goals: number;
}

/** Bilance jedné části tabulky (celkově / doma / venku). */
export interface StandingSplit {
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * Postavení týmu v ligové tabulce (samostatná, líně načítaná statistika – FREE kontext,
 * mimo compareTeams i predikci). Jen kluby; reprezentace tabulku nemají (→ null).
 */
export interface Standing {
  rank: number;
  points: number;
  goalsDiff: number;
  /** Krátká forma z tabulky, např. „WWDLW" (nejnovější vpravo) nebo `null`, když chybí. */
  form: string | null;
  all: StandingSplit;
  home: StandingSplit;
  away: StandingSplit;
}

/**
 * Zóna řádku ligové tabulky odvozená z popisu místa (API-Football `description`).
 * Slouží jen k barevnému zvýraznění v záložce Tabulky (LM/EL/KL, postup, sestup).
 */
export type LeagueTableZone =
  | "champions"
  | "europa"
  | "conference"
  | "promotion"
  | "relegation";

/** Jeden řádek celé ligové tabulky (záložka Tabulky). Kompletní V-R-P + góly + body. */
export interface LeagueTableRow {
  rank: number;
  teamId: number;
  name: string;
  logoUrl: string;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDiff: number;
  points: number;
  /** Krátká forma z tabulky, např. „WWDLW" (nejnovější vpravo), nebo `null`. */
  form: string | null;
  /** Zóna pro barevné zvýraznění (evropský pohár / postup / sestup), nebo `null`. */
  zone: LeagueTableZone | null;
}

/** Celá ligová tabulka + ligový průměr gólů na zápas (FREE, sdílí `standings:` cache). */
export interface LeagueTable {
  rows: LeagueTableRow[];
  leagueAvg: LeagueGoalsAvg | null;
}

/**
 * Jeden přestup (záložka Přestupy). `feeEur` je best-effort odhad z volného textu
 * `type` z API – často `null` (API neuvádí spolehlivé částky). `in*` = kam hráč přišel,
 * `out*` = odkud odešel.
 */
export interface Transfer {
  playerId: number;
  playerName: string;
  date: string; // ISO
  type: string | null; // surový text z API ("Loan" | "Free" | "€ 20M" | "N/A" …)
  category: TransferCategory; // odvozená kategorie (klient filtruje bez serverového kódu)
  feeEur: number | null; // částka přestupu v EUR (TM dataset), null/0 = neznámá/nezveřejněná
  marketValueEur: number | null; // tržní hodnota hráče v čase přestupu (TM)
  inTeamId: number | null;
  inTeamName: string | null;
  inTeamLogo: string | null;
  outTeamId: number | null;
  outTeamName: string | null;
  outTeamLogo: string | null;
  leagueId: number; // liga, pro kterou byl záznam stažen
  season: number;
}

/**
 * Kategorie přestupu odvozená z volného textu `type` z API. Peněžní částky API
 * prakticky nedává (2 z tisíců), zato `type` nese typ pohybu → bilanci stavíme na něm.
 */
export type TransferCategory = "permanent" | "loan" | "loanReturn" | "free" | "other";

/** Počty přestupů po kategoriích (pro jednu stranu – příchody nebo odchody). */
export type TransferCategoryCounts = Record<TransferCategory, number>;

/** Bilance přestupů jednoho klubu: peníze (z TM cen) + počty; kategorie ponechány (dead code). */
export interface ClubTransferBalance {
  teamId: number;
  teamName: string;
  teamLogo: string | null;
  leagueId: number;
  inCount: number;
  outCount: number;
  /** Součet cen příchozích / odchozích (jen kde fee>0). net = earn − spend. */
  spendEur: number;
  earnEur: number;
  netEur: number;
  /** Kolik přestupů má známou cenu (fee>0) – kvůli „neúplná data" poznámce. */
  knownFeeCount: number;
  /** Rozpad po kategoriích – ponecháno pro případný návrat ke kategoriovému zobrazení. */
  inByCategory: TransferCategoryCounts;
  outByCategory: TransferCategoryCounts;
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
/** Jedno přesné skóre s pravděpodobností (z téže opravené mřížky jako 1X2). */
export interface ScoreProbability {
  home: number; // góly domácích
  away: number; // góly hostů
  prob: number; // 0–1
}

/** Úroveň připravenosti predikce (kolik dat za ní stojí) – pro odznak. */
export type ReadinessLevel = "low" | "medium" | "ok";

/** Připravenost predikce: efektivní vzorek nejslabšího vstupu λ + skóre 0–1 + úroveň. */
export interface Readiness {
  sample: number;
  score: number;
  level: ReadinessLevel;
}

export interface MatchPrediction {
  /** false = chybí gólová i xG data → predikci nelze vydat (UI zobrazí hlášku). */
  available: boolean;
  lambdaHome: number; // očekávané góly domácích (po zostření – souhlasí s mřížkou)
  lambdaAway: number; // očekávané góly hostů (po zostření)
  /**
   * λ **před** zostřením – to, co generuje model (`MODEL_VERSION`). Ukládá se do
   * `FixturePrediction`, protože z něj jde predikci přepočítat při změně post-parametrů
   * (ρ / zostření) bez nového fetchu. Při `sharpen = 1` shodné s `lambdaHome/Away`.
   */
  lambdaHomeBase: number;
  lambdaAwayBase: number;
  homeWin: number; // 0–1
  draw: number; // 0–1
  awayWin: number; // 0–1
  bttsYes: number; // 0–1 (oba skórují)
  over25: number; // 0–1 (3+ gólů celkem)
  /** Nejpravděpodobnější přesná skóre (sestupně), z téže opravené mřížky. Prázdné, když available=false. */
  topScores: ScoreProbability[];
  lowConfidence: boolean; // malý vzorek pod predikcí
  /** Připravenost predikce (kolik dat za λ stojí) – pro odznak „málo dat" na startu sezóny. */
  readiness: Readiness;
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

/**
 * Uložená predikce nadcházejícího zápasu (+ výsledek po odehrání). Zdrojově
 * nezávislý tvar (real = DB `FixturePrediction`, mock = generátor) – čte ho
 * predikční záložka, track-record i kalibrace. `kickoff` je ISO 8601.
 */
export interface PredictionRow {
  fixtureId: number;
  leagueId: number;
  season: number;
  kickoff: string;
  homeTeamId: number;
  awayTeamId: number;
  homeName: string;
  awayName: string;
  homeLogo: string;
  awayLogo: string;
  available: boolean;
  /** λ **před** zostřením (základní výstup modelu) → pravděpodobnosti níž jdou přepočítat. */
  lambdaHome: number;
  lambdaAway: number;
  homeWin: number;
  draw: number;
  awayWin: number;
  bttsYes: number;
  over25: number;
  lowConfidence: boolean;
  /** Efektivní vzorek nejslabšího vstupu λ (připravenost predikce); 0 = neznámo/starý řádek. */
  readinessSample: number;
  /** Verze modelu, který spočítal λ (okna/váhy/xG/build týmů). Bump = reset datasetu. */
  modelVersion: number;
  /**
   * Post-parametry, kterými byly z λ odvozeny pravděpodobnosti výše (Dixon–Coles ρ a
   * zostření λ). Mimo `modelVersion` schválně: jde je změnit a historii **přepočítat**
   * z uložených λ (`npm run reprice`) místo zahození. `null` = řádek z doby před
   * zavedením polí (spočítaný publikovaným defaultem ρ=−0.13, zostření 1.0).
   */
  rho: number | null;
  sharpen: number | null;
  status: string; // "NS" | "FT" | "AET" | "PEN" | …
  homeGoals: number | null;
  awayGoals: number | null;
  // Interní benchmark: predikce API-Footballu (1X2) pro tentýž zápas. Mimo FREE/PRO API.
  benchAvailable: boolean;
  benchHomeWin: number | null;
  benchDraw: number | null;
  benchAwayWin: number | null;
  // Referenční kurzy sázkovky (decimal odds) pro EV/value tipy; null = nedotaženo.
  oddsBookmaker: string | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  oddsOver25: number | null;
  oddsBtts: number | null;
}

/** Trh, na který pravidlo cílí. */
export type PickMarket = "win" | "over25" | "btts";

/** Pravidlo výběru zápasů do predikční záložky. */
export interface PickRule {
  market: PickMarket;
  /** Jen pro market "win": strana favorita. */
  venue: "home" | "away" | "any";
  /** Minimální pravděpodobnost (0–1). */
  minProb: number;
  /**
   * Volitelný minimální edge (EV) = p_model × kurz − 1. Když je nastaven, tip projde
   * jen se známým kurzem a dostatečnou hranou nad trhem (value betting). Bez něj se
   * kurzy ignorují → chování jako dnes (čistě pravděpodobnostní práh `minProb`).
   */
  minEdge?: number;
  /**
   * Volitelný minimální efektivní vzorek za predikcí (`readinessSample`). Když je
   * nastaven, tip projde jen s dost daty (gate „nevydat tip pod N zápasů" na startu
   * sezóny). Bez něj se připravenost nehlídá.
   */
  minReadiness?: number;
}

/** Jeden vybraný tip = nadcházející zápas, který splnil pravidlo. */
export interface MatchPick {
  fixtureId: number;
  kickoff: string;
  leagueId: number;
  home: { id: number; name: string; logoUrl: string };
  away: { id: number; name: string; logoUrl: string };
  prediction: MatchPrediction;
  market: PickMarket;
  /** Pro "win" strana favorita, jinak null. */
  side: "home" | "away" | null;
  /** Pravděpodobnost relevantní pro pravidlo (0–1). */
  prob: number;
  /**
   * Hodnotová analýza tipu vůči kurzu sázkovky (kurz, implikovaná pravděpodobnost,
   * edge = prob×kurz−1). `null`, když kurz nebyl dotažen. Tvar odpovídá `ValueEstimate`
   * (`lib/picks/value.ts`) – zde inline, aby `types.ts` nezáviselo na `value.ts`.
   */
  value: { odds: number; impliedProb: number; edge: number } | null;
  /** Krátké vysvětlení (z uložených hodnot). */
  explanation: string;
  /** Mód cílového Porovnání (klub vs. reprezentace) – pro deep-link prokliku. */
  compareMode: EntityType;
  /**
   * „Liga" pro deep-link: klub → `leagueId` u obou; reprezentační turnaj →
   * konfederace každého týmu (dotahuje `/api/picks`; `null` = neklikací řádek).
   */
  homeCompareLeagueId: number | null;
  awayCompareLeagueId: number | null;
  /** Pozice v ligové tabulce (FREE kontext; jen klubové tipy, doplněno server-side). */
  homeRank?: number | null;
  awayRank?: number | null;
}

/**
 * Dohraný zápas s vyhodnocenou predikcí pro záložku „Výsledky" (jak dopadly naše
 * predikce). Odvozeno z odehraných `PredictionRow` (status FINISHED, známé skóre).
 * Deep-link pole jako u `MatchPick` (klik = porovnání týmů).
 */
export interface SettledMatch {
  fixtureId: number;
  leagueId: number;
  leagueLogoUrl: string;
  kickoff: string;
  home: { id: number; name: string; logoUrl: string };
  away: { id: number; name: string; logoUrl: string };
  /** Skóre po 90 minutách (co predikuje model) – u AET/PEN tedy NE koncové skóre. */
  homeGoals: number;
  awayGoals: number;
  /** Zápas se rozhodl až v prodloužení/na penalty → skóre výše je stav po 90 min. */
  afterExtraTime: boolean;
  /** Predikovaný výsledek 1X2 (argmax) a jeho pravděpodobnost. */
  predictedSide: "home" | "draw" | "away";
  predictedProb: number;
  /** Trefila predikce 1X2 skutečný výsledek? */
  outcomeHit: boolean;
  compareMode: EntityType;
  homeCompareLeagueId: number | null;
  awayCompareLeagueId: number | null;
}

export type CategoryKey =
  | "attack"
  | "defense"
  | "ball_control"
  | "chance_creation"
  | "discipline";

export interface CategoryScore {
  key: CategoryKey;
  label: string;
  homeScore: number;
  awayScore: number;
  lowConfidence: boolean;
  available: boolean;
}

export interface PlayStyleDimension {
  key: "possession" | "buildup" | "pressing" | "efficiency";
  label: string;
  leftLabel: string;
  rightLabel: string;
  homeScore: number;
  awayScore: number;
  available: boolean;
}

export interface LeagueGoalsAvg {
  goalsFor: number;
  goalsAgainst: number;
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
