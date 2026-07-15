import type { PredictionRow } from "@/lib/types";
import { calibrateOutcome, drawTau, poissonVector, sharpenLambdas } from "@/lib/stats/predict";

/**
 * Fitování **post-parametrů** modelu (Dixon–Coles ρ, zostření λ) nad odehranými řádky.
 * Čisté funkce nad uloženými **základními λ** – proto je umí spustit jak `calibrate`
 * (živý dataset z DB), tak `backtest` (historie přepočítaná offline). Žádné API.
 *
 * Že to jde bez přepočtu λ, je celý smysl rozdělení verzování: ρ i zostření se aplikují
 * až NA λ (viz `PREDICT_PARAMS`), takže se dají hledat gridem nad tím, co už máme.
 */

const MAX_GOALS = 10;

/** Log-likelihood pozorovaných skóre pod daným ρ (λ z řádku, bez zostření). */
export function logLikelihood(rows: PredictionRow[], rho: number): number {
  let ll = 0;
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const hg = r.homeGoals;
    const ag = r.awayGoals;
    if (hg > MAX_GOALS || ag > MAX_GOALS) continue;
    const ph = poissonVector(r.lambdaHome);
    const pa = poissonVector(r.lambdaAway);
    let norm = 0;
    for (let i = 0; i <= MAX_GOALS; i++)
      for (let j = 0; j <= MAX_GOALS; j++)
        norm += ph[i] * pa[j] * drawTau(i, j, r.lambdaHome, r.lambdaAway, rho);
    const p =
      (ph[hg] * pa[ag] * drawTau(hg, ag, r.lambdaHome, r.lambdaAway, rho)) / (norm || 1);
    if (p > 0) ll += Math.log(p);
  }
  return ll;
}

/** MLE ρ gridem (jemnost 0.005 v rozsahu, kde se fotbalové ρ pohybuje). */
export function fitRho(rows: PredictionRow[]): { rho: number; logLik: number } {
  let best = { rho: 0, logLik: -Infinity };
  for (let rho = -0.25; rho <= 0.0501; rho += 0.005) {
    const r = Math.round(rho * 1000) / 1000;
    const ll = logLikelihood(rows, r);
    if (ll > best.logLik) best = { rho: r, logLik: ll };
  }
  return best;
}

export interface OutcomeScore {
  logloss: number;
  brier: number;
  n: number;
}

/**
 * 1X2 log-loss + Brier při zostření λ parametrem `s` (ρ = produkční default).
 * Zostření drží součet λ → měří dopad jen na 1X2. `s = 1` = současný model.
 */
export function outcomeScoreAtSharpen(
  rows: PredictionRow[],
  s: number
): OutcomeScore {
  let ll = 0;
  let brier = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const [lh, la] = sharpenLambdas(r.lambdaHome, r.lambdaAway, s);
    const ph = poissonVector(lh);
    const pa = poissonVector(la);
    let home = 0;
    let draw = 0;
    let away = 0;
    let total = 0;
    for (let i = 0; i <= MAX_GOALS; i++)
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = ph[i] * pa[j] * drawTau(i, j, lh, la);
        total += p;
        if (i > j) home += p;
        else if (i === j) draw += p;
        else away += p;
      }
    const norm = total || 1;
    home /= norm;
    draw /= norm;
    away /= norm;
    const oH = r.homeGoals > r.awayGoals ? 1 : 0;
    const oA = r.homeGoals < r.awayGoals ? 1 : 0;
    const oD = r.homeGoals === r.awayGoals ? 1 : 0;
    brier += (home - oH) ** 2 + (draw - oD) ** 2 + (away - oA) ** 2;
    ll += -Math.log(Math.max(oH ? home : oA ? away : draw, 1e-9));
    n++;
  }
  return n ? { logloss: ll / n, brier: brier / n, n } : { logloss: 0, brier: 0, n: 0 };
}

