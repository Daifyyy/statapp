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

/** Výběr pravděpodobností 1X2 z řádku (náš model / benchmark) – null = nedostupné. */
type ProbPick = (r: PredictionRow) => { home: number; draw: number; away: number } | null;

const ourProbs: ProbPick = (r) =>
  r.available ? { home: r.homeWin, draw: r.draw, away: r.awayWin } : null;

const benchProbs: ProbPick = (r) =>
  r.benchAvailable && r.benchHomeWin != null && r.benchDraw != null && r.benchAwayWin != null
    ? { home: r.benchHomeWin, draw: r.benchDraw, away: r.benchAwayWin }
    : null;

/** Multiclass Brier + log-loss + 1X2 přesnost (argmax) z vybraných pravděpodobností. */
function probScores(
  rows: PredictionRow[],
  pick: ProbPick
): { brier: number; logloss: number; accuracy: number; n: number } {
  let brier = 0;
  let logloss = 0;
  let hits = 0;
  let n = 0;
  for (const r of rows) {
    if (r.homeGoals == null || r.awayGoals == null) continue;
    const p = pick(r);
    if (!p) continue;
    const oH = r.homeGoals > r.awayGoals ? 1 : 0;
    const oA = r.homeGoals < r.awayGoals ? 1 : 0;
    const oD = r.homeGoals === r.awayGoals ? 1 : 0;
    brier += (p.home - oH) ** 2 + (p.draw - oD) ** 2 + (p.away - oA) ** 2;
    const pObs = oH ? p.home : oA ? p.away : p.draw;
    logloss += -Math.log(Math.max(pObs, 1e-9));
    const argmax = p.home >= p.draw && p.home >= p.away ? "H" : p.away >= p.draw ? "A" : "D";
    const actual = oH ? "H" : oA ? "A" : "D";
    if (argmax === actual) hits++;
    n++;
  }
  return n
    ? { brier: brier / n, logloss: logloss / n, accuracy: hits / n, n }
    : { brier: 0, logloss: 0, accuracy: 0, n: 0 };
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
  const ps = probScores(rows, ourProbs);
  console.log(`Brier (1X2): ${ps.brier.toFixed(4)} | log-loss: ${ps.logloss.toFixed(4)} (n=${ps.n})`);

  // Side-by-side benchmark: náš model vs. predikce API-Footballu na STEJNÉ podmnožině
  // (jen řádky, kde mají oba dostupnou predikci) → férové srovnání přesnosti.
  const both = rows.filter((r) => ourProbs(r) != null && benchProbs(r) != null);
  console.log("\n=== Benchmark vs. API-Football (1X2, společná podmnožina) ===");
  if (both.length === 0) {
    console.log("Žádné odehrané zápasy s benchmarkem od API. Sbírá se z klubových lig (mimo sezónu prázdno).");
  } else {
    const ours = probScores(both, ourProbs);
    const bench = probScores(both, benchProbs);
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
}

main()
  .catch((e) => {
    console.error("❌ Kalibrace selhala:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
