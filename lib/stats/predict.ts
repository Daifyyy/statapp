import type {
  MatchPrediction,
  Metric,
  MetricValue,
  ScoreProbability,
  Venue,
} from "@/lib/types";
import { lowConfidenceOf, sampleOrTotal, valueOf } from "./metricLookup";
import { computeReadiness } from "./readiness";

const MAX_GOALS = 10; // mřížka Poissonu (0..10 pro každý tým)
const MIN_LAMBDA = 0.2;
const MAX_LAMBDA = 5;
const TOP_SCORES = 5; // kolik nejpravděpodobnějších přesných skóre vydat

/**
 * Ligové měřítko, vůči kterému se normalizují síly týmů: **kolik gólů v této lize dá
 * průměrný domácí / hostující tým za zápas**. Drží obojí, protože domácí výhoda sedí právě
 * v rozdílu těch dvou čísel – λ ji tak nemusí přidávat zvlášť (a nezdvojí ji).
 */
export interface LeagueBaseline {
  home: number;
  away: number;
}

/**
 * Fallback, když ligový průměr neznáme (typický top-5: ⌀ 1.5 gólu domácí, 1.2 hosté).
 * Reálnou hodnotu předává volající – v produkci z už cachované tabulky (`computeLeagueGoalsAvg`,
 * 0 API navíc), v `npm run backtest` spočítaná z předchozí sezóny.
 */
export const DEFAULT_BASELINE: LeagueBaseline = { home: 1.5, away: 1.2 };

/**
 * Ladicí parametry odhadu λ (fitují se `npm run backtest`, ne od stolu).
 *
 * - `shrinkMatches` – kolik „zápasů ligového průměru" se přimíchá do každého vstupu.
 *   Vyšší = opatrnější model (víc liga, míň krátká série).
 * - `strength` – exponent síly: `λ = ref × (útok/ref)^s × (obrana/ref)^s`. `s = 1` bere
 *   poměry naplno, `s < 1` je stahuje k lize **na log škále**. Je to nutná pojistka: naše
 *   „síla útoku" není opponent-adjusted (kdo hrál se dnem tabulky, vypadá silně) a součin
 *   dvou zašuměných poměrů násobí i jejich chyby → bez útlumu model vyrábí extrémní λ,
 *   která realita neustojí. `s = 0` = všichni průměrní.
 * - `totalSpread` – stlačení **součtu** λ (= očekávaných gólů zápasu) k ligovému průměru
 *   se zachováním rozdílu: `S' = ref + (S − ref) × t`. Backtest ukázal, že rozdíl λ (kdo je
 *   lepší → 1X2) je kalibrovaný, ale součet (kolik padne gólů → Over 2.5, BTTS) má **moc
 *   velký rozptyl**: model řekl 26 % na Přes 2.5 a padlo to ve 44 %, řekl 83 % a padlo 72 %.
 *   Chyby útoku a obrany se v rozdílu ruší, v součtu sčítají – proto potřebuje součet vlastní
 *   útlum. `t = 1` = beze změny. Je to přesný protějšek `sharpenLambdas` (ta škáluje rozdíl
 *   a drží součet); tahle škáluje součet a drží rozdíl → **1X2 se skoro nedotkne**.
 */
export interface PredictTuning {
  shrinkMatches: number;
  strength: number;
  totalSpread: number;
}

export const DEFAULT_TUNING: PredictTuning = {
  shrinkMatches: 6,
  strength: 1,
  // 0.5 = rozptyl očekávaných gólů půlíme. Grid v `npm run backtest`: ECE u Přes 2.5
  // 0.054 → 0.014, log-loss 0.6919 → 0.6817, 1X2 beze změny (1.0127 → 1.0125).
  totalSpread: 0.5,
};

/** Volby predikce: ligové měřítko + ladicí parametry λ (obojí volitelné). */
export interface PredictOptions {
  baseline?: LeagueBaseline;
  tuning?: PredictTuning;
}

/**
 * Vstup predikce = jen spočítané hodnoty metrik. Záměrně NE celý `TeamComparison`:
 * λ se počítá z **vlastních** hodnot (jiné vážení oken, `PREDICTION_WINDOW_WEIGHTS`)
 * než jaké jdou do UI – viz `compareTeams`.
 */