export interface SharpenFit {
  best: number;
  baseline: OutcomeScore;
  bestScore: OutcomeScore;
  /** Optimum na horní hranici gridu = podezření na overfit (rozšiř vzorek, ne grid). */
  atGridEdge: boolean;
}

/** Grid search zostření `s` minimalizující 1X2 log-loss (`s = 1` = baseline). */
export function fitSharpen(rows: PredictionRow[], sMax = 3.0): SharpenFit {
  const baseline = outcomeScoreAtSharpen(rows, 1);
  let best = 1;
  let bestLogloss = baseline.logloss;
  for (let s = 1.0; s <= sMax + 0.001; s += 0.05) {
    const sr = Math.round(s * 100) / 100;
    const sc = outcomeScoreAtSharpen(rows, sr);
    if (sc.logloss < bestLogloss) {
      best = sr;
      bestLogloss = sc.logloss;
    }
  }
  return {
    best,
    baseline,
    bestScore: outcomeScoreAtSharpen(rows, best),
    atGridEdge: best >= sMax,
  };
}

/**
 * 1X2 log-loss + Brier při Platt kalibraci `(a, b)` nad **hotovým** 1X2 z řádku
 * (`r.homeWin/draw/awayWin` = po ρ+zostření, jako aktuálně produkčně běží). `a=1,b=0`
 * = current model (viz `calibrateOutcome` v `predict.ts` pro zdůvodnění tvaru).
 */
export function outcomeScoreAtCalibration(
  rows: PredictionRow[],
  a: number,
  b: number
): OutcomeScore {
  let ll = 0;
  let brier = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const [home, draw, away] = calibrateOutcome(r.homeWin, r.draw, r.awayWin, a, b);
    const oH = r.homeGoals > r.awayGoals ? 1 : 0;
    const oA = r.homeGoals < r.awayGoals ? 1 : 0;
    const oD = r.homeGoals === r.awayGoals ? 1 : 0;
    brier += (home - oH) ** 2 + (draw - oD) ** 2 + (away - oA) ** 2;
    ll += -Math.log(Math.max(oH ? home : oA ? away : draw, 1e-9));
    n++;
  }
  return n ? { logloss: ll / n, brier: brier / n, n } : { logloss: 0, brier: 0, n: 0 };
}

export interface CalibFit {
  a: number;
  b: number;
  baseline: OutcomeScore;
  bestScore: OutcomeScore;
  /** Optimum na hranici gridu = podezření na overfit (rozšiř vzorek, ne grid). */
  atGridEdge: boolean;
}

/**
 * Grid search Platt parametrů `(a, b)` minimalizující 1X2 log-loss (`a=1,b=0` = baseline).
 * Rozsah `a` [0.4, 1.6] pokrývá „silně stlač" až „silně zostři"; `b` [-0.3, 0.3] pokrývá
 * posun středu. Sdílené s `sharpenLambdas`-fitem: nezávislé opravy různého tvaru chyby.
 */
export function fitCalibration(rows: PredictionRow[]): CalibFit {
  const baseline = outcomeScoreAtCalibration(rows, 1, 0);
  const aMin = 0.4;
  const aMax = 1.6;
  const bMin = -0.3;
  const bMax = 0.3;
  let best = { a: 1, b: 0 };
  let bestLogloss = baseline.logloss;
  for (let a = aMin; a <= aMax + 0.001; a += 0.05) {
    const ar = Math.round(a * 100) / 100;
    for (let b = bMin; b <= bMax + 0.001; b += 0.02) {
      const br = Math.round(b * 100) / 100;
      const sc = outcomeScoreAtCalibration(rows, ar, br);
      if (sc.logloss < bestLogloss) {
        best = { a: ar, b: br };
        bestLogloss = sc.logloss;
      }
    }
  }
  return {
    ...best,
    baseline,
    bestScore: outcomeScoreAtCalibration(rows, best.a, best.b),
    atGridEdge: best.a <= aMin || best.a >= aMax || best.b <= bMin || best.b >= bMax,
  };
}
