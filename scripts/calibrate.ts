// Kalibrace modelu z odehraných predikcí (predikce vs. skutečnost).
// Spuštění: node --env-file=.env --import tsx scripts/calibrate.ts
//
// 1) MLE parametru Dixon–Coles ρ: drží uložené λ a hledá ρ s max. věrohodností
//    pozorovaných skóre → doporučení pro konstantu DC_RHO v lib/stats/predict.ts.
// 2) Reportuje úspěšnost (1X2), Brier skóre a log-loss uložených predikcí.
import { getSettledPredictions } from "../lib/data/predictionStore.ts";
import { MODEL_VERSION } from "../lib/data/predictions.ts";
import { drawTau, poissonVector } from "../lib/stats/predict.ts";
import { computeTrackRecord } from "../lib/picks/trackRecord.ts";
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

/** Multiclass Brier + log-loss z uložených pravděpodobností 1X2. */
function probScores(rows: PredictionRow[]): { brier: number; logloss: number; n: number } {
  let brier = 0;
  let logloss = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const oH = r.homeGoals > r.awayGoals ? 1 : 0;
    const oA = r.homeGoals < r.awayGoals ? 1 : 0;
    const oD = r.homeGoals === r.awayGoals ? 1 : 0;
    brier +=
      (r.homeWin - oH) ** 2 + (r.draw - oD) ** 2 + (r.awayWin - oA) ** 2;
    const pObs = oH ? r.homeWin : oA ? r.awayWin : r.draw;
    logloss += -Math.log(Math.max(pObs, 1e-9));
    n++;
  }
  return n ? { brier: brier / n, logloss: logloss / n, n } : { brier: 0, logloss: 0, n: 0 };
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
  const ps = probScores(rows);
  console.log(`Brier (1X2): ${ps.brier.toFixed(4)} | log-loss: ${ps.logloss.toFixed(4)} (n=${ps.n})`);

  console.log("\n=== MLE Dixon–Coles ρ ===");
  let best = { rho: 0, ll: -Infinity };
  for (let rho = -0.25; rho <= 0.0501; rho += 0.005) {
    const r = Math.round(rho * 1000) / 1000;
    const ll = logLikelihood(rows, r);
    if (ll > best.ll) best = { rho: r, ll };
  }
  console.log(`Doporučené ρ (max věrohodnost): ${best.rho}  (LL=${best.ll.toFixed(2)})`);
  console.log("Dolaď konstantu DC_RHO v lib/stats/predict.ts a bumpni MODEL_VERSION.");
}

main()
  .catch((e) => {
    console.error("❌ Kalibrace selhala:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
