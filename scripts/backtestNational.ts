// Offline backtest REPREZENTACÍ – protějšek `npm run backtest` (kluby).
//
// Proč: u reprezentací jsme model nikdy neměřili. A je u nich podezření na **strukturální**
// chybu, ne jen šum: λ srovnává góly Portugalska (nastřílené v UEFA kvalifikaci) s góly
// Uzbekistánu (nastřílenými v AFC), jako by pocházely ze stejného rozdělení. Než začneme
// zavádět globální ratingy, musíme vědět, jak špatné to dnes je.
//
// Data: `/fixtures?league=&season=` = **1 volání na soutěž a sezónu** (kvalifikace všech šesti
// konfederací + Liga národů + velké turnaje + přáteláky). Cache v `.cache/backtest/nat-*.json`
// → další běhy offline. xG se netahá (u reprezentací ho API většinou nemá).
//
// Spuštění: npm run backtest-national
//           npm run backtest-national -- --from=2024-01-01 --minMatches=6 --refresh
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchLeagueSeasonFixtures,
  FINISHED_STATUSES,
} from "../lib/data/apiFootball.ts";
import { fullTimeGoals } from "../lib/data/fixtures.ts";
import {
  NATIONAL_TOURNAMENT_LEAGUE_IDS,
  NATIONAL_HOME_AWAY_LEAGUE_IDS,
  CONFEDERATIONS,
} from "../lib/data/catalog.ts";
import {
  backtestNational,
  PREDICTED_NATIONAL,
  type NationalMatch,
} from "../lib/picks/nationalBacktest.ts";
import { NAIVE_PROBS } from "../lib/picks/backtest.ts";
import { computeReliability } from "../lib/picks/reliability.ts";
import {
  computeTrackRecord,
  ourProbs,
  scoreProbs,
  type ProbPick,
} from "../lib/picks/trackRecord.ts";
import type { PredictionRow } from "../lib/types.ts";

const CACHE_DIR = join(process.cwd(), ".cache", "backtest");
const FRIENDLIES_LEAGUE = 10; // API-Football: „Friendlies" (reprezentační přáteláky)

/** Soutěže, ze kterých se skládá REPREZENTAČNÍ HISTORIE (i ty, které se nepredikují). */
const HISTORY_LEAGUES = [
  ...NATIONAL_TOURNAMENT_LEAGUE_IDS, // MS, EURO, Copa, AFCON, Asian Cup, Gold Cup
  ...NATIONAL_HOME_AWAY_LEAGUE_IDS, // Liga národů (UEFA + CONCACAF)
  ...CONFEDERATIONS.map((c) => c.wcQualLeagueId), // kvalifikace všech konfederací
  FRIENDLIES_LEAGUE,
];

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const from = arg("from") ?? "2024-01-01";
const to = arg("to") ?? "2026-12-31";
const minMatches = Number(arg("minMatches") ?? 0);
const refresh = process.argv.includes("--refresh");
const seasons = [2022, 2023, 2024, 2025, 2026];

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const naivePick: ProbPick = () => NAIVE_PROBS;

