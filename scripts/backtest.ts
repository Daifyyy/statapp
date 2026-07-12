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
import { DEFAULT_TUNING, gridProbs, PREDICT_PARAMS } from "../lib/stats/predict.ts";
import type { PredictionRow } from "../lib/types.ts";
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
const noStats = process.argv.includes("--no-stats");

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
const over25Hit = (r: PredictionRow) => r.homeGoals! + r.awayGoals! >= 3;
const bttsHit = (r: PredictionRow) => r.homeGoals! > 0 && r.awayGoals! > 0;

/** `--ratings` / `--ratings=halfLifeDays,shrinkMatches,iterations` (C2). */
function ratingsFromArgs():
  | { halfLifeDays: number; shrinkMatches: number; xgWeight: number; iterations: number }
  | undefined {
  const flag = process.argv.find((a) => a === "--ratings" || a.startsWith("--ratings="));
  if (!flag) return undefined;
  const [hl, k, it] = flag.includes("=") ? nums(flag.split("=")[1]) : [];
  return {
    halfLifeDays: hl ?? 180,
    shrinkMatches: k ?? 4,
    xgWeight: DEFAULT_TUNING.xgWeight,
    iterations: it ?? 5,
  };
}

/** Log-loss + Brier binárního trhu (Přes 2.5 / oba skórují) nad odehranými řádky. */
function binaryScore(
  rows: PredictionRow[],
  prob: (r: PredictionRow) => number,
  hit: (r: PredictionRow) => boolean
): { logloss: number; brier: number } {
  let ll = 0;
  let brier = 0;
  let n = 0;
  for (const r of rows) {
    if (r.homeGoals == null || r.awayGoals == null) continue;
    const p = prob(r);
    const y = hit(r) ? 1 : 0;
    ll += -Math.log(Math.max(y ? p : 1 - p, 1e-9));
    brier += (p - y) ** 2;
    n++;
  }
  return n ? { logloss: ll / n, brier: brier / n } : { logloss: 0, brier: 0 };
}

type TeamMetrics = Partial<Record<Metric, number>>;
type StatsFile = Record<string, { home: TeamMetrics; away: TeamMetrics }>;

/**
 * Přilepí k zápasům per-zápas statistiky (xG, střely) z `npm run backfill-stats`, pokud
 * jsou stažené. `--no-stats` je vypne → tímtéž během se dá změřit, co xG modelu přidává.
 */