export interface PredictInput {
  values: MetricValue[];
}

/**
 * Dixon–Coles parametr závislosti ρ. Nezávislý Poisson podhodnocuje nízkoskórové
 * remízy (0:0, 1:1), protože ignoruje korelaci gólů obou týmů. ρ < 0 ji opravuje
 * (víc remíz 0:0/1:1, míň těsných výher 1:0/0:1); ρ = 0 = čistý Poisson.
 * −0.13 je publikovaný odhad pro fotbal (Dixon & Coles 1997) – dolaď backtestem.
 */
const DC_RHO = -0.03;

/**
 * Zostření rozdílu λ (oprava „podsebevědomosti na favoritech"). Reliability ukazuje, že
 * 1X2 pravděpodobnosti jsou málo rozprostřené (tlačí ke středu) – rozdíl λ favorita
 * a outsidera je moc malý. `s > 1` zostří **jen rozdíl** D = λ_home − λ_away, zatímco
 * **součet** S = λ_home + λ_away (= celkové góly) drží → narovná 1X2, ale Over 2.5 nechá být
 * a celá mřížka zůstane konzistentní. `s = 1` je přesný no-op (zatím nekalibrováno; až bude
 * ~150–300 settlnutých, fitni přes `npm run calibrate`). Viz `sharpenLambdas`.
 */
const LAMBDA_SHARPEN = 1.0;

/**
 * **Zkoušeno a zamítnuto: bivariační Poisson (společný šok λ₃).** Nezávislý Poisson
 * předpokládá, že góly obou týmů spolu nesouvisí; λ₃ přidává kladnou korelaci a měl
 * narovnat „oba skórují". Backtest (3 511 zápasů): BTTS log-loss 0.6920 → 0.6915 (šum),
 * a 1X2 se přitom zhoršilo (1.0125 → 1.0140). **BTTS nemá v našem modelu signál vůbec** –
 * i po opravě kalibrace je horší než konstanta „54.7 % vždy" (0.6920 vs 0.6888), a ρ s tím
 * taky nehne (ρ sahá jen na čtyři nejnižší skóre). Není to problém tvaru rozdělení, ale
 * toho, že z gólových průměrů se „kdo dá aspoň jeden" prostě dobře předpovídat nedá.
 * Nezkoušej to znovu bez nového vstupu (xG, střely na branku, sestavy).
 */

/**
 * **Post-processingové parametry mřížky** – aplikují se až NA λ, samotné λ negenerují.
 *
 * Proto **nepatří pod `MODEL_VERSION`**: uložený řádek predikce nese základní λ, takže
 * změna ρ/zostření se dá na historii přepočítat čistou matematikou bez jediného API volání
 * (`npm run reprice`) – žádný reset datasetu. `MODEL_VERSION` (`lib/data/predictions.ts`)
 * verzuje jen to, co λ *vyrábí* (okna, váhy, xG zpevnění, build týmů) – tam přepočet nestačí,
 * protože bys musel znovu stáhnout a přepočítat vstupy.
 *
 * Uloženo per řádek (`PredictionRow.rho`/`.sharpen`) → víme, čím byly uložené
 * pravděpodobnosti spočítané, a co je vůči aktuálním konstantám zastaralé.
 */
export interface PredictParams {
  rho: number;
  sharpen: number;
}

export const PREDICT_PARAMS: PredictParams = {
  rho: DC_RHO,
  sharpen: LAMBDA_SHARPEN,
};

/** Pravděpodobnosti odvozené z jedné mřížky skóre (vzájemně konzistentní). */
export interface GridProbs {
  /** λ po zostření – souhlasí s mřížkou (při `sharpen = 1` shodné se základními). */
  lambdaHome: number;
  lambdaAway: number;
  homeWin: number;
  draw: number;
  awayWin: number;
  bttsYes: number;
  over25: number;
  topScores: ScoreProbability[];
}

/**
 * Jádro predikce: ze **základních** λ (před zostřením) postaví Poissonovu mřížku s
 * Dixon–Coles korekcí a vydá z ní všechny agregáty. Čistá funkce parametrizovaná
 * `PredictParams` → tutéž mřížku umí přepočítat `predictMatch` (živě) i `reprice`
 * (nad uloženými λ po změně konstant).
 */
