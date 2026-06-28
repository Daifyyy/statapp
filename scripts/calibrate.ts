// Kalibrace modelu z odehraných predikcí (predikce vs. skutečnost).
// Spuštění: node --env-file=.env --import tsx scripts/calibrate.ts
//
// 1) MLE parametru Dixon–Coles ρ: drží uložené λ a hledá ρ s max. věrohodností
//    pozorovaných skóre → doporučení pro konstantu DC_RHO v lib/stats/predict.ts.
// 2) Reportuje úspěšnost (1X2), Brier skóre a log-loss uložených predikcí.
import { getSettledPredictions } from "../lib/data/predictionStore.ts";
import { MODEL_VERSION } from "../lib/data/predictions.ts";
import { drawTau, poissonVector, sharpenLambdas } from "../lib/stats/predict.ts";
import {
  computeTrackRecord,
  scoreProbs,
  ourProbs,
  benchProbs,
} from "../lib/picks/trackRecord.ts";
import type { PredictionRow } from "../lib/types.ts";

const MAX_GOALS = 10;

/** Log-likelihood pozorovaných skóre pod daným ρ (λ z uložené predikce). */
function logLikelihood(rows: PredictionRow[], rho: number): number {
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
      (ph[hg] * pa[ag] * drawTau(hg, ag, r.lambdaHome, r.lambdaAway, rho)) /
      (norm || 1);
    if (p > 0) ll += Math.log(p);
  }
  return ll;
}

// 1X2 výběr pravděpodobností a skórování sdílí lib/picks/trackRecord.ts (ourProbs,
// benchProbs, scoreProbs) → jeden zdroj pravdy s API track-recordem.

/**
 * 1X2 multiclass log-loss + Brier při zostření λ parametrem `s` (ρ = produkční DC_RHO
 * přes default `drawTau`). Zostření drží součet λ → měří dopad jen na 1X2. `s = 1`
 * reprodukuje současný model. Hledáme `s`, které minimalizuje log-loss (oprava
 * „podsebevědomosti na favoritech" z reliability křivky).
 */
function outcomeScoreAtSharpen(
  rows: PredictionRow[],
  s: number
): { logloss: number; brier: number; n: number } {
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
    const pObs = oH ? home : oA ? away : draw;
    ll += -Math.log(Math.max(pObs, 1e-9));
    n++;
  }
  return n ? { logloss: ll / n, brier: brier / n, n } : { logloss: 0, brier: 0, n: 0 };
}

