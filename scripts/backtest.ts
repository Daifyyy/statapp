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
import { CLUB_LEAGUES } from "../lib/data/catalog.ts";
import { backtest, NAIVE_PROBS, type HistoryMatch } from "../lib/picks/backtest.ts";
import { DEFAULT_TUNING, gridProbs, PREDICT_PARAMS } from "../lib/stats/predict.ts";
import type { PredictionRow } from "../lib/types.ts";
import { fitCalibration, fitRho, fitSharpen } from "../lib/picks/fit.ts";
import { computeReliability } from "../lib/picks/reliability.ts";
import {
  computeTrackRecord,
  ourProbs,
  scoreProbs,
  type ProbPick,
} from "../lib/picks/trackRecord.ts";
import type { MatchOddsRecord } from "../lib/picks/oddsDataset.ts";
import { computeMarketBenchmark } from "../lib/picks/market.ts";
import { flatBets, summarizePnl, type PriceLevel } from "../lib/picks/pnl.ts";
import {
  backtestCorners,
  cornerCalibration,
  dispersion,
  pearsonDispersion,
  DEFAULT_CORNER_TUNING,
  type CornerRow,
} from "../lib/picks/corners.ts";
import {
  teamTotalCalibration,
  teamTotalDispersion,
  teamTotalLevel,
  type TotalSide,
} from "../lib/picks/teamTotals.ts";
import {
  computeSupremacyDiagnostic,
  marketView,
  type SupremacyRow,
} from "../lib/picks/asianHandicap.ts";
import {
  backtestCards,
  cardCalibration,
  cardCount,
  refereeSpread,
  DEFAULT_CARD_TUNING,
  type CardRow,
  type CardTuning,
} from "../lib/picks/cards.ts";

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
const noOdds = process.argv.includes("--no-odds");

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
      // Rozhodčí přímo z `/fixtures` – **0 volání navíc**, je v téže odpovědi. Pokrytí je
      // nesrovnatelně lepší než u football-data (~100 % vs 29 %) a hlavně zahrnuje ligy,
      // které football-data nemá vůbec (včetně Fortuna ligy). Vstup do modelu karet.
      ...(f.fixture.referee ? { referee: f.fixture.referee } : {}),
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

/**
 * Přilepí zavírací kurzy z `npm run import-odds` (sidecar `odds-<liga>-<sezóna>.json`).
 * Bez nich backtest měří jen „jsme lepší než hádání"; s nimi teprve „porazíme trh".
 *
 * **Rohy z téhož souboru se přilepují i při `--no-odds`**: `HC`/`AC` jsou skutečné
 * výsledky zápasu, ne ceny. Kdyby je vypínal přepínač o kurzech, běh `--corners --no-odds`
 * by tiše neměřil nic – a přesně takhle selhávají best-effort cesty (viz `fetchOdds`).
 */
