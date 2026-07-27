// Stáhne HISTORICKÉ ZAVÍRACÍ KURZY z football-data.co.uk a přilepí je k rozpisům
// v `.cache/backtest` jako sidecar `odds-<liga>-<sezóna>.json` (klíč = fixtureId).
//
// Proč externí zdroj: API-Football historické kurzy nevrací (`/odds` pro odehraný zápas,
// `?date=` i `?league=&season=` vrací 0 výsledků), takže bez tohohle datasetu nejde na
// historii spočítat market benchmark ani ROI – tedy jediné, co u sázecího modelu rozhoduje.
//
// **0 volání API-Football** (jen HTTP na football-data.co.uk).
//
// Spuštění: npm run import-odds
//           npm run import-odds -- --leagues=39,140 --seasons=2024,2025
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HistoryMatch } from "../lib/picks/backtest.ts";
import {
  LEAGUE_SOURCES,
  matchOdds,
  parseExtraCsv,
  parseMainCsv,
  type SourceMatch,
} from "../lib/picks/oddsDataset.ts";
import { PREDICTION_LEAGUES } from "../lib/data/predictions.ts";

const CACHE_DIR = join(process.cwd(), ".cache", "backtest");
const BASE = "https://www.football-data.co.uk";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const nums = (s: string) => s.split(",").map((x) => Number(x.trim()));

const leagues = arg("leagues") ? nums(arg("leagues")!) : PREDICTION_LEAGUES;
const seasons = arg("seasons") ? nums(arg("seasons")!) : [2023, 2024, 2025];

/** `2024` → `2425` (formát adresáře football-data pro sezónu 2024/25). */
const seasonCode = (season: number) =>
  `${String(season % 100).padStart(2, "0")}${String((season + 1) % 100).padStart(2, "0")}`;

const historyPath = (league: number, season: number) =>
  join(CACHE_DIR, `${league}-${season}.json`);
const oddsPath = (league: number, season: number) =>
  join(CACHE_DIR, `odds-${league}-${season}.json`);

function loadHistory(league: number, season: number): HistoryMatch[] {
  const file = historyPath(league, season);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as HistoryMatch[];
}

const cache = new Map<string, string | null>();
async function download(path: string): Promise<string | null> {
  if (cache.has(path)) return cache.get(path)!;
  try {
    const res = await fetch(`${BASE}${path}`);
    const text = res.ok ? await res.text() : null;
    cache.set(path, text);
    return text;
  } catch {
    cache.set(path, null);
    return null;
  }
}

/** Zdrojové zápasy pro ligu+sezónu (hlavní ligy mají soubor na sezónu, „extra" jeden na ligu). */
async function loadSource(league: number, season: number): Promise<SourceMatch[] | null> {
  const src = LEAGUE_SOURCES[league];
  if (!src) return null;
  if (src.kind === "main") {
    const text = await download(`/mmz4281/${seasonCode(season)}/${src.code}.csv`);
    return text ? parseMainCsv(text) : null;
  }
  const text = await download(`/new/${src.code}.csv`);
  return text ? parseExtraCsv(text) : null;
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Ligy: ${leagues.join(", ")} | sezóny: ${seasons.join(", ")}`);

  let totalMatched = 0;
  let totalHistory = 0;
  const weak: string[] = [];

  for (const league of leagues) {
    if (!LEAGUE_SOURCES[league]) {
      console.log(`\nLiga ${league}: ⚠ football-data ji nemá (kurzy půjde sbírat jen dopředu).`);
      continue;
    }
    for (const season of seasons) {
      const history = loadHistory(league, season);
      if (history.length === 0) continue;
      const source = await loadSource(league, season);
      if (!source) {
        console.log(`Liga ${league} / ${season}: ⚠ zdrojové CSV se nepodařilo stáhnout`);
        continue;
      }
      const res = matchOdds(history, source, season);
      writeFileSync(oddsPath(league, season), JSON.stringify(res.odds));
      totalMatched += res.matched;
      totalHistory += res.total;
      const rate = (100 * res.matched) / res.total;
      const flag = rate >= 95 ? "✓" : rate >= 80 ? "~" : "✗";
      console.log(
        `Liga ${league} / ${season}: ${flag} spárováno ${res.matched}/${res.total} (${rate.toFixed(1)} %)`
      );
      if (rate < 95) {
        weak.push(`${league}/${season} ${rate.toFixed(1)} %`);
        for (const u of res.unmatched) console.log(`    nespárováno: ${u}`);
      }
    }
  }

  const rate = totalHistory ? (100 * totalMatched) / totalHistory : 0;
  console.log(
    `\nCelkem: ${totalMatched}/${totalHistory} zápasů s kurzy (${rate.toFixed(1)} %), 0 volání API-Football.`
  );
  if (weak.length) {
    console.log(
      `⚠ Pod 95 %: ${weak.join(", ")} – zkontroluj názvy týmů, ne­spárované zápasy se do měření nedostanou.`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