async function main() {
  const rows = await getSettledPredictions(MODEL_VERSION);
  console.log(`Odehraných predikcí (modelVersion=${MODEL_VERSION}): ${rows.length}`);
  if (rows.length < 30) {
    console.log("⚠ Málo dat (<30) – výsledky jsou orientační, sbírej dál.");
  }
  if (rows.length === 0) {
    console.log("Žádná data ke kalibraci. Spusť pipeline a settle, počkej na odehrání.");
    return;
  }

  const tr = computeTrackRecord(rows);
  console.log("\n=== Úspěšnost (uložené predikce) ===");
  console.log("1X2 přesnost:", tr.outcomeAccuracy != null ? `${(tr.outcomeAccuracy * 100).toFixed(1)} %` : "—");
  console.log("Přes 2.5:", tr.over25Accuracy != null ? `${(tr.over25Accuracy * 100).toFixed(1)} %` : "—");
  console.log("Oba skórují:", tr.bttsAccuracy != null ? `${(tr.bttsAccuracy * 100).toFixed(1)} %` : "—");
  const ps = scoreProbs(rows, ourProbs);
  console.log(`Brier (1X2): ${ps.brier.toFixed(4)} | log-loss: ${ps.logloss.toFixed(4)} (n=${ps.n})`);

  // Side-by-side benchmark: náš model vs. predikce API-Footballu na STEJNÉ podmnožině
  // (jen řádky, kde mají oba dostupnou predikci) → férové srovnání přesnosti.
  const both = rows.filter((r) => ourProbs(r) != null && benchProbs(r) != null);
  console.log("\n=== Benchmark vs. API-Football (1X2, společná podmnožina) ===");
  if (both.length === 0) {
    console.log("Žádné odehrané zápasy s benchmarkem od API. Sbírá se z klubových lig (mimo sezónu prázdno).");
  } else {
    const ours = scoreProbs(both, ourProbs);
    const bench = scoreProbs(both, benchProbs);
    const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
    console.log(`Společných zápasů: ${both.length}`);
    console.log(`              náš model      API-Football`);
    console.log(`1X2 přesnost: ${pct(ours.accuracy).padEnd(14)} ${pct(bench.accuracy)}`);
    console.log(`Brier:        ${ours.brier.toFixed(4).padEnd(14)} ${bench.brier.toFixed(4)}  (nižší = lepší)`);
    console.log(`log-loss:     ${ours.logloss.toFixed(4).padEnd(14)} ${bench.logloss.toFixed(4)}  (nižší = lepší)`);
    const verdict =
      ours.logloss < bench.logloss
        ? "✅ Náš model má nižší log-loss (lepší)."
        : ours.logloss > bench.logloss
          ? "⚠ API-Football má nižší log-loss (lepší)."
          : "≈ Vyrovnané.";
    console.log(verdict + (both.length < 30 ? " (Malý vzorek <30 – orientační.)" : ""));
  }

  console.log("\n=== MLE Dixon–Coles ρ ===");
  let best = { rho: 0, ll: -Infinity };
  for (let rho = -0.25; rho <= 0.0501; rho += 0.005) {
    const r = Math.round(rho * 1000) / 1000;
    const ll = logLikelihood(rows, r);
    if (ll > best.ll) best = { rho: r, ll };
  }
  console.log(`Doporučené ρ (max věrohodnost): ${best.rho}  (LL=${best.ll.toFixed(2)})`);
  console.log("Dolaď konstantu DC_RHO v lib/stats/predict.ts a bumpni MODEL_VERSION.");

  // Zostření λ (LAMBDA_SHARPEN): grid search minimalizující 1X2 log-loss. Drží součet λ
  // → opravuje jen 1X2 (favorité), Over 2.5 nechá být. s=1 = současný model (baseline).
  console.log("\n=== Zostření λ (LAMBDA_SHARPEN, oprava favoritů) ===");
  const baseScore = outcomeScoreAtSharpen(rows, 1);
  const S_MAX = 3.0; // horní mez gridu; argmin na hranici = podezření na overfit (viz níže)
  let bestS = { s: 1, logloss: baseScore.logloss };
  for (let s = 1.0; s <= S_MAX + 0.001; s += 0.05) {
    const sr = Math.round(s * 100) / 100;
    const sc = outcomeScoreAtSharpen(rows, sr);
    if (sc.logloss < bestS.logloss) bestS = { s: sr, logloss: sc.logloss };
  }
  const bestScore = outcomeScoreAtSharpen(rows, bestS.s);
  const fmt = (x: number) => x.toFixed(4);
  console.log(
    `Baseline   s=1.00 → log-loss ${fmt(baseScore.logloss)} | Brier ${fmt(baseScore.brier)} (n=${baseScore.n})`
  );
  console.log(
    `Doporučené s=${bestS.s.toFixed(2)} → log-loss ${fmt(bestScore.logloss)} | Brier ${fmt(bestScore.brier)}`
  );
  if (bestS.s === 1) {
    console.log("→ Zostření nepomáhá (s=1 je optimum) – nech LAMBDA_SHARPEN=1.0.");
  } else {
    const gain = baseScore.logloss - bestScore.logloss;
    console.log(`→ Zlepšení log-loss o ${fmt(gain)} (Brier ${fmt(baseScore.brier)} → ${fmt(bestScore.brier)}).`);
    if (bestS.s >= S_MAX) {
      console.log(
        `⚠ Optimum na hranici gridu (s=${S_MAX.toFixed(1)}) → skoro jistě overfit na malém vzorku. ` +
          `NEPOUŽÍVAT teď; potvrď až na ~150–300 zápasech, kde optimum sedne dovnitř gridu.`
      );
    } else {
      console.log(
        "Pozor: na malém vzorku může být v šumu – nastav LAMBDA_SHARPEN v predict.ts a bumpni " +
          "MODEL_VERSION jen když je vzorek dost velký (~150–300)."
      );
    }
  }
}

main()
  .catch((e) => {
    console.error("❌ Kalibrace selhala:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
