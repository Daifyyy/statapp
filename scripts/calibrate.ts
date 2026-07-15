// Kalibrace modelu z odehraných predikcí (predikce vs. skutečnost).
// Spuštění: node --env-file=.env --import tsx scripts/calibrate.ts
//
// 1) MLE parametru Dixon–Coles ρ: drží uložené λ a hledá ρ s max. věrohodností
//    pozorovaných skóre → doporučení pro konstantu DC_RHO v lib/stats/predict.ts.
// 2) Reportuje úspěšnost (1X2), Brier skóre a log-loss uložených predikcí.
import { getSettledPredictions } from "../lib/data/predictionStore.ts";
import { MODEL_VERSION } from "../lib/data/predictions.ts";
import {
  fitCalibration,
  fitRho,
  fitSharpen,
  outcomeScoreAtSharpen,
} from "../lib/picks/fit.ts";
import {
  computeTrackRecord,
  scoreProbs,
  ourProbs,
  benchProbs,
} from "../lib/picks/trackRecord.ts";
import { computeMarketBenchmark, isClubRow } from "../lib/picks/market.ts";

// Fit ρ/zostření i skórování 1X2 jsou sdílené čisté funkce (`lib/picks/fit.ts`,
// `trackRecord.ts`) → tentýž kód žene kalibraci z DB i offline `npm run backtest`.

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

  const club = rows.filter(isClubRow);
  console.log(
    `Z toho klubových: ${club.length} | reprezentačních: ${rows.length - club.length}`
  );

  const tr = computeTrackRecord(rows);
  console.log("\n=== Úspěšnost (uložené predikce) ===");
  console.log("1X2 přesnost:", tr.outcomeAccuracy != null ? `${(tr.outcomeAccuracy * 100).toFixed(1)} %` : "—");
  console.log("Přes 2.5:", tr.over25Accuracy != null ? `${(tr.over25Accuracy * 100).toFixed(1)} %` : "—");
  console.log("Oba skórují:", tr.bttsAccuracy != null ? `${(tr.bttsAccuracy * 100).toFixed(1)} %` : "—");
  const ps = scoreProbs(rows, ourProbs);
  console.log(`Brier (1X2): ${ps.brier.toFixed(4)} | log-loss: ${ps.logloss.toFixed(4)} (n=${ps.n})`);

  // Benchmark proti TRHU (odmaržované kurzy) – jediné měřítko, které rozhoduje, jestli
  // mají value tipy smysl. Jen klubové zápasy (reprezentace kurzy nemají a jsou napříč
  // konfederacemi nesrovnatelné).
  const mb = computeMarketBenchmark(rows);
  console.log("\n=== Benchmark vs. TRH (1X2, odmaržované kurzy, jen klubové) ===");
  if (mb.n === 0 || !mb.our || !mb.market) {
    console.log(
      "Žádné odehrané klubové zápasy s kurzy. Kurzy se tahají jen klubovým ligám a jen " +
        "do 72 h před výkopem → naplní se, až se rozjede klubová sezóna."
    );
  } else {
    const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
    console.log(`Společných zápasů: ${mb.n} | ⌀ marže sázkovky: ${((mb.avgOverround! - 1) * 100).toFixed(1)} %`);
    console.log(`              náš model      trh (de-vig)`);
    console.log(`1X2 přesnost: ${pct(mb.our.accuracy).padEnd(14)} ${pct(mb.market.accuracy)}`);
    console.log(`Brier:        ${mb.our.brier.toFixed(4).padEnd(14)} ${mb.market.brier.toFixed(4)}  (nižší = lepší)`);
    console.log(`log-loss:     ${mb.our.logloss.toFixed(4).padEnd(14)} ${mb.market.logloss.toFixed(4)}  (nižší = lepší)`);
    const d = mb.market.logloss - mb.our.logloss;
    console.log(
      d > 0
        ? `✅ Překonáváme trh o ${d.toFixed(4)} log-loss → value tipy mají oporu.`
        : `⚠ Trh je lepší o ${(-d).toFixed(4)} log-loss → „kladná hrana" v EV je spíš chyba modelu než díra na trhu.`
    );
    if (mb.n < 100) console.log("(Vzorek < 100 – orientační.)");
  }

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
  const best = fitRho(rows);
  console.log(`Doporučené ρ (max věrohodnost): ${best.rho}  (LL=${best.logLik.toFixed(2)})`);
  console.log(
    "Dolaď DC_RHO v lib/stats/predict.ts → pak `npm run reprice` (přepočte historii z λ). " +
      "MODEL_VERSION NEbumpuj – ρ je post-parametr, dataset se nemá zahazovat."
  );

  // Zostření λ (LAMBDA_SHARPEN): grid search minimalizující 1X2 log-loss. Drží součet λ
  // → opravuje jen 1X2 (favorité), Over 2.5 nechá být. s=1 = současný model (baseline).
  console.log("\n=== Zostření λ (LAMBDA_SHARPEN, oprava favoritů) ===");
  const sh = fitSharpen(rows);
  const fmt = (x: number) => x.toFixed(4);
  console.log(
    `Baseline   s=1.00 → log-loss ${fmt(sh.baseline.logloss)} | Brier ${fmt(sh.baseline.brier)} (n=${sh.baseline.n})`
  );
  console.log(
    `Doporučené s=${sh.best.toFixed(2)} → log-loss ${fmt(sh.bestScore.logloss)} | Brier ${fmt(sh.bestScore.brier)}`
  );
  if (sh.best === 1) {
    console.log("→ Zostření nepomáhá (s=1 je optimum) – nech LAMBDA_SHARPEN=1.0.");
  } else {
    const gain = sh.baseline.logloss - sh.bestScore.logloss;
    console.log(`→ Zlepšení log-loss o ${fmt(gain)}.`);
    if (sh.atGridEdge) {
      console.log(
        "⚠ Optimum na hranici gridu → overfit na malém vzorku (a/nebo strukturálně stlačená λ). " +
          "Ověř přes `npm run backtest` na tisících zápasů, ne laděním tady."
      );
    } else {
      console.log(
        "Pozor: na malém vzorku může být v šumu – nastav LAMBDA_SHARPEN v predict.ts (a spusť " +
          "`npm run reprice`) jen když to potvrdí i `npm run backtest`. MODEL_VERSION NEbumpuj."
      );
    }
  }
  // Platt kalibrace 1X2 (a, b): oprava TVARU chyby (favorit i outsider zároveň), ne jen
  // síly jako zostření. Grid search nad hotovým 1X2 z uložených řádků.
  console.log("\n=== Kalibrace 1X2 (Platt scaling, oprava tvaru chyby) ===");
  const cal = fitCalibration(rows);
  console.log(
    `Baseline   a=1.00, b=0.00 → log-loss ${fmt(cal.baseline.logloss)} | Brier ${fmt(cal.baseline.brier)} (n=${cal.baseline.n})`
  );
  console.log(
    `Doporučené a=${cal.a.toFixed(2)}, b=${cal.b.toFixed(2)} → log-loss ${fmt(cal.bestScore.logloss)} | Brier ${fmt(cal.bestScore.brier)}`
  );
  if (cal.a === 1 && cal.b === 0) {
    console.log("→ Kalibrace nepomáhá (a=1,b=0 je optimum) – nech CALIB_A=1.0, CALIB_B=0.0.");
  } else {
    const gain = cal.baseline.logloss - cal.bestScore.logloss;
    console.log(`→ Zlepšení log-loss o ${fmt(gain)}.`);
    if (cal.atGridEdge) {
      console.log(
        "⚠ Optimum na hranici gridu → overfit na malém vzorku. Ověř přes `npm run backtest` " +
          "na tisících zápasů, ne laděním na pár desítkách z DB."
      );
    } else {
      console.log(
        "Pozor: na malém vzorku může být v šumu – nastav CALIB_A/CALIB_B v predict.ts (a spusť " +
          "`npm run reprice`) jen když to potvrdí i `npm run backtest`. MODEL_VERSION NEbumpuj."
      );
    }
  }

  // Ověř, že baseline sedí na produkční konstantu (jistota, že fit měří to, co běží).
  const check = outcomeScoreAtSharpen(rows, 1);
  if (Math.abs(check.logloss - ps.logloss) > 0.02) {
    console.log("\n⚠ Baseline fitu se liší od uložených pravděpodobností → řádky nejsou přepočtené (`npm run reprice`).");
  }
}

main()
  .catch((e) => {
    console.error("❌ Kalibrace selhala:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