export function gridProbs(
  baseHome: number,
  baseAway: number,
  params: PredictParams = PREDICT_PARAMS
): GridProbs {
  const [lh, la] = sharpenLambdas(baseHome, baseAway, params.sharpen);
  const ph = poissonVector(lh);
  const pa = poissonVector(la);

  // Jediná smyčka přes mřížku skóre: na nízká skóre se aplikuje Dixon–Coles korekce
  // a všechny agregáty (V/R/P, Over 2.5, BTTS) se počítají z téže opravené mřížky.
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over25 = 0;
  let bttsYes = 0;
  let total = 0;
  const scores: ScoreProbability[] = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j] * drawTau(i, j, lh, la, params.rho);
      total += p;
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (i + j >= 3) over25 += p;
      if (i >= 1 && j >= 1) bttsYes += p;
      scores.push({ home: i, away: j, prob: p });
    }
  }
  // Re-normalizace (uťatá mřížka + korekce nezachová přesně 1).
  const norm = total || 1;
  const topScores = scores
    .sort((a, b) => b.prob - a.prob)
    .slice(0, TOP_SCORES)
    .map((s) => ({ home: s.home, away: s.away, prob: s.prob / norm }));

  return {
    lambdaHome: lh,
    lambdaAway: la,
    homeWin: homeWin / norm,
    draw: draw / norm,
    awayWin: awayWin / norm,
    bttsYes: bttsYes / norm,
    over25: over25 / norm,
    topScores,
  };
}

/**
 * Zostří nerovnováhu očekávaných gólů parametrem `s` se zachováním součtu (celkových
 * gólů). `s = 1` vrací λ beze změny (no-op). Výsledek je clampnutý na [MIN, MAX].
 * Exportováno pro `calibrate.ts` (grid search) a testy.
 */
export function sharpenLambdas(
  lambdaHome: number,
  lambdaAway: number,
  s: number = LAMBDA_SHARPEN
): [number, number] {
  if (s === 1) return [lambdaHome, lambdaAway];
  const sum = lambdaHome + lambdaAway;
  const diff = (lambdaHome - lambdaAway) * s;
  return [
    clamp((sum + diff) / 2, MIN_LAMBDA, MAX_LAMBDA),
    clamp((sum - diff) / 2, MIN_LAMBDA, MAX_LAMBDA),
  ];
}

/**
 * Stlačí **součet** λ k ligovému průměru (`S' = ref + (S − ref) × t`) a **drží rozdíl**
 * λ. Přesný protějšek `sharpenLambdas`. `t = 1` = no-op. Exportováno pro testy a grid
 * v `npm run backtest`.
 */
export function dampenTotal(
  lambdaHome: number,
  lambdaAway: number,
  baseline: LeagueBaseline,
  t: number
): [number, number] {
  if (t === 1) return [lambdaHome, lambdaAway];
  const ref = baseline.home + baseline.away;
  const sum = ref + (lambdaHome + lambdaAway - ref) * t;
  const diff = lambdaHome - lambdaAway;
  return [
    clamp((sum + diff) / 2, MIN_LAMBDA, MAX_LAMBDA),
    clamp((sum - diff) / 2, MIN_LAMBDA, MAX_LAMBDA),
  ];
}

/**
 * Predikce zápasu z očekávaných gólů obou týmů (Poisson s Dixon–Coles korekcí
 * nízkých skóre). Domácí útok × hostující obrana (a naopak), venue-specific
 * s fallbackem na TOTAL. Vše z výstupu `compareTeams` – žádná nová data, čistá funkce.
 */
