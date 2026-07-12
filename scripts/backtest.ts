// Offline backtest predikčního modelu na historii klubových lig.
//
// Proč: dosud se model dal měřit jen rychlostí, jakou se hrají zápasy (dataset v DB roste
// po kapkách a je celý z MS 2026). Přitom výsledky zápasů jsou v API levné –
// `/fixtures?league=&season=` je **1 volání na ligu a sezónu**, takže za ~20 volání máme
// tisíce zápasů se skóre. Model se pak dá vyhodnotit a doladit za minuty, ne za sezónu.
//
// Jak: pro každý historický zápas se tým postaví JEN z dat dostupných před výkopem
// (point-in-time, kryto testem) a pustí se STEJNÝM jádrem `compareTeams` → výsledek je
// `PredictionRow[]`, tedy tvar, který už umí track-record, reliability i fit ρ/zostření.
//
// Omezení (viz lib/picks/backtest.ts): bez xG (to je 1 volání/zápas) a bez pohárů.
//
// Spuštění:
//   npm run backtest                                  # top-5, poslední 2 dokončené sezóny
//   npm run backtest -- --leagues=39,140 --seasons=2024,2025
//   npm run backtest -- --minMatches=5 --refresh      # jen zavedená sezóna / znovu stáhnout
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchLeagueSeasonFixtures, FINISHED_STATUSES } from "../lib/data/apiFootball.ts";
import { fullTimeGoals } from "../lib/data/fixtures.ts";
import { PREDICTION_LEAGUES } from "../lib/data/predictions.ts";
import { backtest, NAIVE_PROBS, type HistoryMatch } from "../lib/picks/backtest.ts";
import { PREDICT_PARAMS } from "../lib/stats/predict.ts";
import { fitRho, fitSharpen } from "../lib/picks/fit.ts";
import { computeReliability } from "../lib/picks/reliability.ts";
import {
  computeTrackRecord,
  ourProbs,
  scoreProbs,
  type ProbPick,
} from "../lib/picks/trackRecord.ts";

const CACHE_DIR = join(process.cwd(), ".cache", "backtest");

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const nums = (s: string) => s.split(",").map((x) => Number(x.trim()));

const leagues = arg("leagues") ? nums(arg("leagues")!) : PREDICTION_LEAGUES;
const seasons = arg("seasons") ? nums(arg("seasons")!) : [2024, 2025];
const minMatches = Number(arg("minMatches") ?? 0);
const refresh = process.argv.includes("--refresh");

/**
 * Zápasy ligy+sezóny s diskovou cache: iterace nad modelem pak běží úplně offline
 * (a neplýtvá kvótou). `--refresh` cache obejde.
 */
