import type { MatchStat, Metric, MetricValue } from "@/lib/types";
import { computeAllValues } from "@/lib/stats/aggregate";
import { PREDICTION_WINDOW_WEIGHTS } from "@/lib/stats/weights";
import {
  DEFAULT_TUNING,
  strengthRatio,
  type LeagueBaseline,
  type PredictTuning,
} from "@/lib/stats/predict";
import type { HistoryMatch } from "./backtest";
import { matchStatsBefore } from "./backtest";

/**
 * **Model rohů** – jediný kandidát na hranu, který jsme zatím nezměřili.
 *
 * Proč zrovna rohy: gólové trhy (1X2, Over 2.5, BTTS) jsme proti zavírací linii změřili
 * a hranu tam nemáme (ROI −5 až −11 %, a přísnější práh to zhoršuje). Rohy jsou ale
 * **jiná veličina se stejnou strukturou**: měříme je (`CORNERS` v `ALL_METRICS`, venue
 * splity, okna), trh je nabízí (9 z 13 knih včetně Pinnacle, marže 5–9 % = širší než
 * u 1X2) a hlavně – **skutečné počty rohů máme zdarma a offline** (football-data.co.uk,
 * sloupce `HC`/`AC`, viz `oddsDataset.ts`). Kalibraci tedy jde ověřit na 12 000 zápasech
 * dřív, než se řeší kurzy.
 *
 * **Konstrukce je záměrně TÁŽ jako u gólů** (`expectedGoals` v `predict.ts`), jen nad
 * jinou metrikou: `λ = ref × (rohy týmu / ref) × (rohy inkasované soupeřem / ref)`, kde
 * `ref` = kolik rohů v této lize zahrává průměrný domácí, resp. hostující tým. Sdílí
 * `strengthRatio` (shrinkage podle vzorku + exponent `strength`), okna i váhy
 * `PREDICTION_WINDOW_WEIGHTS`. Není to druhá implementace – je to tatáž matematika nad
 * `CORNERS`/`CORNERS_AGAINST`.
 *
 * **Pořadí prací (viz CLAUDE.md): nejdřív kalibrace proti skutečným rohům, teprve pak
 * kurzy.** Když λ rohů nesedí, jsou kurzy ztráta času – a tohle se změří offline za minuty.
 *
 * Modul je **čistý** a **mimo produkční cestu**: `compareTeams` se nemění, nic se neukládá,
 * žádné API volání. Zapojení do predikční pipeline má smysl teprve, až měření vyjde.
 */

/** Metriky, které model rohů potřebuje spočítat (protějšek `PREDICTION_METRICS`). */
export const CORNER_METRICS = ["CORNERS", "CORNERS_AGAINST"] as const satisfies readonly Metric[];

/**
 * Meze λ rohů. Rohy jsou o řád početnější než góly, takže `MIN_LAMBDA`/`MAX_LAMBDA`
 * z `predict.ts` (0.2/5) by tady ořezávaly normální hodnoty – proto vlastní.
 */
const MIN_LAMBDA = 1;
const MAX_LAMBDA = 15;

/**
 * Ligové měřítko rohů: kolik jich zahraje průměrný domácí / hostující tým za zápas.
 * Přesný protějšek `LeagueBaseline` u gólů (typicky ~5.5 doma / ~4.5 venku).
 */
export type CornerBaseline = LeagueBaseline;

/** Fallback, když ligový průměr neznáme (⌀ top ligy: 5.5 domácí, 4.5 hosté). */
export const DEFAULT_CORNER_BASELINE: CornerBaseline = { home: 5.5, away: 4.5 };

/** Predikce rohů jednoho zápasu. */
export interface CornerPrediction {
  available: boolean;
  lambdaHome: number;
  lambdaAway: number;
  /** Očekávané rohy celkem (= λ_home + λ_away) – veličina, na kterou se sází. */
  lambdaTotal: number;
}