async function loadSeason(league: number, season: number): Promise<NationalMatch[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `nat-${league}-${season}.json`);
  if (!refresh && existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8")) as NationalMatch[];
  }
  let raw;
  try {
    raw = await fetchLeagueSeasonFixtures(league, season);
  } catch {
    writeFileSync(file, "[]"); // sezóna neexistuje (turnaj se nekonal) → nezkoušet znovu
    return [];
  }
  const rows: NationalMatch[] = [];
  for (const f of raw) {
    if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
    const ft = fullTimeGoals(f); // skóre po 90 min (turnaje mají prodloužení!)
    if (!ft) continue;
    rows.push({
      fixtureId: f.fixture.id,
      date: f.fixture.date,
      leagueId: league,
      friendly: league === FRIENDLIES_LEAGUE,
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

/** Log-loss binárního trhu (Přes 2.5 / oba skórují). */
function binaryScore(
  rows: PredictionRow[],
  prob: (r: PredictionRow) => number,
  hit: (r: PredictionRow) => boolean
): number {
  let ll = 0;
  let n = 0;
  for (const r of rows) {
    if (r.homeGoals == null || r.awayGoals == null) continue;
    const p = prob(r);
    ll += -Math.log(Math.max(hit(r) ? p : 1 - p, 1e-9));
    n++;
  }
  return n ? ll / n : 0;
}

async function main() {
  const history: NationalMatch[] = [];
  let calls = 0;
  for (const league of HISTORY_LEAGUES) {
    for (const season of seasons) {
      const file = join(CACHE_DIR, `nat-${league}-${season}.json`);
      const cached = !refresh && existsSync(file);
      const rows = await loadSeason(league, season);
      if (!cached) calls++;
      history.push(...rows);
    }
  }
  history.sort((a, b) => a.date.localeCompare(b.date));

  const friendlies = history.filter((m) => m.friendly).length;
  const predictable = history.filter(
    (m) => PREDICTED_NATIONAL(m.leagueId) && m.date >= from && m.date <= to
  ).length;
  console.log(
    `Historie: ${history.length} reprezentačních zápasů ` +
      `(${friendlies} přáteláků) | ${calls} volání API, zbytek z .cache/backtest`
  );
  console.log(`Predikovatelných (turnaje + Liga národů, ${from}–${to}): ${predictable}`);

  // `--ratings[=halfLifeDays,shrink,friendlyWeight]` = GLOBÁLNÍ ratingy (jeden pool všech
  // reprezentací) místo okenních průměrů. Bez přepínače jede současný model.
  const rFlag = process.argv.find((a) => a === "--ratings" || a.startsWith("--ratings="));
  const [hl, shrink, fw] = rFlag?.includes("=")
    ? rFlag.split("=")[1].split(",").map(Number)
    : [];
  const ratings = rFlag
    ? {
        halfLifeDays: hl ?? 540,
        shrinkMatches: shrink ?? 4,
        xgWeight: 0, // reprezentace xG nemají
        iterations: 5,
      }
    : undefined;
  const friendlyWeight = fw ?? 0.5;
  if (ratings) {
    console.log(
      `Globální ratingy: poločas ${ratings.halfLifeDays} d, shrinkage ${ratings.shrinkMatches}, ` +
        `váha přáteláku ${friendlyWeight}`
    );
  }

  // Grid globálních ratingů: poločas × shrinkage (a zvlášť váha přáteláků).
  if (process.argv.includes("--grid")) {
    console.log("\n=== Grid globálních ratingů (log-loss/ECE) ===");
    console.log("hl\\k        2                4                8");
    for (const h of [270, 365, 540, 730, 1095]) {
      const cells: string[] = [];
      for (const k of [2, 4, 8]) {
        const r = backtestNational(history, {
          from,
          to,
          minMatches,
          ratings: { halfLifeDays: h, shrinkMatches: k, xgWeight: 0, iterations: 5 },
          friendlyWeight,
        }).filter((x) => x.available);
        const s = scoreProbs(r, ourProbs);
        const e = computeReliability(r).outcome.ece ?? 0;
        cells.push(`${s.logloss.toFixed(4)}/${e.toFixed(3)}`.padStart(17));
      }
      console.log(`${String(h).padEnd(10)}${cells.join("")}`);
    }
    console.log("\nVáha přáteláku (při hl=540, k=4):");
    for (const w of [0, 0.25, 0.5, 0.75, 1]) {
      const r = backtestNational(history, {
        from,
        to,
        minMatches,
        ratings: { halfLifeDays: 540, shrinkMatches: 4, xgWeight: 0, iterations: 5 },
        friendlyWeight: w,
      }).filter((x) => x.available);
      console.log(`  w=${w.toFixed(2)}  log-loss ${scoreProbs(r, ourProbs).logloss.toFixed(4)}`);
    }
    console.log("(současný okenní model: 1.0182/0.024; naivní konstanta 1.0789)");
    return;
  }

  const rows = backtestNational(history, {
    from,
    to,
    minMatches,
    ratings,
    friendlyWeight,
  });
  const usable = rows.filter((r) => r.available);
  console.log(`\nPredikováno: ${rows.length} | s dostupnou predikcí: ${usable.length}`);
  if (usable.length === 0) {
    console.log("Nic k vyhodnocení.");
    return;
  }

  const ours = scoreProbs(usable, ourProbs);
  const naive = scoreProbs(usable, naivePick);
  const tr = computeTrackRecord(usable);

  console.log("\n=== Kvalita predikcí (1X2) ===");
  console.log(`              náš model      naivní konstanta`);
  console.log(`přesnost:     ${pct(ours.accuracy).padEnd(14)} ${pct(naive.accuracy)}`);
  console.log(`Brier:        ${ours.brier.toFixed(4).padEnd(14)} ${naive.brier.toFixed(4)}`);
  console.log(`log-loss:     ${ours.logloss.toFixed(4).padEnd(14)} ${naive.logloss.toFixed(4)}  (nižší = lepší)`);
  console.log(
    ours.logloss < naive.logloss
      ? `→ Model má skill: log-loss o ${(naive.logloss - ours.logloss).toFixed(4)} pod konstantou.`
      : `⚠ Model NEPŘEKONÁVÁ konstantní odhad.`
  );

  const over = (r: PredictionRow) => r.homeGoals! + r.awayGoals! >= 3;
  const btts = (r: PredictionRow) => r.homeGoals! > 0 && r.awayGoals! > 0;
  const rate = (f: (r: PredictionRow) => boolean) =>
    usable.filter(f).length / usable.length;
  console.log("\n=== Binární trhy vs. základní míra ===");
  for (const [label, prob, hit] of [
    ["Přes 2.5   ", (r: PredictionRow) => r.over25, over],
    ["Oba skórují", (r: PredictionRow) => r.bttsYes, btts],
  ] as const) {
    const base = rate(hit);
    const model = binaryScore(usable, prob, hit);
    const constant = binaryScore(usable, () => base, hit);
    console.log(
      `${label}  model ${model.toFixed(4)}  |  konstanta ${pct(base)} → ${constant.toFixed(4)}  ` +
        (constant - model > 0.001 ? "✅" : "⚠ nepřidává nic")
    );
  }
  console.log(
    `Přesnost: Přes 2.5 ${tr.over25Accuracy != null ? pct(tr.over25Accuracy) : "—"} | ` +
      `Oba skórují ${tr.bttsAccuracy != null ? pct(tr.bttsAccuracy) : "—"}`
  );

  const rel = computeReliability(usable);
  console.log("\n=== Kalibrace (ECE) ===");
  for (const [label, c] of [
    ["1X2", rel.outcome],
    ["Přes 2.5", rel.over25],
    ["Oba skórují", rel.btts],
  ] as const) {
    console.log(
      `${label.padEnd(12)} ECE ${c.ece != null ? c.ece.toFixed(4) : "—"}  (n=${c.n})` +
        (c.ece != null && c.ece > 0.05 ? "  ⚠ znatelně mimo" : "")
    );
  }
  console.log("\n1X2 po koších (predikováno → skutečnost):");
  for (const b of rel.outcome.bins) {
    if (b.count < 20 || b.avgPredicted == null || b.observed == null) continue;
    const d = b.observed - b.avgPredicted;
    console.log(
      `  ${pct(b.lower).padStart(6)}–${pct(b.upper).padEnd(6)} ` +
        `${pct(b.avgPredicted).padStart(7)} → ${pct(b.observed).padStart(7)}  (n=${b.count})` +
        (d > 0.03 ? " ⬆ podstřeleno" : d < -0.03 ? " ⬇ přestřeleno" : "")
    );
  }
}

main().catch((e) => {
  console.error("❌ Backtest selhal:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