export function predictMatch(
  home: PredictInput,
  away: PredictInput,
  opts: PredictOptions = {}
): MatchPrediction {
  const baseline = opts.baseline ?? DEFAULT_BASELINE;
  const tuning = opts.tuning ?? DEFAULT_TUNING;
  const rawHome = expectedGoals(home, away, true, baseline, tuning);
  const rawAway = expectedGoals(away, home, false, baseline, tuning);
  const readiness = computeReadiness(home, away);

  // Útlum rozptylu SOUČTU λ (kolik gólů zápas nabídne) k ligovému průměru; rozdíl λ
  // (kdo je lepší) zůstává → 1X2 beze změny, opraví se jen Over 2.5 / BTTS.
  const [lambdaHome, lambdaAway] =
    rawHome != null && rawAway != null
      ? dampenTotal(rawHome, rawAway, baseline, tuning.totalSpread)
      : [rawHome, rawAway];

  // Bez gólových i xG dat na některé straně nelze predikovat – nevydávej
  // falešnou 50/50, ale označ predikci jako nedostupnou (UI ji nahradí hláškou).
  if (lambdaHome == null || lambdaAway == null) {
    return {
      available: false,
      lambdaHome: lambdaHome ?? 0,
      lambdaAway: lambdaAway ?? 0,
      lambdaHomeBase: lambdaHome ?? 0,
      lambdaAwayBase: lambdaAway ?? 0,
      homeWin: 0,
      draw: 0,
      awayWin: 0,
      bttsYes: 0,
      over25: 0,
      topScores: [],
      lowConfidence: true,
      readiness,
    };
  }

  const g = gridProbs(lambdaHome, lambdaAway);

  const lowConfidence =
    lowConfidenceOf(home.values, "GOALS_FOR", "HOME") ||
    lowConfidenceOf(away.values, "GOALS_FOR", "AWAY");

  return {
    available: true,
    // Zobrazovaná λ jsou zostřená (souhlasí s mřížkou), ukládají se ale `*Base` –
    // z nich jde predikci přepočítat při změně ρ/zostření (viz `PredictParams`).
    lambdaHome: g.lambdaHome,
    lambdaAway: g.lambdaAway,
    lambdaHomeBase: lambdaHome,
    lambdaAwayBase: lambdaAway,
    homeWin: g.homeWin,
    draw: g.draw,
    awayWin: g.awayWin,
    bttsYes: g.bttsYes,
    over25: g.over25,
    topScores: g.topScores,
    lowConfidence,
    readiness,
  };
}

/**
 * Očekávané góly týmu **multiplikativně vůči ligovému měřítku** (Maher / Dixon–Coles):
 *
 *     λ = ref × (útok týmu / ref) × (obdržené soupeře / ref)
 *
 * kde `ref` je ligový průměr **té samé veličiny** (góly domácích, resp. hostů). Pro průměrný
 * pár týmů vyjde λ = ref, což je přesně, co má.
 *
 * **Proč ne prostý průměr útoku a obrany** (což dělala 1. verze): aritmetický průměr nikdy
 * nepřekročí krajní hodnoty, takže dvojici „silný útok vs děravá obrana" systematicky
 * podstřelí a „silný útok vs elitní obrana" nadstřelí → λ stlačená ke středu. Součin tuhle
 * interakci vyjádřit umí.
 *
 * **Shrinkage** (`SHRINK_MATCHES`): syrový průměr z pěti zápasů je z velké části šum – LAST5
 * nese 55 % váhy okna, takže krátká série vystřelí λ. Každý vstup se proto stáhne k ligovému
 * průměru úměrně velikosti vzorku: `(n·hodnota + k·ref) / (n + k)`. Malý vzorek → skoro liga,
 * velký vzorek → skoro vlastní čísla. Tím zmizí přesebevědomé extrémy (backtest je ukázal
 * na favoritech: predikce 64 % → realita 57 %).
 */