/**
 * Očekávané rohy jedné strany, multiplikativně vůči ligovému měřítku – stejná konstrukce
 * jako `expectedGoals`, viz komentář v hlavičce modulu.
 *
 * Útok se poměřuje `CORNERS` týmu, obrana `CORNERS_AGAINST` soupeře, obojí **týmž `ref`**
 * (co jedni zahrají, druzí inkasují) → λ nezdvojí domácí výhodu. Chybí-li jedna strana,
 * bere se za ni ligový průměr; chybí-li obě, vrací `null`.
 */
export function expectedCorners(
  team: MetricValue[],
  opponent: MetricValue[],
  isHome: boolean,
  baseline: CornerBaseline,
  tuning: PredictTuning = DEFAULT_TUNING
): number | null {
  const attackVenue = isHome ? "HOME" : "AWAY";
  const defenseVenue = isHome ? "AWAY" : "HOME";
  const venueRef = isHome ? baseline.home : baseline.away;
  const totalRef = (baseline.home + baseline.away) / 2;

  const attack = strengthRatio(team, "CORNERS", attackVenue, venueRef, totalRef, tuning);
  const defense = strengthRatio(
    opponent,
    "CORNERS_AGAINST",
    defenseVenue,
    venueRef,
    totalRef,
    tuning
  );
  if (attack == null && defense == null) return null;

  const ref = attack?.ref ?? defense!.ref;
  return clamp(ref * (attack?.ratio ?? 1) * (defense?.ratio ?? 1), MIN_LAMBDA, MAX_LAMBDA);
}

/**
 * Stlačí **součet** λ k ligovému průměru se zachováním rozdílu – protějšek `dampenTotal`
 * u gólů, jen s mezemi pro rohy (nejde ho tedy jen importovat, ořezal by na λ ≤ 5).
 *
 * Smysl je stejný: na trh Over/Under se sází **součet**, a v součtu se chyby útoku
 * a obrany sčítají (v rozdílu se ruší) → sám o sobě má větší rozptyl, než odpovídá
 * realitě. `t = 1` = no-op; hodnotu fituj `npm run backtest -- --corners-grid`.
 */