function attachOdds(history: HistoryMatch[], league: number, season: number): void {
  const file = join(CACHE_DIR, `odds-${league}-${season}.json`);
  if (!existsSync(file)) return;
  const odds = JSON.parse(readFileSync(file, "utf8")) as Record<string, MatchOddsRecord>;
  for (const m of history) {
    const o = odds[String(m.fixtureId)];
    if (!o) continue;
    if (!noOdds) m.odds = o;
    if (o.corners) {
      m.homeMetrics = { ...m.homeMetrics, CORNERS: o.corners.home };
      m.awayMetrics = { ...m.awayMetrics, CORNERS: o.corners.away };
    }
    // Karty a rozhodčí jsou ze stejného důvodu jako rohy MIMO `noOdds`: jsou to
    // skutečnosti ze zápasu, ne ceny. `--cards --no-odds` musí měřit normálně.
    if (o.facts?.cards) {
      const c = o.facts.cards;
      m.homeMetrics = { ...m.homeMetrics, CARDS: cardCount(c.homeYellow, c.homeRed) };
      m.awayMetrics = { ...m.awayMetrics, CARDS: cardCount(c.awayYellow, c.awayRed) };
    }
    // Fauly – vstup do modelu karet vedle karet samotných (jich je ~11 na tým a zápas
    // proti ~2 kartám, takže nesou tutéž informaci s menším šumem).
    if (o.facts?.fouls) {
      m.homeMetrics = { ...m.homeMetrics, FOULS: o.facts.fouls.home };
      m.awayMetrics = { ...m.awayMetrics, FOULS: o.facts.fouls.away };
    }
    // Jen jako ZÁLOHA: primární zdroj jmen sudích je `/fixtures` (viz `loadSeason`),
    // který pokrývá skoro vše. Jména se stejně sjednocují `normalizeRefereeName`,
    // takže se dva zdroje nemůžou rozejít na dvě identity téhož rozhodčího.
    if (!m.referee && o.facts?.referee) m.referee = o.facts.referee;
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
      attachOdds(rows, league, season);
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

  // ── ASIJSKÝ HENDIKEP (`--ah`) ───────────────────────────────────────────────────
  // Rozklad naší chyby proti trhu na dvě nezávislé osy: PŘEVAHA (kdo je lepší) a SOUČET
  // (kolik padne gólů). 1X2 log-loss řekne jen „ztrácíme 0.048", ne čím – a přitom se ty
  // dvě osy v modelu ladí každá jinak (`dampenTotal` hýbe součtem a rozdíl drží).
  //
  // Proč AH: marže ~2 %, de-vig je u dvoucestného trhu přesný (žádná volba metody) a
  // výstup je SPOJITÝ → regrese na skutečný rozdíl gólů má řádově větší sílu než měření
  // nad diskrétním V/R/P. Vše offline z `.cache/backtest` (0 volání API).
  if (process.argv.includes("--ah")) {
    const rows = backtest(history, { seasons, minMatches }).filter(
      (r) => r.available && r.homeGoals != null && r.awayGoals != null
    );
    const byId = new Map(history.map((m) => [m.fixtureId, m]));

    const sup: SupremacyRow[] = [];
    const byLeague = new Map<number, SupremacyRow[]>();
    let sharpPrice = 0;
    let avgPrice = 0;
    let missingAh = 0;
    let missingOu = 0;
    let inverseFailed = 0;

    for (const r of rows) {
      const o = byId.get(r.fixtureId)?.odds;
      // Sharp linie první, průměr trhu jako záloha – a rovnou se počítá, kolik je čeho,
      // ať se výsledek nedá přečíst bez vědomí, z jaké ceny vznikl.
      const ah = o?.ah?.pinnacle ?? o?.ah?.average;
      const ou = o?.ou25?.pinnacle ?? o?.ou25?.average;
      if (!o?.ah || !ah) {
        missingAh++;
        continue;
      }
      if (!ou) {
        missingOu++;
        continue;
      }
      const view = marketView(o.ah.line, ah.home, ah.away, ou.over, ou.under);
      if (!view) {
        inverseFailed++;
        continue;
      }
      if (o.ah.pinnacle) sharpPrice++;
      else avgPrice++;
      const row: SupremacyRow = {
        ourSupremacy: r.lambdaHome - r.lambdaAway,
        ourTotal: r.lambdaHome + r.lambdaAway,
        marketSupremacy: view.supremacy,
        marketTotal: view.total,
        actualDiff: r.homeGoals! - r.awayGoals!,
        actualTotal: r.homeGoals! + r.awayGoals!,
      };
      sup.push(row);
      const list = byLeague.get(r.leagueId);
      if (list) list.push(row);
      else byLeague.set(r.leagueId, [row]);
    }

    console.log("\n=== ASIJSKÝ HENDIKEP: rozklad naší chyby proti trhu ===");
    if (sup.length === 0) {
      console.log(
        `Žádná data. Predikováno ${rows.length} zápasů, ale bez zavíracího AH ` +
          `(${missingAh}) nebo bez Over/Under 2.5 (${missingOu}).\n` +
          "Spusť `npm run import-odds` (AH vozí jen hlavní ligy; Norsko/Dánsko/Rakousko/\n" +
          "Polsko/Švýcarsko mají ve zdroji jen 1X2). Pozor: `--no-odds` tuhle sekci vypne."
      );
      return;
    }
    const d = computeSupremacyDiagnostic(sup);
    console.log(
      `Pokrytí: ${sup.length} z ${rows.length} predikovaných zápasů ` +
        `(bez AH ${missingAh}, bez O/U ${missingOu}, inverze selhala ${inverseFailed})`
    );
    console.log(
      `Zdroj ceny: Pinnacle ${sharpPrice} / průměr trhu ${avgPrice}` +
        (avgPrice > sharpPrice ? "  ⚠ převažuje průměr trhu = zašuměnější linie" : "")
    );

    // 1) Úroveň. Trh musí vyjít prakticky nevychýlený – když ne, je špatně inverze,
    //    ne trh. Je to tedy hlavně kontrola tohohle měření samotného.
    const f3 = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(3);
    console.log("\n1) Úroveň (kontrola vychýlení – trh má vyjít na skutečnosti)");
    console.log("                    naše        trh   skutečnost");
    console.log(
      `  převaha         ${f3(d.mean.ourSupremacy).padStart(8)}   ` +
        `${f3(d.mean.marketSupremacy).padStart(8)}     ${f3(d.mean.actualDiff).padStart(8)}`
    );
    console.log(
      `  součet gólů     ${d.mean.ourTotal.toFixed(3).padStart(8)}   ` +
        `${d.mean.marketTotal.toFixed(3).padStart(8)}     ${d.mean.actualTotal.toFixed(3).padStart(8)}`
    );

    // 2) Přesnost. RMSE proti skutečnosti je hrubé (rozdíl gólů je z valné části šum),
    //    ale rozdíl mezi námi a trhem je čitelný.
    console.log("\n2) Přesnost proti skutečnosti (RMSE, nižší = blíž pravdě)");
    const gapSup = d.rmse.ourSupremacy - d.rmse.marketSupremacy;
    const gapTot = d.rmse.ourTotal - d.rmse.marketTotal;
    console.log(
      `  převaha       naše ${d.rmse.ourSupremacy.toFixed(4)} | trh ${d.rmse.marketSupremacy.toFixed(4)}` +
        `  → ${gapSup > 0 ? "trh lepší" : "MY lepší"} o ${Math.abs(gapSup).toFixed(4)}`
    );
    console.log(
      `  součet gólů   naše ${d.rmse.ourTotal.toFixed(4)} | trh ${d.rmse.marketTotal.toFixed(4)}` +
        `  → ${gapTot > 0 ? "trh lepší" : "MY lepší"} o ${Math.abs(gapTot).toFixed(4)}`
    );

    // 3) HLAVNÍ TEST. β₂ u naší odchylky od trhu je celá odpověď: kolik z toho, o co se
    //    lišíme, je pravda. Zároveň je to rovnou optimální míra smrštění (bod 5 v plánu:
    //    „model jako korekce trhu" = ber trh a posuň ho o β₂ × naši odchylku).
    const fit = (name: string, f: typeof d.supremacyFit) => {
      if (!f) {
        console.log(`  ${name}: regrese neproběhla (málo dat)`);
        return;
      }
      console.log(
        `  β₁ trh       = ${f.coef[0].toFixed(3)} ± ${f.se[0].toFixed(3)}   (t = ${f.t[0].toFixed(1)})`
      );
      console.log(
        `  β₂ odchylka  = ${f.coef[1].toFixed(3)} ± ${f.se[1].toFixed(3)}   (t = ${f.t[1].toFixed(1)})` +
          `   ${Math.abs(f.t[1]) < 2 ? "← nevýznamné" : f.t[1] > 0 ? "← NESE INFORMACI" : "← ŠKODÍ"}`
      );
      console.log(`  R² = ${f.r2.toFixed(4)}   n = ${f.n}`);
    };
    console.log("\n3) HLAVNÍ TEST: skutečný rozdíl gólů ~ tržní převaha + NAŠE ODCHYLKA od ní");
    fit("převaha", d.supremacyFit);
    console.log("\n4) Totéž na ose součtu gólů: skutečný součet ~ tržní total + naše odchylka");
    fit("součet", d.totalFit);

    // 5) Neparametricky – kdyby byl vztah nelineární, regrese by ho podcenila.
    console.log("\n5) Kvintily naší odchylky (bez předpokladu linearity)");
    console.log("  kvintil      n   ⌀ odchylka   ⌀ zbytek trhu");
    d.buckets.forEach((b, i) => {
      console.log(
        `  ${String(i + 1).padEnd(7)} ${String(b.n).padStart(6)}   ` +
          `${f3(b.deviation).padStart(10)}   ${f3(b.residual).padStart(13)}`
      );
    });
    console.log(
      "  (nese-li odchylka informaci, musí ⌀ zbytek trhu růst shora dolů spolu s odchylkou)"
    );

    // 6) Po ligách. Hypotéza, kterou to má vyvrátit nebo potvrdit: hranu spíš najdeme
    //    v TENKÉM trhu (Řecko, Skotsko, Turecko) než v Premier League, kde je sharp
    //    peněz nejvíc. Pozor na mnohonásobné testování – u 12 lig vyjde jedna „významná"
    //    náhodou, proto se vedle t tiskne i Bonferroniho práh.
    // Země samotná nestačí – Anglie má v seznamu Premier League i Championship.
    const leagueName = (id: number) => {
      const l = CLUB_LEAGUES.find((x) => x.id === id);
      return l ? `${l.country} ${l.name}` : String(id);
    };
    const entries = [...byLeague.entries()]
      .map(([id, rows]) => ({ id, rows, d: computeSupremacyDiagnostic(rows) }))
      .filter((e) => e.d.supremacyFit)
      .sort((a, b) => (b.d.supremacyFit!.coef[1] ?? 0) - (a.d.supremacyFit!.coef[1] ?? 0));
    const thr = 2.807; // Bonferroni pro ~12 souběžných testů na 5% hladině
    console.log("\n6) Po ligách (β₂ = kolik z naší odchylky je pravda)");
    console.log("  liga                            n        β₂       ±SE      t");
    for (const e of entries) {
      const f = e.d.supremacyFit!;
      const flag = Math.abs(f.t[1]) > thr ? (f.t[1] > 0 ? "  ★ přežije Bonferroni" : "  ✗ škodí") : "";
      console.log(
        `  ${leagueName(e.id).padEnd(25)} ${String(e.d.n).padStart(6)}   ` +
          `${f.coef[1].toFixed(3).padStart(7)}   ${f.se[1].toFixed(3).padStart(6)}   ` +
          `${f.t[1].toFixed(1).padStart(5)}${flag}`
      );
    }
    console.log(
      `  (samostatně |t| > 2 = 5 %, ale při ${entries.length} ligách naráz je práh |t| > ${thr})`
    );

    const b2 = d.supremacyFit?.coef[1] ?? 0;
    const t2 = d.supremacyFit?.t[1] ?? 0;
    console.log("\nVERDIKT:");
    if (Math.abs(t2) < 2) {
      console.log(
        "  Naše odchylka od trhu NENÍ statisticky odlišitelná od šumu (|t| < 2).\n" +
          "  Na téhle ose trhu nic nepřidáváme – 'value' proti zavírací lince je artefakt."
      );
    } else if (t2 < 0) {
      console.log(
        "  Naše odchylka jde systematicky ŠPATNÝM směrem (β₂ < 0).\n" +
          "  Kde se od trhu lišíme nejvíc, tam se nejvíc mýlíme – sedí to s tím, že přísnější\n" +
          "  práh hrany ROI zhoršuje. Sázet podle odchylky by bylo horší než sázet náhodně."
      );
    } else {
      console.log(
        `  Naše odchylka nese informaci (β₂ = ${b2.toFixed(3)}, t = ${t2.toFixed(1)}).\n` +
          `  Optimální použití NENÍ sázet podle našeho modelu, ale vzít tržní převahu a posunout\n` +
          `  ji o ${(b2 * 100).toFixed(0)} % naší odchylky. Zbylých ${((1 - b2) * 100).toFixed(0)} % je šum.\n` +
          `  Teprve tenhle smrštěný odhad má smysl porovnávat s cenou.`
      );
    }
    return;
  }

  // ── Model KARET (`--cards`) ─────────────────────────────────────────────────────
  // Větev otevřená nálezem z `--ah`: na ose „kolik událostí se stane" jsme skoro na
  // úrovni trhu, a u karet k tomu máme vstup, který rekreační kniha do linie často nedává
  // vůbec – ROZHODČÍHO. Krok 1 je jako u rohů **kalibrace proti skutečnosti**, ne kurzy.
  // Data zdarma a offline: football-data `HY/AY/HR/AR` + `Referee` (viz `MatchFacts`).
  if (process.argv.includes("--cards")) {
    const kt = arg("cards-tune");
    const kTuning: CardTuning = kt
      ? {
          base: { ...DEFAULT_TUNING, shrinkMatches: nums(kt)[0] },
          totalSpread: nums(kt)[1],
          varianceRatio: nums(kt)[2] ?? DEFAULT_CARD_TUNING.varianceRatio,
          refShrink: nums(kt)[3] ?? DEFAULT_CARD_TUNING.refShrink,
          refereeWeight: nums(kt)[4] ?? DEFAULT_CARD_TUNING.refereeWeight,
          foulWeight: nums(kt)[5] ?? DEFAULT_CARD_TUNING.foulWeight,
        }
      : DEFAULT_CARD_TUNING;
    if (kt)
      console.log(
        `Ladění karet: k=${kTuning.base.shrinkMatches}, t=${kTuning.totalSpread}, ` +
          `v=${kTuning.varianceRatio}, refK=${kTuning.refShrink}, ` +
          `refW=${kTuning.refereeWeight}, foulW=${kTuning.foulWeight}`
      );

    const kRows = backtestCards(history, { seasons, minMatches, tuning: kTuning });
    console.log("\n=== MODEL KARET ===");
    if (kRows.length === 0) {
      console.log(
        "Žádná data o kartách. Spusť `npm run import-odds` (karty vozí hlavní ligy;\n" +
          "Norsko/Dánsko/Rakousko/Polsko/Švýcarsko mají ve zdroji jen 1X2)."
      );
      return;
    }
    const withRef = kRows.filter((r) => r.referee).length;
    const withRefData = kRows.filter((r) => r.refereeSample > 0).length;
    console.log(`Predikováno: ${kRows.length} zápasů se skutečnými kartami`);
    console.log(
      `Rozhodčí: jméno u ${withRef} (${pct(withRef / kRows.length)}), ` +
        `z toho s historií ${withRefData} (${pct(withRefData / kRows.length)})`
    );
    console.log("Karty = žluté + červené (váha červené 1 – konvence knih se liší, viz cards.ts)");

    // 1) Úroveň λ. Systematické vychýlení se přelije do všech linií naráz.
    const avgK = (f: (r: CardRow) => number) =>
      kRows.reduce((a, r) => a + f(r), 0) / kRows.length;
    console.log("\n--- Úroveň (λ vs. skutečnost) ---");
    console.log(
      `⌀ λ celkem:  ${avgK((r) => r.lambdaTotal).toFixed(3)}   ` +
        `| ⌀ skutečné karty: ${avgK((r) => r.actualTotal).toFixed(3)}`
    );
    console.log(
      `⌀ λ domácí:  ${avgK((r) => r.lambdaHome).toFixed(3)}   ` +
        `| skutečnost: ${avgK((r) => r.actualHome).toFixed(3)}`
    );
    console.log(
      `⌀ λ hosté:   ${avgK((r) => r.lambdaAway).toFixed(3)}   ` +
        `| skutečnost: ${avgK((r) => r.actualAway).toFixed(3)}`
    );

    // 2) Tvar rozdělení – u rohů vyšla overdisperze, u karet ji čekáme taky (červená
    //    a vyhrocené derby dělají dlouhý chvost).
    const kd = dispersion(kRows);
    const kPear = pearsonDispersion(kRows);
    console.log("\n--- Tvar rozdělení (test předpokladu Poissonu) ---");
    console.log(
      `marginálně:  ⌀ ${kd.mean.toFixed(2)}  rozptyl ${kd.variance.toFixed(2)}  ` +
        `→ Var/⌀ = ${kd.ratio.toFixed(3)}`
    );
    console.log(
      `podmíněně:   Pearson ⌀(x−λ)²/λ = ${kPear.toFixed(3)}  ` +
        (kPear > 1.05
          ? "⚠ OVERDISPERZE (Poisson podstřelí chvosty → NB)"
          : kPear < 0.95
            ? "⚠ underdisperze"
            : "✅ Poisson sedí")
    );

    // 3) ROZPTYL MEZI ROZHODČÍMI – popisné číslo, kvůli kterému tahle větev vznikla.
    //    Verdikt „přidává to?" ale padne až z ablace v bodě 6, ne odsud.
    const spread = refereeSpread(kRows);
    console.log("\n--- Rozhodčí (⌀ karet na zápas, jen sudí s ≥ 20 zápasy) ---");
    if (spread.count === 0) {
      console.log("  Žádný rozhodčí s dost zápasy (zdroj jména nemá).");
    } else {
      console.log(
        `  sudích ${spread.count}  |  nejmírnější ${spread.min.toFixed(2)}  ` +
          `nejpřísnější ${spread.max.toFixed(2)}  |  ⌀ ${spread.overall.toFixed(2)}  ` +
          `sd mezi sudími ${spread.sd.toFixed(3)}`
      );
      console.log(
        `  rozpětí = ${(spread.max - spread.min).toFixed(2)} karty na zápas ` +
          `(${pct((spread.max - spread.min) / spread.overall)} průměru)`
      );
    }

    // 4) Kalibrace a log-loss po liniích. Laťkou je konstanta „vždy základní míra".
    const CARD_LINES = [2.5, 3.5, 4.5, 5.5, 6.5];
    console.log("\n--- Linie Over/Under karet (log-loss, nižší = lepší) ---");
    console.log("linie   n      model     konstanta   rozdíl     ECE     verdikt");
    for (const line of CARD_LINES) {
      const c = cardCalibration(kRows, line);
      const delta = c.baseLogloss - c.logloss;
      console.log(
        `${line.toFixed(1).padEnd(7)} ${String(c.n).padStart(5)}  ` +
          `${c.logloss.toFixed(4)}    ${c.baseLogloss.toFixed(4)}    ` +
          `${(delta >= 0 ? "+" : "") + delta.toFixed(4)}   ` +
          `${(c.ece ?? 0).toFixed(4)}  ` +
          (delta > 0.002
            ? `✅ přidává (základ ${pct(c.baseRate)})`
            : `⚠ nepřidává (základ ${pct(c.baseRate)})`)
      );
    }

    // 5) Kalibrační křivka na hlavní linii – tvar chyby.
    const kMain = cardCalibration(kRows, 4.5);
    console.log("\n--- Kalibrační křivka, linie 4.5 (predikováno → skutečnost) ---");
    for (const b of kMain.bins) {
      if (b.count < 30 || b.avgPredicted == null || b.observed == null) continue;
      const delta = b.observed - b.avgPredicted;
      const mark = delta > 0.03 ? " ⬆ podstřeleno" : delta < -0.03 ? " ⬇ přestřeleno" : "";
      console.log(
        `  ${pct(b.lower).padStart(6)}–${pct(b.upper).padEnd(6)} ` +
          `${pct(b.avgPredicted).padStart(7)} → ${pct(b.observed).padStart(7)}  (n=${b.count})${mark}`
      );
    }

    // 6) ABLACE ROZHODČÍHO – celá otázka téhle větve. Tentýž model, jen `refereeWeight = 0`
    //    (= faktor přesně 1). Rozdíl log-lossu je čistý příspěvek informace o sudím.
    //    Měří se na PODMNOŽINĚ se známým rozhodčím, jinak by se přínos rozředil zápasy,
    //    kde žádná informace navíc nebyla.
    const noRefRows = backtestCards(history, {
      seasons,
      minMatches,
      tuning: { ...kTuning, refereeWeight: 0 },
    });
    const known = new Set(kRows.filter((r) => r.refereeSample > 0).map((r) => r.fixtureId));
    const withRefSub = kRows.filter((r) => known.has(r.fixtureId));
    const noRefSub = noRefRows.filter((r) => known.has(r.fixtureId));
    console.log(
      `\n--- ABLACE: přidává rozhodčí něco? (${withRefSub.length} zápasů se známým sudím) ---`
    );
    if (withRefSub.length === 0) {
      console.log("  Nelze změřit – žádný zápas se známým rozhodčím a historií.");
    } else {
      console.log("linie   bez sudího   se sudím    rozdíl     ECE bez → se");
      let totalGain = 0;
      for (const line of CARD_LINES) {
        const a = cardCalibration(noRefSub, line);
        const b = cardCalibration(withRefSub, line);
        const gain = a.logloss - b.logloss;
        totalGain += gain;
        console.log(
          `${line.toFixed(1).padEnd(7)} ${a.logloss.toFixed(4)}      ${b.logloss.toFixed(4)}    ` +
            `${(gain >= 0 ? "+" : "") + gain.toFixed(4)}   ` +
            `${(a.ece ?? 0).toFixed(4)} → ${(b.ece ?? 0).toFixed(4)}` +
            (gain > 0.001 ? "  ✅" : gain < -0.001 ? "  ✗ škodí" : "  ~ nic")
        );
      }
      console.log(
        `  součet přes linie: ${(totalGain >= 0 ? "+" : "") + totalGain.toFixed(4)}` +
          "   (kladné = informace o sudím pomáhá)"
      );

      // Sweep shrinkage rozhodčího na TÉŽE podmnožině. Rozklad rozptylu říká, že optimum
      // má být kolem 110 zápasů (pozorované rozpětí mezi sudími je z valné části šum) –
      // tohle to ověří měřením a zároveň ukáže, jestli je optimum vnitřní.
      console.log("\n--- Sweep shrinkage rozhodčího (log-loss na linii 4.5) ---");
      console.log("refShrink   log-loss     ECE      vs. bez sudího");
      const noRefLl = cardCalibration(noRefSub, 4.5).logloss;
      for (const k of [0, 10, 25, 50, 100, 200, 400]) {
        const rows = backtestCards(history, {
          seasons,
          minMatches,
          tuning: { ...kTuning, refShrink: k, refereeWeight: 1 },
        }).filter((r) => known.has(r.fixtureId));
        const c = cardCalibration(rows, 4.5);
        const gain = noRefLl - c.logloss;
        console.log(
          `${String(k).padEnd(11)} ${c.logloss.toFixed(4)}    ${(c.ece ?? 0).toFixed(4)}   ` +
            `${(gain >= 0 ? "+" : "") + gain.toFixed(4)}${gain > 0.001 ? "  ✅" : ""}`
        );
      }
      console.log(`(bez sudího = ${noRefLl.toFixed(4)}; refShrink 0 = žádné smrštění)`);
    }

    console.log(
      "\nPozn.: měří se JEN kvalita modelu, ne ziskovost – historické kurzy na karty zdroj\n" +
        "nemá (chodí jen živě z API, marže 5–9 %). Teprve až model porazí konstantu A bude\n" +
        "kalibrovaný, má smysl snímat ceny a měřit CLV."
    );
    return;
  }

  // Grid modelu karet (`--cards-grid`): shrinkage rozhodčího × útlum rozptylu součtu λ.
  // Rozsah jde schválně až do DEGENERACE na obou osách – `t = 0` = „predikuj vždy ligový
  // průměr", `refW = 0` = „ignoruj rozhodčího". Když optimum leží až tam, není to
  // nastavení k dolazení, ale odpověď, že tam signál není (tatáž zásada jako u rohů).
  if (process.argv.includes("--cards-grid")) {
    const ts = [1.0, 0.7, 0.5, 0.3, 0.15, 0];
    const refs: { label: string; refShrink: number; refereeWeight: number }[] = [
      { label: "refW=0", refShrink: 25, refereeWeight: 0 }, // degenerace: bez rozhodčího
      { label: "k=100", refShrink: 100, refereeWeight: 1 },
      { label: "k=50", refShrink: 50, refereeWeight: 1 },
      { label: "k=25", refShrink: 25, refereeWeight: 1 },
      { label: "k=10", refShrink: 10, refereeWeight: 1 },
      { label: "k=0", refShrink: 0, refereeWeight: 1 }, // degenerace: bez smrštění
    ];
    console.log("\n=== Grid modelu karet (log-loss / ECE na linii 4.5) ===");
    console.log("sudí\\t " + ts.map((t) => t.toFixed(2).padStart(15)).join(""));
    for (const r of refs) {
      const cells: string[] = [];
      for (const t of ts) {
        const rows = backtestCards(history, {
          seasons,
          minMatches,
          tuning: {
            ...DEFAULT_CARD_TUNING,
            totalSpread: t,
            refShrink: r.refShrink,
            refereeWeight: r.refereeWeight,
          },
        });
        const c = cardCalibration(rows, 4.5);
        cells.push(`${c.logloss.toFixed(4)}/${(c.ece ?? 0).toFixed(3)}`.padStart(15));
      }
      console.log(`${r.label.padEnd(7)}${cells.join("")}`);
    }
    console.log("(log-loss/ECE, nižší = lepší; první řádek = model BEZ rozhodčího)");
    return;
  }

  // Grid váhy FAULŮ (`--cards-grid-fouls`): pomůžou data ze zápasu modelu karet?
  // Faulů je ~11 na tým a zápas proti ~2 kartám → měly by být méně zašuměný odhad téhož
  // („jak tvrdě strana hraje"), přesně jako xG proti gólům. Grid jde od 0 (jen karty)
  // do 1 (jen fauly) – obě degenerace, takže je vidět, jestli je optimum vnitřní.
  // Měří se přes VŠECHNY linie, ne jen hlavní: u overdisperze rozhoduje chvost.
  if (process.argv.includes("--cards-grid-fouls")) {
    const CARD_LINES = [2.5, 3.5, 4.5, 5.5, 6.5];
    console.log("\n=== Grid váhy faulů v modelu karet ===");
    console.log("foulW   " + CARD_LINES.map((l) => l.toFixed(1).padStart(9)).join("") + "     Σ skill");
    for (const w of [0, 0.15, 0.3, 0.5, 0.7, 1.0]) {
      const rows = backtestCards(history, {
        seasons,
        minMatches,
        tuning: { ...DEFAULT_CARD_TUNING, foulWeight: w },
      });
      const cells: string[] = [];
      let sum = 0;
      for (const line of CARD_LINES) {
        const c = cardCalibration(rows, line);
        const gain = c.baseLogloss - c.logloss;
        sum += gain;
        cells.push(((gain >= 0 ? "+" : "") + gain.toFixed(4)).padStart(9));
      }
      console.log(`${w.toFixed(2).padEnd(8)}${cells.join("")}   ${sum.toFixed(4)}`);
    }
    console.log("(zisk log-lossu nad konstantou po liniích; vyšší = lepší. 0 = jen karty, 1 = jen fauly)");
    return;
  }

  // ── Model ROHŮ (`--corners`) ────────────────────────────────────────────────────
  // Jediný nezměřený kandidát na hranu. Krok 1 je **kalibrace proti skutečným rohům**,
  // ne kurzy: dokud model neumí říct „60 %" tak, aby to nastalo v 60 %, je zbytečné se
  // ptát, jestli je ta cena dobrá. Skutečné rohy jsou v `.cache/backtest/odds-*.json`
  // (football-data, sloupce HC/AC) → celé měření je offline a zdarma.
  if (process.argv.includes("--corners")) {
    // `--corners-tune=k,t` = konkrétní parametry (fit na jedné sezóně → ověření na druhé).
    const ct = arg("corners-tune");
    const cTuning = ct
      ? {
          base: { ...DEFAULT_TUNING, shrinkMatches: nums(ct)[0] },
          totalSpread: nums(ct)[1],
          varianceRatio: nums(ct)[2] ?? DEFAULT_CORNER_TUNING.varianceRatio,
        }
      : DEFAULT_CORNER_TUNING;
    if (ct)
      console.log(
        `Ladění rohů: k=${cTuning.base.shrinkMatches}, t=${cTuning.totalSpread}, ` +
          `v=${cTuning.varianceRatio}`
      );
    const cRows = backtestCorners(history, { seasons, minMatches, tuning: cTuning });
    console.log("\n=== MODEL ROHŮ ===");
    if (cRows.length === 0) {
      console.log(
        "Žádná data o rozích. Spusť `npm run import-odds` (rohy vozí hlavní ligy;\n" +
          "Norsko/Dánsko/Rakousko je ve zdroji nemají)."
      );
      return;
    }
    console.log(`Predikováno: ${cRows.length} zápasů se skutečnými rohy`);

    // 1) Sedí vůbec úroveň λ? Systematické vychýlení se přelije do všech linií naráz,
    //    takže tohle se musí ověřit dřív než kalibrace tvaru.
    const avgC = (f: (r: CornerRow) => number) =>
      cRows.reduce((a, r) => a + f(r), 0) / cRows.length;
    console.log("\n--- Úroveň (λ vs. skutečnost) ---");
    console.log(
      `⌀ λ celkem:  ${avgC((r) => r.lambdaTotal).toFixed(3)}   ` +
        `| ⌀ skutečné rohy: ${avgC((r) => r.actualTotal).toFixed(3)}`
    );
    console.log(
      `⌀ λ domácí:  ${avgC((r) => r.lambdaHome).toFixed(3)}   ` +
        `| skutečnost: ${avgC((r) => r.actualHome).toFixed(3)}`
    );
    console.log(
      `⌀ λ hosté:   ${avgC((r) => r.lambdaAway).toFixed(3)}   ` +
        `| skutečnost: ${avgC((r) => r.actualAway).toFixed(3)}`
    );

    // 2) Platí vůbec Poissonův předpoklad? Var/⌀ > 1 = overdisperze → Poisson podstřelí
    //    chvosty, tedy přesně ty pravděpodobnosti, na které se sází.
    const d = dispersion(cRows);
    const pear = pearsonDispersion(cRows);
    console.log("\n--- Tvar rozdělení (test předpokladu Poissonu) ---");
    console.log(
      `marginálně:  ⌀ ${d.mean.toFixed(2)}  rozptyl ${d.variance.toFixed(2)}  ` +
        `→ Var/⌀ = ${d.ratio.toFixed(3)}`
    );
    // Rozhodující je PODMÍNĚNÁ disperze: marginální poměr nafukuje i rozptyl λ mezi
    // zápasy, který s tvarem rozdělení nesouvisí a NB ho neopravuje.
    console.log(
      `podmíněně:   Pearson ⌀(x−λ)²/λ = ${pear.toFixed(3)}  ` +
        (pear > 1.05
          ? "⚠ OVERDISPERZE (Poisson podstřelí chvosty → zkus NB)"
          : pear < 0.95
            ? "⚠ underdisperze"
            : "✅ Poisson sedí")
    );
    console.log(`rozdělení v tomto běhu: ${cTuning.varianceRatio === 1 ? "Poisson" : `NB (v=${cTuning.varianceRatio})`}`);

    // 3) Kalibrace a log-loss po liniích – laťkou je konstanta „vždy základní míra".
    console.log("\n--- Linie Over/Under (log-loss, nižší = lepší) ---");
    console.log("linie   n      model     konstanta   rozdíl     ECE     verdikt");
    for (const line of [8.5, 9.5, 10.5, 11.5, 12.5]) {
      const c = cornerCalibration(cRows, line);
      const delta = c.baseLogloss - c.logloss;
      console.log(
        `${line.toFixed(1).padEnd(7)} ${String(c.n).padStart(5)}  ` +
          `${c.logloss.toFixed(4)}    ${c.baseLogloss.toFixed(4)}    ` +
          `${(delta >= 0 ? "+" : "") + delta.toFixed(4)}   ` +
          `${(c.ece ?? 0).toFixed(4)}  ` +
          (delta > 0.002
            ? `✅ přidává (základ ${pct(c.baseRate)})`
            : `⚠ nepřidává (základ ${pct(c.baseRate)})`)
      );
    }

    // 4) Kalibrační křivka na hlavní linii – tady je vidět TVAR chyby.
    const main = cornerCalibration(cRows, 10.5);
    console.log("\n--- Kalibrační křivka, linie 10.5 (predikováno → skutečnost) ---");
    for (const b of main.bins) {
      if (b.count < 30 || b.avgPredicted == null || b.observed == null) continue;
      const delta = b.observed - b.avgPredicted;
      const mark = delta > 0.03 ? " ⬆ podstřeleno" : delta < -0.03 ? " ⬇ přestřeleno" : "";
      console.log(
        `  ${pct(b.lower).padStart(6)}–${pct(b.upper).padEnd(6)} ` +
          `${pct(b.avgPredicted).padStart(7)} → ${pct(b.observed).padStart(7)}  (n=${b.count})${mark}`
      );
    }

    console.log(
      "\nPozn.: tohle měří JEN kvalitu modelu, ne ziskovost – kurzy na rohy v historickém\n" +
        "zdroji nejsou (chodí jen živě z API). Teprve když model porazí konstantu A je\n" +
        "kalibrovaný, má smysl řešit ceny."
    );
    return;
  }

  // Grid modelu rohů (`--corners-grid`): shrinkage × útlum rozptylu součtu λ. Verdikt dle
  // log-lossu na hlavní linii 10.5 – u gólů přesně tenhle grid ukázal, že součet λ potřebuje
  // vlastní útlum (Over 2.5 ECE 0.054 → 0.014), takže u rohů se na to musí zeptat taky.
  if (process.argv.includes("--corners-grid")) {
    // Rozsah jde záměrně až do degenerace (`t = 0` = „vždy ligový průměr", `k = 60` =
    // „ignoruj tým"). Když optimum leží AŽ TAM, není to nastavení k dolazení – je to
    // odpověď, že týmový signál v rohách není. Grid, který to nedosáhne, tuhle odpověď
    // schová za „optimum na hranici".
    const ks = [6, 15, 30, 60];
    const ts = [1.0, 0.7, 0.5, 0.3, 0.15, 0];
    console.log("\n=== Grid modelu rohů (log-loss / ECE na linii 10.5) ===");
    console.log("k\\t   " + ts.map((t) => t.toFixed(2).padStart(15)).join(""));
    for (const k of ks) {
      const cells: string[] = [];
      for (const t of ts) {
        const r = backtestCorners(history, {
          seasons,
          minMatches,
          tuning: {
            base: { ...DEFAULT_TUNING, shrinkMatches: k },
            totalSpread: t,
            varianceRatio: DEFAULT_CORNER_TUNING.varianceRatio,
          },
        });
        const c = cornerCalibration(r, 10.5);
        cells.push(`${c.logloss.toFixed(4)}/${(c.ece ?? 0).toFixed(3)}`.padStart(15));
      }
      console.log(`${String(k).padEnd(6)}${cells.join("")}`);
    }
    const base = cornerCalibration(
      backtestCorners(history, { seasons, minMatches }),
      10.5
    );
    console.log(
      `(nižší = lepší; laťka = konstanta ${base.baseLogloss.toFixed(4)}, ` +
        `dnes k=${DEFAULT_CORNER_TUNING.base.shrinkMatches}/t=${DEFAULT_CORNER_TUNING.totalSpread})`
    );
    return;
  }

  // Grid negativně binomického rozdělení (`--corners-grid-nb`): útlum součtu λ × podmíněná
  // overdisperze. Grid je **dvourozměrný schválně** – obojí zužuje/rozšiřuje výslednou
  // pravděpodobnost, takže se můžou navzájem zastupovat a fitovat je zvlášť by dalo
  // falešné optimum. Kritérium je **součet zlepšení nad konstantou přes všech 5 linií**:
  // NB má opravovat hlavně chvosty (8.5, 12.5), což by jediná linie 10.5 neukázala.
  if (process.argv.includes("--corners-grid-nb")) {
    const LINES = [8.5, 9.5, 10.5, 11.5, 12.5];
    const skill = (rows: ReturnType<typeof backtestCorners>) => {
      let sum = 0;
      let ece = 0;
      for (const line of LINES) {
        const c = cornerCalibration(rows, line);
        sum += c.baseLogloss - c.logloss;
        ece += (c.ece ?? 0) / LINES.length;
      }
      return { sum, ece };
    };
    const ts = [0.5, 0.3, 0.15];
    const vs = [1.0, 1.05, 1.1, 1.15, 1.2, 1.3];
    console.log("\n=== Grid NB (Σ zlepšení nad konstantou přes 5 linií / ⌀ ECE) ===");
    console.log("t\\v   " + vs.map((v) => v.toFixed(2).padStart(15)).join(""));
    for (const t of ts) {
      const cells: string[] = [];
      for (const v of vs) {
        const r = backtestCorners(history, {
          seasons,
          minMatches,
          tuning: { base: DEFAULT_TUNING, totalSpread: t, varianceRatio: v },
        });
        const s = skill(r);
        cells.push(`${s.sum >= 0 ? "+" : ""}${s.sum.toFixed(4)}/${s.ece.toFixed(3)}`.padStart(15));
      }
      console.log(`${t.toFixed(2).padEnd(6)}${cells.join("")}`);
    }
    console.log(
      "(VYŠŠÍ součet = lepší, nižší ECE = lepší; v=1.00 je Poisson = dnešní stav.\n" +
        " Podmíněnou disperzi vytiskne `--corners`; dosazovat ji rovnou ale nejde – tohle je fit.)"
    );
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

  // ── TÝMOVÉ TOTALY (`--team-totals`) ─────────────────────────────────────────────
  // Marginály naší mřížky zadarmo – žádný nový model, žádná nová data. Měří se kvalita,
  // ne ziskovost: historické kurzy na týmové totaly nemáme.
  if (process.argv.includes("--team-totals")) {
    const settledRows = rows.filter((r) => r.available && r.homeGoals != null);
    console.log("\n=== TÝMOVÉ TOTALY (marginály mřížky) ===");
    if (settledRows.length === 0) {
      console.log("Nic k vyhodnocení.");
      return;
    }
    console.log(`Odehraných predikcí: ${settledRows.length}`);

    for (const side of ["home", "away"] as TotalSide[]) {
      const lvl = teamTotalLevel(settledRows, side);
      const disp = teamTotalDispersion(settledRows, side);
      console.log(`\n--- ${side === "home" ? "DOMÁCÍ" : "HOSTÉ"} ---`);
      console.log(
        `⌀ λ ${lvl.lambda.toFixed(3)}  | ⌀ skutečnost ${lvl.actual.toFixed(3)}  ` +
          `| Pearson ⌀(x−λ)²/λ = ${disp.toFixed(3)}` +
          (disp > 1.05 ? "  ⚠ overdisperze" : disp < 0.95 ? "  ⚠ underdisperze" : "  ✅")
      );
      console.log("linie   model     konstanta   rozdíl     ECE     verdikt");
      for (const line of [0.5, 1.5, 2.5]) {
        const c = teamTotalCalibration(settledRows, side, line);
        const d = c.baseLogloss - c.logloss;
        console.log(
          `${line.toFixed(1).padEnd(7)} ${c.logloss.toFixed(4)}    ${c.baseLogloss.toFixed(4)}    ` +
            `${(d >= 0 ? "+" : "") + d.toFixed(4)}   ${(c.ece ?? 0).toFixed(4)}  ` +
            (d > 0.002
              ? `✅ přidává (základ ${pct(c.baseRate)})`
              : `⚠ nepřidává (základ ${pct(c.baseRate)})`)
        );
      }
    }

    // Křivka na nejsázenější lince (0.5 = „dá tým vůbec gól?").
    console.log("\n--- Kalibrační křivka, domácí přes 0.5 (predikováno → skutečnost) ---");
    for (const b of teamTotalCalibration(settledRows, "home", 0.5).bins) {
      if (b.count < 30 || b.avgPredicted == null || b.observed == null) continue;
      const delta = b.observed - b.avgPredicted;
      const mark = delta > 0.03 ? " ⬆ podstřeleno" : delta < -0.03 ? " ⬇ přestřeleno" : "";
      console.log(
        `  ${pct(b.lower).padStart(6)}–${pct(b.upper).padEnd(6)} ` +
          `${pct(b.avgPredicted).padStart(7)} → ${pct(b.observed).padStart(7)}  (n=${b.count})${mark}`
      );
    }
    console.log(
      "\nPozn.: měří JEN kvalitu modelu. Kurzy na týmové totaly v historickém zdroji\n" +
        "nejsou (chodí jen živě z API), takže o ziskovosti tohle neříká nic."
    );
    return;
  }

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

  // ── Jediné měřítko, které u sázení rozhoduje: TRH ──────────────────────────────
  // Log-loss proti naivní konstantě říká „umíme fotbal", tohle říká „umíme vydělat".
  const oddsById = new Map(
    history.filter((m) => m.odds).map((m) => [m.fixtureId, m.odds!])
  );
  if (oddsById.size > 0) {
    const bench = computeMarketBenchmark(usable);
    console.log("\n=== Vs. TRH (zavírací linie, football-data.co.uk) ===");
    if (bench.our && bench.market) {
      const diff = bench.market.logloss - bench.our.logloss;
      console.log(
        `Společná podmnožina: ${bench.n} zápasů | průměrná marže ${(
          100 * ((bench.avgOverround ?? 1) - 1)
        ).toFixed(2)} %`
      );
      console.log(
        `log-loss:     náš ${bench.our.logloss.toFixed(4)}   trh ${bench.market.logloss.toFixed(4)}` +
          `   → ${diff >= 0 ? "vedeme" : "ztrácíme"} ${Math.abs(diff).toFixed(4)}`
      );
      console.log(
        `přesnost:     náš ${(100 * bench.our.accuracy).toFixed(1)} %      trh ${(
          100 * bench.market.accuracy
        ).toFixed(1)} %`
      );
      console.log(
        diff >= 0
          ? "→ Model je na této podmnožině lepší než zavírací linie. Ověř na hold-out sezóně, než tomu uvěříš."
          : "→ Trh je lepší. Kladné EV z vlastního modelu tedy čekat nelze (viz ROI níže)."
      );
    }

    // ROI ploché strategie na třech cenových hladinách. Rozdíl mezi nimi = line-shopping.
    // Kritérium je EV proti VYPLÁCENÉMU kurzu (p × kurz − 1) – tedy přesně to, co
    // rozhoduje o zisku. Marže je v něm zahrnutá tím, že se počítá z ceny, kterou
    // sázkovka platí; „hrana nad férovou cenou" je volnější podmínka (viz `flatBets`).
    console.log("\n=== ROI ploché sázky (1 jednotka, kritérium EV = p × kurz − 1) ===");
    console.log("hladina      práh    n      ROI       95% CI              max. propad");
    for (const level of ["pinnacle", "average", "best"] as PriceLevel[]) {
      for (const minEdge of [0, 0.02, 0.05]) {
        const pnl = summarizePnl(flatBets(usable, oddsById, { level, minEdge }));
        if (pnl.n === 0) continue;
        console.log(
          `${level.padEnd(12)} ${(100 * minEdge).toFixed(0).padStart(2)} %  ${String(pnl.n).padStart(5)}  ` +
            `${(100 * pnl.roi).toFixed(2).padStart(7)} %  ` +
            `[${(100 * pnl.roiLow).toFixed(1)} %, ${(100 * pnl.roiHigh).toFixed(1)} %]`.padEnd(20) +
            `${pnl.maxDrawdown.toFixed(0).padStart(6)} j.`
        );
      }
    }
    console.log(
      "Čti interval, ne ROI: pokud CI obsahuje nulu, není z čeho tvrdit, že strategie vydělává."
    );

    // Rozpad po trzích na nejlepší ceně – kdyby někde hrana byla, bude vidět tady.
    console.log("\n=== ROI po trzích (nejlepší cena, bez prahu) ===");
    const all = flatBets(usable, oddsById, { level: "best", minEdge: 0 });
    for (const market of ["home", "away", "over25", "under25"] as const) {
      const pnl = summarizePnl(all.filter((b) => b.market === market));
      if (pnl.n === 0) continue;
      console.log(
        `${market.padEnd(9)} n=${String(pnl.n).padStart(5)}  ROI ${(100 * pnl.roi)
          .toFixed(2)
          .padStart(7)} %  [${(100 * pnl.roiLow).toFixed(1)} %, ${(
          100 * pnl.roiHigh
        ).toFixed(1)} %]  ⌀ kurz ${pnl.avgOdds.toFixed(2)}`
      );
    }
  } else {
    console.log(
      "\n(Kurzy nejsou stažené → sekce „vs. TRH“ přeskočena. Spusť `npm run import-odds`.)"
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
  const cal = fitCalibration(usable);
  console.log(
    `Kalibrace 1X2: a=${cal.a.toFixed(2)}, b=${cal.b.toFixed(2)} → log-loss ${cal.baseline.logloss.toFixed(4)} → ` +
      `${cal.bestScore.logloss.toFixed(4)} | dnes: a=${PREDICT_PARAMS.calibA}, b=${PREDICT_PARAMS.calibB}`
  );
  if (cal.atGridEdge) {
    console.log("⚠ Optimum kalibrace na hranici gridu → ověř na širším vzorku, než to nastavíš natvrdo.");
  }
  console.log(
    "\nPozn.: backtest jede BEZ xG (to je 1 volání/zápas) → produkční λ má navíc xG složku."
  );
}

main().catch((e) => {
  console.error("❌ Backtest selhal:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