async function loadSeason(league: number, season: number): Promise<HistoryMatch[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${league}-${season}.json`);
  if (!refresh && existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8")) as HistoryMatch[];
  }
  const raw = await fetchLeagueSeasonFixtures(league, season);
  const rows: HistoryMatch[] = [];
  for (const f of raw) {
    if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
    const ft = fullTimeGoals(f); // skóre po 90 min (v lize = koncové)
    if (!ft) continue;
    rows.push({
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      season,
      leagueId: league,
      homeId: f.teams.home.id,
      awayId: f.teams.away.id,
      homeName: f.teams.home.name,
      awayName: f.teams.away.name,
      homeLogo: f.teams.home.logo,
      awayLogo: f.teams.away.logo,
      homeGoals: ft.home,
      awayGoals: ft.away,
    });
  }
  writeFileSync(file, JSON.stringify(rows));
  return rows;
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const naivePick: ProbPick = () => NAIVE_PROBS;

async function main() {
  // Baseline okno (sezóna − 1) musí být taky staženo, jinak nemá 1. kolo z čeho vyjít.
  const needed = [...new Set(seasons.flatMap((s) => [s - 1, s]))].sort();
  console.log(
    `Ligy: ${leagues.join(", ")} | predikované sezóny: ${seasons.join(", ")} ` +
      `(+ ${Math.min(...needed)} jako baseline)`
  );

  const history: HistoryMatch[] = [];
  let fetched = 0;
  for (const league of leagues) {
    for (const season of needed) {
      const file = join(CACHE_DIR, `${league}-${season}.json`);
      const cached = !refresh && existsSync(file);
      const rows = await loadSeason(league, season);
      if (!cached) fetched++;
      history.push(...rows);
    }
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  console.log(
    `Historie: ${history.length} odehraných zápasů ` +
      `(${fetched} volání API, zbytek z .cache/backtest)`
  );

  // Grid search ladicích parametrů λ (`--grid`): shrinkage × exponent síly. Rozhodne
  // měření, ne odhad od stolu – proto je backtest. Verdikt dle 1X2 log-loss.
  if (process.argv.includes("--grid")) {
    console.log("\n=== Grid search λ (shrinkMatches × strength) ===");
    console.log("k\\s   " + [0.4, 0.5, 0.6, 0.7, 0.85, 1.0].map((s) => s.toFixed(2).padStart(7)).join(""));
    for (const k of [2, 4, 6, 10, 15]) {
      const cells: string[] = [];
      for (const s of [0.4, 0.5, 0.6, 0.7, 0.85, 1.0]) {
        const r = backtest(history, {
          seasons,
          minMatches,
          tuning: { shrinkMatches: k, strength: s },
        }).filter((x) => x.available);
        cells.push(scoreProbs(r, ourProbs).logloss.toFixed(4).padStart(7));
      }
      console.log(`${String(k).padEnd(6)}${cells.join("")}`);
    }
    console.log(
      "(nižší = lepší; referenční body: naivní konstanta 1.0770, model před přepisem λ 1.0494)"
    );
    return;
  }

  // `--tune=k,s` = jednorázový běh s konkrétními parametry λ (bez nich produkční default).
  const tuneArg = arg("tune");
  const tuning = tuneArg
    ? { shrinkMatches: nums(tuneArg)[0], strength: nums(tuneArg)[1] }
    : undefined;
  if (tuning) console.log(`Ladění λ: shrinkMatches=${tuning.shrinkMatches}, strength=${tuning.strength}`);

  console.time("backtest");
  const rows = backtest(history, { seasons, minMatches, tuning });
  console.timeEnd("backtest");

  const usable = rows.filter((r) => r.available);
  console.log(
    `\nPredikováno: ${rows.length} zápasů | s dostupnou predikcí: ${usable.length}` +
      (minMatches ? ` | minMatches=${minMatches}` : "")
  );
  if (usable.length === 0) {
    console.log("Nic k vyhodnocení.");
    return;
  }

  const tr = computeTrackRecord(usable);
  const ours = scoreProbs(usable, ourProbs);
  const naive = scoreProbs(usable, naivePick);

  console.log("\n=== Kvalita predikcí (1X2) ===");
  console.log(`              náš model      naivní konstanta`);
  console.log(`přesnost:     ${pct(ours.accuracy).padEnd(14)} ${pct(naive.accuracy)}`);
  console.log(`Brier:        ${ours.brier.toFixed(4).padEnd(14)} ${naive.brier.toFixed(4)}  (nižší = lepší)`);
  console.log(`log-loss:     ${ours.logloss.toFixed(4).padEnd(14)} ${naive.logloss.toFixed(4)}  (nižší = lepší)`);
  console.log(
    ours.logloss < naive.logloss
      ? `→ Model má skill: log-loss o ${(naive.logloss - ours.logloss).toFixed(4)} pod konstantou.`
      : `⚠ Model NEPŘEKONÁVÁ konstantní odhad – něco je špatně.`
  );
  console.log(
    `Ostatní trhy: Přes 2.5 ${tr.over25Accuracy != null ? pct(tr.over25Accuracy) : "—"} | ` +
      `Oba skórují ${tr.bttsAccuracy != null ? pct(tr.bttsAccuracy) : "—"}`
  );

  // Kalibrace: ECE (nižší = lepší). Tady se pozná „podsebevědomost na favoritech".
  const rel = computeReliability(usable);
  console.log("\n=== Kalibrace (ECE, nižší = lepší) ===");
  for (const [label, c] of [
    ["1X2", rel.outcome],
    ["Přes 2.5", rel.over25],
    ["Oba skórují", rel.btts],
  ] as const) {
    const ece = c.ece;
    console.log(
      `${label.padEnd(12)} ECE ${ece != null ? ece.toFixed(4) : "—"}  (n=${c.n})` +
        (ece != null && ece > 0.05 ? "  ⚠ znatelně mimo" : "")
    );
  }
  // Kalibrační křivka 1X2 po koších: tady je vidět stlačení ke středu (podsebevědomost
  // na favoritech = predikováno < skutečnost v horních koších).
  console.log("\n1X2 po koších (predikováno → skutečnost):");
  for (const b of rel.outcome.bins) {
    if (b.count < 30 || b.avgPredicted == null || b.observed == null) continue;
    const delta = b.observed - b.avgPredicted;
    const mark = delta > 0.03 ? " ⬆ podstřeleno" : delta < -0.03 ? " ⬇ přestřeleno" : "";
    console.log(
      `  ${pct(b.lower).padStart(6)}–${pct(b.upper).padEnd(6)} ` +
        `${pct(b.avgPredicted).padStart(7)} → ${pct(b.observed).padStart(7)}  (n=${b.count})${mark}`
    );
  }

  // Fit post-parametrů na TÉTO historii (ne na 62 zápasech z MS).
  console.log("\n=== Fit post-parametrů (nad backtestem) ===");
  const rho = fitRho(usable);
  console.log(
    `Dixon–Coles ρ: ${rho.rho}  (LL=${rho.logLik.toFixed(1)}) | dnes v predict.ts: ${PREDICT_PARAMS.rho}`
  );
  const sh = fitSharpen(usable);
  console.log(
    `Zostření λ:    s=${sh.best.toFixed(2)} → log-loss ${sh.baseline.logloss.toFixed(4)} → ` +
      `${sh.bestScore.logloss.toFixed(4)} | dnes: ${PREDICT_PARAMS.sharpen}`
  );
  if (sh.atGridEdge) {
    console.log("⚠ Optimum na hranici gridu → model je strukturálně stlačený (viz λ), ne jen „málo zostřený“.");
  }
  console.log(
    "\nPozn.: backtest jede BEZ xG (to je 1 volání/zápas) → produkční λ má navíc xG složku."
  );
}

main().catch((e) => {
  console.error("❌ Backtest selhal:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