export function dampenCornerTotal(
  lambdaHome: number,
  lambdaAway: number,
  baseline: CornerBaseline,
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

/** Ladicí parametry modelu rohů (protějšek `PredictTuning`, ale jen to, co rohy potřebují). */
export interface CornerTuning {
  /** Shrinkage a exponent síly – sdílené s gólovým modelem přes `strengthRatio`. */
  base: PredictTuning;
  /** Útlum rozptylu součtu λ (viz `dampenCornerTotal`). `1` = vypnuto. */
  totalSpread: number;
  /**
   * Podmíněná overdisperze pro negativně binomické rozdělení (`Var = μ × v`).
   * `1` = přesný Poisson. Fituje se `--corners-grid-nb`, ne dosazením naměřeného
   * poměru – viz `overProbNegBin` a `pearsonDispersion`.
   */
  varianceRatio: number;
}

/**
 * **Fitnuto `npm run backtest -- --corners-grid`** (8 030 zápasů, 16 lig), ověřeno
 * hold-outem: grid na sezóně 2024, měření na 2025.
 *
 * `totalSpread = 0.3` je mnohem agresivnější útlum než u gólů (0.5) a je to tak správně:
 * bez něj byl model na rozích **horší než konstanta** na všech liniích (ECE 0.05–0.06,
 * predikce 17 % → realita 30 %, predikce 73 % → realita 59 %). Součet λ rohů měl prostě
 * mnohem větší rozptyl než realita. Po útlumu ECE spadlo na 0.014–0.021 a model konstantu
 * **poráží na všech liniích** (hold-out 2025: +0.0032 až +0.0076 log-lossu).
 *
 * Optimum je **vnitřní**, ne na hranici gridu – proto je to fit, ne přefitování. Grid jde
 * schválně až do degenerace (`t = 0` = „predikuj vždy ligový průměr"): ta dá 0.6665, tedy
 * **hůř** než 0.6640 v optimu. To je důkaz, že týmový signál v rohách existuje – ale je
 * malý: z celkových 0.0065 nad globální konstantou dělá **0.0040 samotná znalost ligy**
 * a jen **0.0025 informace o týmech**.
 *
 * `varianceRatio = 1.2` = **negativně binomické rozdělení** místo Poissonu, fitnuto
 * `--corners-grid-nb` (2D grid společně s `totalSpread` – obojí hýbe šířkou výsledné
 * pravděpodobnosti, takže fitovat je zvlášť by dalo falešné optimum). Sedí k naměřené
 * **podmíněné** disperzi (Pearson **1.137**, `pearsonDispersion`; marginální 1.169 je
 * nadhodnocená o rozptyl λ mezi zápasy). Hold-out 2025 (grid běžel na 2024) – NB porazilo
 * Poisson na **všech pěti liniích**, a přesně tam, kde mělo, tedy v **chvostech**:
 *
 *   linie   log-loss nad konstantou    ECE
 *   8.5     +0.0076 → +0.0082          0.0206 → 0.0228   (jediné zhoršení)
 *   9.5     +0.0066 → +0.0068          0.0154 → 0.0118
 *   10.5    +0.0074 → +0.0076          0.0154 → 0.0129
 *   11.5    +0.0059 → +0.0063          0.0138 → 0.0059
 *   12.5    +0.0032 → +0.0042          0.0215 → 0.0046   (4.7× lepší)
 *
 * Na skillu je to málo (+0.0024 součtem přes linie), na **kalibraci krajních linií hodně** –
 * a krajní linie jsou u rohů právě to, co trh nabízí nejšířeji (10.25 vs 10.5 vs 11.5).
 */
export const DEFAULT_CORNER_TUNING: CornerTuning = {
  base: DEFAULT_TUNING,
  totalSpread: 0.3,
  varianceRatio: 1.2,
};

/** Predikce rohů z už spočítaných hodnot metrik obou týmů. Čistá funkce. */
export function predictCorners(
  home: MetricValue[],
  away: MetricValue[],
  baseline: CornerBaseline = DEFAULT_CORNER_BASELINE,
  tuning: CornerTuning = DEFAULT_CORNER_TUNING
): CornerPrediction {
  const rawHome = expectedCorners(home, away, true, baseline, tuning.base);
  const rawAway = expectedCorners(away, home, false, baseline, tuning.base);
  if (rawHome == null || rawAway == null) {
    return { available: false, lambdaHome: 0, lambdaAway: 0, lambdaTotal: 0 };
  }
  const [lambdaHome, lambdaAway] = dampenCornerTotal(
    rawHome,
    rawAway,
    baseline,
    tuning.totalSpread
  );
  return {
    available: true,
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaHome + lambdaAway,
  };
}

/**
 * `P(celkem rohů > line)` pro půlkovou linii (8.5, 9.5, …).
 *
 * Součet dvou nezávislých Poissonů je Poisson s λ = λ₁ + λ₂, takže se počítá **přímo
 * z celkové λ** – žádná mřížka 2D není potřeba (u gólů je kvůli 1X2 a Dixon–Coles korekci,
 * tady se sází jen na součet). Nezávislost je předpoklad, který měření prověří: rohy bývají
 * **overdisperzní** (rozptyl > průměr), a to by Poisson podstřelil právě v chvostech.
 */
export function overProb(lambdaTotal: number, line: number): number {
  const need = Math.floor(line) + 1; // 9.5 → potřeba ≥ 10
  let p = Math.exp(-lambdaTotal);
  let cdf = p; // P(0)
  for (let k = 1; k < need; k++) {
    p = (p * lambdaTotal) / k;
    cdf += p;
  }
  return clamp(1 - cdf, 1e-6, 1 - 1e-6);
}

/**
 * Totéž **negativně binomickým rozdělením** – Poisson s „rozmazaným" λ (Poisson–Gamma směs).
 *
 * Proč: Poisson tvrdí `rozptyl = průměr`, ale u rohů je poměr **1.17** (změřeno, stabilní
 * napříč sezónami). Zápas s očekávanými 10 rohy jich reálně dá 4 i 18 častěji, než Poisson
 * připouští → **podstřelené chvosty**, a to jsou přesně krajní linie (8.5, 12.5), kde je
 * u sázení nejvíc prostoru. NB tuhle extra variabilitu má přímo v parametrizaci.
 *
 * `varianceRatio` (v) = kolikrát je rozptyl větší než průměr; `v ≤ 1` vrací **přesně** Poisson
 * (no-op, žádná ztráta přesnosti). Vnitřně `Var = μ + μ²/r` → velikost `r = μ/(v−1)`, takže
 * `Var = μ·v`. Počítá se rekurentně (`P(k) = P(k−1) × (k−1+r)/k × q`) → žádné gamma funkce
 * a žádná ztráta přesnosti pro velká `r`.
 *
 * Pozor na interpretaci: `v` tu je **podmíněná** overdisperze (rozptyl kolem λ *jednoho*
 * zápasu), ne ta, co vyleze z `dispersion()` přes celý dataset – v té je navíc rozptyl
 * λ mezi zápasy. Proto se fituje gridem, ne dosazením naměřeného čísla (viz `pearsonDispersion`).
 */
export function overProbNegBin(
  mu: number,
  line: number,
  varianceRatio: number
): number {
  if (varianceRatio <= 1) return overProb(mu, line);
  const r = mu / (varianceRatio - 1); // Var = μ + μ²/r = μ·v
  const q = mu / (r + mu);
  const need = Math.floor(line) + 1;
  let term = Math.pow(r / (r + mu), r); // P(0)
  let cdf = term;
  for (let k = 1; k < need; k++) {
    term = (term * (k - 1 + r) * q) / k;
    cdf += term;
  }
  return clamp(1 - cdf, 1e-6, 1 - 1e-6);
}

/** Řádek backtestu rohů: predikce + skutečnost (protějšek `PredictionRow`). */
export interface CornerRow {
  fixtureId: number;
  leagueId: number;
  season: number;
  kickoff: string;
  homeName: string;
  awayName: string;
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  /**
   * Čím se z λ počítaly pravděpodobnosti (`1` = Poisson). Nese se na řádku ze stejného
   * důvodu jako `rho`/`sharpen` na `PredictionRow`: aby šlo poznat, jakým rozdělením
   * byl řádek vyhodnocen, a nemíchat v jednom měření dvě různá.
   */
  varianceRatio: number;
  /** Skutečné rohy (z football-data, sloupce `HC`/`AC`). */
  actualHome: number;
  actualAway: number;
  actualTotal: number;
}

/**
 * Ligové měřítko rohů z **předchozí** sezóny téže ligy (aby do predikce neprotekl
 * hodnocený ročník) – přesný protějšek `baselineFor` u gólů. Bez dostatečné historie
 * vrací default.
 */
export function cornerBaselineFor(
  history: HistoryMatch[],
  leagueId: number,
  season: number
): CornerBaseline {
  const prev = history.filter(
    (m) =>
      m.leagueId === leagueId &&
      m.season === season - 1 &&
      m.homeMetrics?.CORNERS != null &&
      m.awayMetrics?.CORNERS != null
  );
  if (prev.length < 50) return DEFAULT_CORNER_BASELINE;
  const home = prev.reduce((a, m) => a + m.homeMetrics!.CORNERS!, 0) / prev.length;
  const away = prev.reduce((a, m) => a + m.awayMetrics!.CORNERS!, 0) / prev.length;
  return { home, away };
}

export interface CornerBacktestOptions {
  seasons: number[];
  minMatches?: number;
  tuning?: CornerTuning;
}

/**
 * Přehraje historii a vydá predikce rohů se skutečností – **point-in-time** stejně jako
 * gólový `backtest()` (tým se staví jen ze zápasů před výkopem, `matchStatsBefore`).
 *
 * Zápasy bez zaznamenaných rohů se přeskočí na obou stranách: bez skutečnosti není co
 * měřit a bez rohů v historii by λ stála na prázdnu (týká se „extra" lig – Norsko,
 * Dánsko, Rakousko – jejichž zdrojové soubory rohy nemají).
 */
export function backtestCorners(
  history: HistoryMatch[],
  opts: CornerBacktestOptions
): CornerRow[] {
  const seasons = new Set(opts.seasons);
  const minMatches = opts.minMatches ?? 0;
  const tuning = opts.tuning ?? DEFAULT_CORNER_TUNING;
  const baselines = new Map<string, CornerBaseline>();
  const rows: CornerRow[] = [];

  // Index zápasů podle týmu. `matchStatsBefore` si stejně filtruje podle `teamId`, takže
  // předat mu rovnou jen zápasy toho týmu dá **identický výsledek** – ale bez skenu celé
  // historie pro každý zápas (12 000 predikcí × 20 000 zápasů). Bez toho grid neběží.
  const byTeam = new Map<number, HistoryMatch[]>();
  for (const m of history) {
    for (const id of [m.homeId, m.awayId]) {
      const list = byTeam.get(id);
      if (list) list.push(m);
      else byTeam.set(id, [m]);
    }
  }

  for (const m of history) {
    if (!seasons.has(m.season)) continue;
    const actualHome = m.homeMetrics?.CORNERS;
    const actualAway = m.awayMetrics?.CORNERS;
    if (actualHome == null || actualAway == null) continue;

    const key = `${m.leagueId}:${m.season}`;
    let baseline = baselines.get(key);
    if (!baseline) {
      baseline = cornerBaselineFor(history, m.leagueId, m.season);
      baselines.set(key, baseline);
    }

    const homeStats = matchStatsBefore(byTeam.get(m.homeId) ?? [], m.homeId, m.date, m.season);
    const awayStats = matchStatsBefore(byTeam.get(m.awayId) ?? [], m.awayId, m.date, m.season);
    if (homeStats.length < minMatches || awayStats.length < minMatches) continue;

    const p = predictCorners(
      cornerValues(homeStats, new Date(m.date)),
      cornerValues(awayStats, new Date(m.date)),
      baseline,
      tuning
    );
    if (!p.available) continue;

    rows.push({
      fixtureId: m.fixtureId,
      leagueId: m.leagueId,
      season: m.season,
      kickoff: m.date,
      homeName: m.homeName,
      awayName: m.awayName,
      lambdaHome: p.lambdaHome,
      lambdaAway: p.lambdaAway,
      lambdaTotal: p.lambdaTotal,
      varianceRatio: tuning.varianceRatio,
      actualHome,
      actualAway,
      actualTotal: actualHome + actualAway,
    });
  }
  return rows;
}

/** Okenní hodnoty `CORNERS`/`CORNERS_AGAINST` s **predikčními** vahami oken (70/25/5). */
export function cornerValues(matches: MatchStat[], now: Date): MetricValue[] {
  return computeAllValues(
    matches,
    CORNER_METRICS,
    "CLUB",
    now,
    PREDICTION_WINDOW_WEIGHTS.CLUB
  );
}

/** Jeden kalibrační koš (protějšek `ReliabilityBin` pro binární trh). */
export interface CornerBin {
  lower: number;
  upper: number;
  count: number;
  avgPredicted: number | null;
  observed: number | null;
}

export interface CornerCalibration {
  bins: CornerBin[];
  /** Expected Calibration Error – vážený průměr |predikce − skutečnost| přes koše. */
  ece: number | null;
  n: number;
  logloss: number;
  /** Log-loss konstanty „vždy základní míra" – laťka, kterou model musí překonat. */
  baseLogloss: number;
  /** Jak často jev v datech nastal (základní míra). */
  baseRate: number;
}

const BIN_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/**
 * Kalibrace jedné linie Over/Under: rozbinuje predikce podle pravděpodobnosti a proti
 * každému koši postaví skutečnost. **Tohle je celý smysl kroku 1** – dokud model neumí
 * říct „60 %" tak, aby to nastalo v 60 %, nemá cenu se dívat na kurzy.
 *
 * Vrací i log-loss modelu vedle log-lossu konstanty: model, který nepřekoná základní
 * míru, nepřidává nic (táž laťka jako u Over 2.5 u gólů).
 */
export function cornerCalibration(rows: CornerRow[], line: number): CornerCalibration {
  const points = rows.map((r) => ({
    // Rozdělení bere z řádku, ne z globální konstanty → v jednom měření se nemůžou
    // potkat Poissonovy a NB řádky vyhodnocené jinak, než jak vznikly.
    p: overProbNegBin(r.lambdaTotal, line, r.varianceRatio),
    hit: r.actualTotal > line,
  }));
  const n = points.length;
  if (n === 0) {
    return { bins: [], ece: null, n: 0, logloss: 0, baseLogloss: 0, baseRate: 0 };
  }

  const baseRate = points.filter((x) => x.hit).length / n;
  const ll = (p: number, hit: boolean) => -Math.log(Math.max(hit ? p : 1 - p, 1e-9));
  const logloss = points.reduce((a, x) => a + ll(x.p, x.hit), 0) / n;
  const baseLogloss = points.reduce((a, x) => a + ll(baseRate, x.hit), 0) / n;

  const bins: CornerBin[] = [];
  let eceSum = 0;
  for (let i = 0; i < BIN_EDGES.length - 1; i++) {
    const lower = BIN_EDGES[i];
    const upper = BIN_EDGES[i + 1];
    // Poslední koš je uzavřený zprava, ať se p = 1 neztratí.
    const inBin = points.filter(
      (x) => x.p >= lower && (i === BIN_EDGES.length - 2 ? x.p <= upper : x.p < upper)
    );
    if (inBin.length === 0) {
      bins.push({ lower, upper, count: 0, avgPredicted: null, observed: null });
      continue;
    }
    const avgPredicted = inBin.reduce((a, x) => a + x.p, 0) / inBin.length;
    const observed = inBin.filter((x) => x.hit).length / inBin.length;
    eceSum += (inBin.length / n) * Math.abs(observed - avgPredicted);
    bins.push({ lower, upper, count: inBin.length, avgPredicted, observed });
  }

  return { bins, ece: eceSum, n, logloss, baseLogloss, baseRate };
}

/**
 * Test předpokladu Poissonu: **rozptyl / průměr** skutečných rohů. Poisson tvrdí, že se
 * ty dvě věci rovnají (poměr 1). Je-li poměr znatelně > 1, jsou rohy overdisperzní a
 * Poisson bude podstřelovat chvosty – tedy přesně ty pravděpodobnosti, na které se sází.
 * Bez tohohle čísla se kalibrace špatně interpretuje (nevíš, jestli je chyba v λ, nebo
 * v tvaru rozdělení).
 */
/**
 * **Podmíněná** overdisperze (Pearsonova statistika): `⌀ (skutečnost − λ)² / λ`.
 *
 * Proč nestačí `dispersion()`: ta měří rozptyl přes celý dataset, do kterého se počítá
 * i **rozptyl λ mezi zápasy** (`Var_marg = ⌀λ + Var(λ)`). Kdyby model rozlišoval zápasy
 * hodně, vyšel by poměr > 1, i kdyby byl každý jednotlivý zápas dokonale Poissonův.
 * Tahle statistika dělí odchylku vlastní λ toho zápasu, takže měří **jen** to, co
 * negativně binomické rozdělení opravuje. `≈ 1` = Poisson stačí, `> 1` = NB má co dělat.
 */
export function pearsonDispersion(rows: CornerRow[]): number {
  const usable = rows.filter((r) => r.lambdaTotal > 0);
  if (usable.length === 0) return 0;
  return (
    usable.reduce((a, r) => a + (r.actualTotal - r.lambdaTotal) ** 2 / r.lambdaTotal, 0) /
    usable.length
  );
}

export function dispersion(rows: CornerRow[]): { mean: number; variance: number; ratio: number } {
  const n = rows.length;
  if (n === 0) return { mean: 0, variance: 0, ratio: 0 };
  const mean = rows.reduce((a, r) => a + r.actualTotal, 0) / n;
  const variance = rows.reduce((a, r) => a + (r.actualTotal - mean) ** 2, 0) / n;
  return { mean, variance, ratio: mean > 0 ? variance / mean : 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