function attachStats(history: HistoryMatch[], league: number, season: number): void {
  const file = join(CACHE_DIR, `stats-${league}-${season}.json`);
  if (noStats || !existsSync(file)) return;
  const stats = JSON.parse(readFileSync(file, "utf8")) as StatsFile;
  for (const m of history) {
    const s = stats[String(m.fixtureId)];
    if (!s) continue;
    m.homeMetrics = s.home;
    m.awayMetrics = s.away;
  }
}

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
      attachStats(rows, league, season);
      history.push(...rows);
    }
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  const withStats = history.filter((m) => m.homeMetrics?.XG != null).length;
  console.log(
    `Historie: ${history.length} odehraných zápasů ` +
      `(${fetched} volání API, zbytek z .cache/backtest)`
  );
  console.log(
    noStats
      ? "Statistiky (xG, střely): VYPNUTÉ (--no-stats) → model jede jen z gólů."
      : `Statistiky s xG: ${withStats} zápasů` +
          (withStats === 0 ? "  (spusť `npm run backfill-stats`)" : "")
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

  // Grid útlumu SOUČTU λ (`--grid-total`): opravuje Over 2.5 / BTTS, 1X2 nechává být.
  // Ukazuje všechny tři trhy najednou, aby bylo vidět, že se 1X2 nerozbíjí.
  if (process.argv.includes("--grid-total")) {
    console.log("\n=== Grid totalSpread (útlum rozptylu součtu λ) ===");
    console.log("t      1X2 LL   O2.5 LL  O2.5 ECE  BTTS LL  BTTS ECE");
    for (const t of [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const r = backtest(history, {
        seasons,
        minMatches,
        tuning: { ...DEFAULT_TUNING, totalSpread: t },
      }).filter((x) => x.available);
      const rel = computeReliability(r);
      const o = binaryScore(r, (x) => x.over25, (x) => x.homeGoals! + x.awayGoals! >= 3);
      const b = binaryScore(r, (x) => x.bttsYes, (x) => x.homeGoals! > 0 && x.awayGoals! > 0);
      console.log(
        `${t.toFixed(2)}   ${scoreProbs(r, ourProbs).logloss.toFixed(4)}   ` +
          `${o.logloss.toFixed(4)}   ${(rel.over25.ece ?? 0).toFixed(4)}    ` +
          `${b.logloss.toFixed(4)}   ${(rel.btts.ece ?? 0).toFixed(4)}`
      );
    }
    console.log("(vše nižší = lepší; t=1.00 je současný model)");
    return;
  }

  // Grid Dixon–Coles ρ (`--grid-rho`): ρ řídí nízká skóre (0:0, 1:0, 0:1, 1:1) → nejvíc
  // hýbe právě remízami a BTTS. Přepočítává se z uložených λ (jako `npm run reprice`),
  // takže backtest běží jen jednou.
  if (process.argv.includes("--grid-rho")) {
    const base = backtest(history, { seasons, minMatches }).filter((r) => r.available);
    console.log("\n=== Grid Dixon–Coles ρ (přepočet z λ) ===");
    console.log("ρ        1X2 LL   O2.5 LL  BTTS LL  BTTS ECE");
    for (const rho of [0.0, -0.03, -0.06, -0.1, -0.14, -0.18]) {
      const rows = base.map((r) => {
        const g = gridProbs(r.lambdaHome, r.lambdaAway, { rho, sharpen: 1 });
        return { ...r, homeWin: g.homeWin, draw: g.draw, awayWin: g.awayWin, over25: g.over25, bttsYes: g.bttsYes };
      });
      const b = binaryScore(rows, (x) => x.bttsYes, bttsHit);
      console.log(
        `${rho.toFixed(2).padEnd(8)} ${scoreProbs(rows, ourProbs).logloss.toFixed(4)}   ` +
          `${binaryScore(rows, (x) => x.over25, over25Hit).logloss.toFixed(4)}   ` +
          `${b.logloss.toFixed(4)}   ${(computeReliability(rows).btts.ece ?? 0).toFixed(4)}`
      );
    }
    console.log(`(dnes ρ=${PREDICT_PARAMS.rho}; konstanta BTTS = 0.6888)`);
    return;
  }

  // Grid `--grid-btts`: kolik váhy má dostat TÝMOVÁ frekvence skórování (`scoringStrength`)
  // v odhadu „oba skórují". 0 = ignoruj tým a ber ligovou frekvenci (≈ konstanta). Když
  // optimum vyjde 0, znamená to, že v týmových frekvencích **žádný signál není**.
  if (process.argv.includes("--grid-btts")) {
    console.log("\n=== Grid scoringStrength (váha týmové frekvence v BTTS) ===");
    console.log("s      BTTS LL   BTTS ECE");
    for (const s of [0, 0.15, 0.3, 0.5, 0.75, 1.0]) {
      const r = backtest(history, {
        seasons,
        minMatches,
        tuning: { ...DEFAULT_TUNING, scoringStrength: s },
      }).filter((x) => x.available);
      console.log(
        `${s.toFixed(2).padEnd(6)} ${binaryScore(r, (x) => x.bttsYes, bttsHit).logloss.toFixed(4)}    ` +
          `${(computeReliability(r).btts.ece ?? 0).toFixed(4)}`
      );
    }
    console.log("(konstanta 54.7 % → 0.6888; BTTS z Poissonovy mřížky → 0.6920)");
    return;
  }

  // Grid váhy xG (`--grid-xg`): 0 = jen góly, 1 = jen xG. Platí pro obě strany λ
  // (útok = XG, obrana = XG_AGAINST). Odpovídá na to, jestli se ta 3 500 volání vyplatila.
  if (process.argv.includes("--grid-xg")) {
    console.log("\n=== Grid váhy xG (0 = jen góly, 1 = jen xG) ===");
    console.log("w      1X2 LL   přesnost  O2.5 LL  1X2 ECE");
    for (const w of [0, 0.25, 0.5, 0.75, 1.0]) {
      const r = backtest(history, {
        seasons,
        minMatches,
        tuning: { ...DEFAULT_TUNING, xgWeight: w },
      }).filter((x) => x.available);
      const s = scoreProbs(r, ourProbs);
      console.log(
        `${w.toFixed(2).padEnd(6)} ${s.logloss.toFixed(4)}   ${pct(s.accuracy).padEnd(9)} ` +
          `${binaryScore(r, (x) => x.over25, over25Hit).logloss.toFixed(4)}   ` +
          `${(computeReliability(r).outcome.ece ?? 0).toFixed(4)}`
      );
    }
    return;
  }

  // Grid ratingů (`--grid-ratings`): poločas paměti × shrinkage. Sleduj log-loss I ECE –
  // ratingy zvedají skill, ale můžou model udělat přesebevědomým.
  if (process.argv.includes("--grid-ratings")) {
    console.log("\n=== Grid ratingů (C2): poločas [dny] × shrinkage ===");
    console.log("hl\\k      2                4                8               12");
    for (const hl of [90, 120, 180, 270, 365]) {
      const cells: string[] = [];
      for (const k of [2, 4, 8, 12]) {
        const r = backtest(history, {
          seasons,
          minMatches,
          ratings: {
            halfLifeDays: hl,
            shrinkMatches: k,
            xgWeight: DEFAULT_TUNING.xgWeight,
            iterations: 5,
          },
        }).filter((x) => x.available);
        const s = scoreProbs(r, ourProbs);
        const ece = computeReliability(r).outcome.ece ?? 0;
        cells.push(`${s.logloss.toFixed(4)}/${ece.toFixed(3)}`.padStart(17));
      }
      console.log(`${String(hl).padEnd(8)}${cells.join("")}`);
    }
    console.log("(log-loss/ECE; nižší = lepší. Okenní model: 1.0116/0.008)");
    return;
  }

  // `--tune=k,s[,t]` = jednorázový běh s konkrétními parametry λ (bez nich produkční default).
  const tuneArg = arg("tune");
  const tuning = tuneArg
    ? {
        shrinkMatches: nums(tuneArg)[0],
        strength: nums(tuneArg)[1],
        totalSpread: nums(tuneArg)[2] ?? DEFAULT_TUNING.totalSpread,
        scoringStrength: nums(tuneArg)[3] ?? DEFAULT_TUNING.scoringStrength,
        xgWeight: nums(tuneArg)[4] ?? DEFAULT_TUNING.xgWeight,
      }
    : undefined;
  if (tuning) console.log(`Ladění λ: ${JSON.stringify(tuning)}`);

  // `--ratings[=halfLife,shrink,iter]` = síly s korekcí na soupeře a časovým útlumem (C2)
  // místo okenních průměrů. Bez přepínače jede dosavadní model → dvojice běhů měří rozdíl.
  const ratings = ratingsFromArgs();
  if (ratings) console.log(`Ratingy (C2): ${JSON.stringify(ratings)}`);

  console.time("backtest");
  const rows = backtest(history, { seasons, minMatches, tuning, ratings });
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

  const settled = usable.filter((r) => r.homeGoals != null && r.awayGoals != null);
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

  // Binární trhy vs. ZÁKLADNÍ MÍRA (konstanta = jak často jev v datech nastal). U 1X2 je
  // laťkou naivní rozdaj, tady základní míra – model, který ji nepřekoná, nepřidává nic.
  console.log("\n=== Binární trhy vs. základní míra (log-loss, nižší = lepší) ===");
  for (const [label, prob, hit] of [
    ["Přes 2.5   ", (r: PredictionRow) => r.over25, over25Hit],
    ["Oba skórují", (r: PredictionRow) => r.bttsYes, bttsHit],
  ] as const) {
    const rate = settled.filter(hit).length / settled.length;
    const model = binaryScore(usable, prob, hit);
    const base = binaryScore(usable, () => rate, hit);
    const d = base.logloss - model.logloss;
    console.log(
      `${label}  model ${model.logloss.toFixed(4)}  |  konstanta ${pct(rate)} → ${base.logloss.toFixed(4)}  ` +
        (d > 0.001
          ? `→ ✅ model přidává ${d.toFixed(4)}`
          : `→ ⚠ model NEPŘIDÁVÁ nic (rozdíl ${d.toFixed(4)})`)
    );
  }

  // Úroveň gólů: sedí vůbec λ? (Systematické vychýlení součtu λ se přelije přímo do
  // Over 2.5 a BTTS – dřív než se řeší tvar rozdělení, musí sedět jeho střed.)
  const avg = (f: (r: (typeof settled)[number]) => number) =>
    settled.reduce((a, r) => a + f(r), 0) / settled.length;
  console.log("\n=== Úroveň gólů (λ vs. skutečnost) ===");
  console.log(
    `⌀ λ celkem:     ${avg((r) => r.lambdaHome + r.lambdaAway).toFixed(3)}  ` +
      `| ⌀ skutečné góly: ${avg((r) => r.homeGoals! + r.awayGoals!).toFixed(3)}`
  );
  console.log(
    `⌀ P(Přes 2.5):  ${pct(avg((r) => r.over25))}  ` +
      `| skutečně přes 2.5: ${pct(avg((r) => (r.homeGoals! + r.awayGoals! >= 3 ? 1 : 0)))}`
  );
  console.log(
    `⌀ P(oba skórují): ${pct(avg((r) => r.bttsYes))}  ` +
      `| skutečně oba skórovali: ${pct(
        avg((r) => (r.homeGoals! > 0 && r.awayGoals! > 0 ? 1 : 0))
      )}`
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
  // Křivky po koších: tady je vidět TVAR chyby – vychýlení (celá křivka posunutá) vs.
  // stlačení ke středu (nízké koše podstřelené, vysoké přestřelené = model si nevěří).
  for (const [label, curve] of [
    ["1X2", rel.outcome],
    ["Přes 2.5", rel.over25],
    ["Oba skórují", rel.btts],
  ] as const) {
    console.log(`\n${label} po koších (predikováno → skutečnost):`);
    for (const b of curve.bins) {
      if (b.count < 30 || b.avgPredicted == null || b.observed == null) continue;
      const delta = b.observed - b.avgPredicted;
      const mark = delta > 0.03 ? " ⬆ podstřeleno" : delta < -0.03 ? " ⬇ přestřeleno" : "";
      console.log(
        `  ${pct(b.lower).padStart(6)}–${pct(b.upper).padEnd(6)} ` +
          `${pct(b.avgPredicted).padStart(7)} → ${pct(b.observed).padStart(7)}  (n=${b.count})${mark}`
      );
    }
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