function expectedGoals(
  team: PredictInput,
  opponent: PredictInput,
  isHome: boolean,
  baseline: LeagueBaseline,
  tuning: PredictTuning
): number | null {
  const attackVenue = isHome ? "HOME" : "AWAY";
  const defenseVenue = isHome ? "AWAY" : "HOME";

  // Referenční hladina: góly, které v této lize dává strana v daném prostředí. Útok domácích
  // i obrana hostů se poměřují TÝMŽ číslem (co jedni dají, druzí dostanou) → λ nezdvojí
  // domácí výhodu. Chybí-li venue rozpad (neutrální reprezentace → fallback na TOTAL),
  // referencí je celkový průměr na tým a zápas.
  const venueRef = isHome ? baseline.home : baseline.away;
  const totalRef = (baseline.home + baseline.away) / 2;
  const ratio = (metric: Metric, values: MetricValue[], venue: Venue) =>
    strengthRatio(values, metric, venue, venueRef, totalRef, tuning);

  // λ = referenční hladina × síla útoku × slabost obrany soupeře (obojí jako poměr k lize).
  const attack = ratio("GOALS_FOR", team.values, attackVenue);
  const xg = ratio("XG", team.values, attackVenue); // xG jako druhý odhad útoku (zpevnění)
  const defense = ratio("GOALS_AGAINST", opponent.values, defenseVenue);

  // Nevíme nic ani o útoku, ani o obraně soupeře → predikci nevydáme (UI: „nedostatek dat").
  // Chybí-li jen jedna strana, bere se za ni ligový průměr (poměr 1) – lepší než nic.
  const attackSide = attack ?? xg;
  if (attackSide == null && defense == null) return null;

  // Referenční hladina musí odpovídat tomu, ODKUD data přišla: venue rozpad → měřítko
  // domácích/hostů (nese domácí výhodu), fallback na TOTAL → celkový průměr. Jinak by
  // venue-neutrální reprezentační zápas (jen TOTAL) dostal domácí výhodu, kterou nemá,
  // a prohození týmů by nedalo zrcadlovou predikci.
  const ref = attackSide?.ref ?? defense!.ref;
  const attackRatio =
    attack != null && xg != null
      ? (attack.ratio + xg.ratio) / 2
      : (attackSide?.ratio ?? 1);

  return clamp(ref * attackRatio * (defense?.ratio ?? 1), MIN_LAMBDA, MAX_LAMBDA);
}

/**
 * Síla týmu v metrice jako **poměr k ligovému průměru** (1.0 = průměrný tým), se dvěma
 * pojistkami proti šumu: shrinkage podle velikosti vzorku (malý vzorek → skoro liga)
 * a exponent `strength` (stáhne poměr k 1 na log škále).
 *
 * Vrací i `ref`, vůči kterému se poměřovalo: venue varianta → venue průměr, fallback na
 * TOTAL → celkový průměr. Volající z něj skládá λ, takže neutrální reprezentace zůstanou
 * bez domácí výhody.
 */
function strengthRatio(
  values: MetricValue[],
  metric: Metric,
  venue: Venue,
  venueRef: number,
  totalRef: number,
  tuning: PredictTuning
): { ratio: number; ref: number } | null {
  const atVenue = valueOf(values, metric, venue);
  const ref = atVenue != null ? venueRef : totalRef;
  const raw = atVenue ?? valueOf(values, metric, "TOTAL");
  if (raw == null || ref <= 0) return null;

  const n = sampleOrTotal(values, metric, venue);
  const k = tuning.shrinkMatches;
  const shrunk = (n * raw + k * ref) / (n + k);
  return { ratio: Math.pow(shrunk / ref, tuning.strength), ref };
}

/**
 * Dixon–Coles korekční faktor τ pro čtyři nejnižší skóre (jinde vrací 1).
 * ρ < 0 zvýší 0:0 a 1:1 a o totéž sníží 1:0 a 0:1. Výsledek je clampnutý na ≥ 0
 * jako pojistka proti záporné pravděpodobnosti při extrémních λ. Exportováno pro testy.
 */
export function drawTau(
  i: number,
  j: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number = DC_RHO
): number {
  let t = 1;
  if (i === 0 && j === 0) t = 1 - lambdaHome * lambdaAway * rho;
  else if (i === 0 && j === 1) t = 1 + lambdaHome * rho;
  else if (i === 1 && j === 0) t = 1 + lambdaAway * rho;
  else if (i === 1 && j === 1) t = 1 - rho;
  return t < 0 ? 0 : t;
}

/** Vektor Poissonových pravděpodobností p(k) pro k = 0..MAX_GOALS. Exportováno pro testy. */
export function poissonVector(lambda: number): number[] {
  const out = new Array<number>(MAX_GOALS + 1);
  let p = Math.exp(-lambda); // p(0)
  out[0] = p;
  for (let k = 1; k <= MAX_GOALS; k++) {
    p = (p * lambda) / k; // p(k) = p(k-1) * λ / k
    out[k] = p;
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
