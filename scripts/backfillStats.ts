// Dotažení per-zápasových statistik (xG, střely…) k historii pro `npm run backtest`.
//
// Proč: backtest dosud jel jen z gólů, takže se nedalo změřit, jestli xG a střely modelu
// pomůžou (produkční λ xG používá, ale ověřený nebyl). `/fixtures/statistics` stojí
// **1 volání na zápas** a v jedné odpovědi nese OBA týmy.
//
// Dvojí užitek: výsledek se ukládá
//   1) lokálně (`.cache/backtest/stats-<liga>-<sezóna>.json`) → backtest jede offline,
//   2) do **produkční `MatchStatCache`** (Neon) → tytéž zápasy pak nemusí stahovat appka.
// Není to tedy výdaj na experiment, ale předehřátí produkční cache.
//
// Kvóta: plán Pro = 7500/den. Top-5 × 2 sezóny ≈ 3800 zápasů. `--limit` umožní rozložit
// běh na víc dní; už stažené zápasy se přeskakují, takže se dá kdykoli navázat.
//
// Spuštění: npm run backfill-stats                      # sezóny 2024+2025, strop 2000 volání
//           npm run backfill-stats -- --limit=500 --leagues=39 --seasons=2025
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MatchStat, Metric } from "../lib/types.ts";
import { fetchFixtureStatistics } from "../lib/data/apiFootball.ts";
import { statsToMetrics } from "../lib/data/realRepository.ts";
import { saveMatchStats } from "../lib/data/cache.ts";
import { PREDICTION_LEAGUES } from "../lib/data/predictions.ts";
import type { HistoryMatch } from "../lib/picks/backtest.ts";
import { prisma } from "../lib/db.ts";

const CACHE_DIR = join(process.cwd(), ".cache", "backtest");

type TeamMetrics = Partial<Record<Metric, number>>;
/** Statistiky zápasu pro obě strany, klíčované fixtureId. */
type StatsFile = Record<string, { home: TeamMetrics; away: TeamMetrics }>;

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const nums = (s: string) => s.split(",").map((x) => Number(x.trim()));

const leagues = arg("leagues") ? nums(arg("leagues")!) : PREDICTION_LEAGUES;
const seasons = arg("seasons") ? nums(arg("seasons")!) : [2024, 2025];
const limit = Number(arg("limit") ?? 2000); // strop volání na jeden běh (kvóta)

const statsPath = (league: number, season: number) =>
  join(CACHE_DIR, `stats-${league}-${season}.json`);

function loadStats(league: number, season: number): StatsFile {
  const file = statsPath(league, season);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as StatsFile) : {};
}

function loadFixtures(league: number, season: number): HistoryMatch[] {
  const file = join(CACHE_DIR, `${league}-${season}.json`);
  if (!existsSync(file)) {
    console.log(`⚠ Chybí ${file} – spusť nejdřív \`npm run backtest\` (stáhne rozpisy).`);
    return [];
  }
  return JSON.parse(readFileSync(file, "utf8")) as HistoryMatch[];
}

/** `MatchStat` obou stran jednoho zápasu ze stažených statistik (vč. inkasovaného xG). */
function matchStats(
  f: HistoryMatch,
  home: TeamMetrics,
  away: TeamMetrics
): [{ teamId: number; stat: MatchStat }, { teamId: number; stat: MatchStat }] {
  const common = {
    fixtureId: f.fixtureId,
    date: f.date,
    isNeutral: false,
    competitive: true,
    season: f.season,
    isBaseline: false,
  };
  const xgAgainst = (opp: TeamMetrics) =>
    opp.XG != null ? { XG_AGAINST: opp.XG } : {};
  return [
    {
      teamId: f.homeId,
      stat: {
        ...common,
        isHome: true,
        metrics: {
          ...home,
          ...xgAgainst(away),
          GOALS_FOR: f.homeGoals,
          GOALS_AGAINST: f.awayGoals,
        },
      },
    },
    {
      teamId: f.awayId,
      stat: {
        ...common,
        isHome: false,
        metrics: {
          ...away,
          ...xgAgainst(home),
          GOALS_FOR: f.awayGoals,
          GOALS_AGAINST: f.homeGoals,
        },
      },
    },
  ];
}

/**
 * Přepis už stažených statistik z lokální cache do `MatchStatCache` – **0 volání API**.
 * Kvůli tomu existuje: `XG_AGAINST` (inkasované xG) přibylo až po backfillu, a data pro
 * něj už na disku ležela. Není důvod za ně platit znovu.
 */
async function resaveFromCache(): Promise<void> {
  let rows = 0;
  for (const league of leagues) {
    for (const season of seasons) {
      const fixtures = loadFixtures(league, season);
      const stats = loadStats(league, season);
      for (const f of fixtures) {
        const s = stats[String(f.fixtureId)];
        if (!s) continue;
        for (const { teamId, stat } of matchStats(f, s.home, s.away)) {
          await saveMatchStats(teamId, "league", [stat]).catch(() => {});
          rows++;
        }
      }
      console.log(`Liga ${league} / ${season}: přepsáno ${rows} řádků`);
    }
  }
  console.log(`\nHotovo bez jediného volání API. Řádků v MatchStatCache: ${rows}`);
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (process.argv.includes("--from-cache")) {
    console.log("Režim --from-cache: přepis lokálních statistik do DB (0 volání API).");
    await resaveFromCache();
    return;
  }
  console.log(
    `Ligy: ${leagues.join(", ")} | sezóny: ${seasons.join(", ")} | strop volání: ${limit}`
  );

  let used = 0;
  let saved = 0;
  let missing = 0;

  for (const league of leagues) {
    for (const season of seasons) {
      const fixtures = loadFixtures(league, season);
      if (fixtures.length === 0) continue;
      const stats = loadStats(league, season);
      const todo = fixtures.filter((f) => !(String(f.fixtureId) in stats));
      console.log(
        `\nLiga ${league} / ${season}: ${fixtures.length} zápasů, ` +
          `hotovo ${fixtures.length - todo.length}, zbývá ${todo.length}`
      );

      for (const f of todo) {
        if (used >= limit) {
          // POZOR: bez zápisu by se dosud stažené zápasy zahodily a příští běh by je
          // stáhl znovu (a platil za ně dvakrát).
          writeFileSync(statsPath(league, season), JSON.stringify(stats));
          console.log(`\n⏸ Dosažen strop ${limit} volání – zbytek dotáhne další běh.`);
          console.log(`Staženo: ${used} | uloženo do cache: ${saved} | bez statistik: ${missing}`);
          return;
        }
        used++;
        try {
          const raw = await fetchFixtureStatistics(f.fixtureId);
          const home = statsToMetrics(raw.find((s) => s.team.id === f.homeId) ?? null);
          const away = statsToMetrics(raw.find((s) => s.team.id === f.awayId) ?? null);
          if (Object.keys(home).length === 0 && Object.keys(away).length === 0) {
            missing++;
          }
          stats[String(f.fixtureId)] = { home, away };

          // Zápis i do produkční cache (oba týmy z jedné odpovědi) – ať appka tyhle
          // zápasy nemusí stahovat znovu. Selhání zápisu nesmí zastavit backfill.
          await Promise.all(
            matchStats(f, home, away).map(({ teamId, stat }) =>
              saveMatchStats(teamId, "league", [stat])
            )
          ).then(
            () => {
              saved += 2;
            },
            () => {}
          );
        } catch {
          missing++;
          stats[String(f.fixtureId)] = { home: {}, away: {} }; // ať se nezkouší donekonečna
        }

        // Průběžný zápis (přerušený běh nepřijde o práci).
        if (used % 50 === 0) {
          writeFileSync(statsPath(league, season), JSON.stringify(stats));
          process.stdout.write(`  …${used} volání\r`);
        }
      }
      writeFileSync(statsPath(league, season), JSON.stringify(stats));
    }
  }

  console.log(
    `\nHotovo. Volání: ${used} | řádků do MatchStatCache: ${saved} | zápasů bez statistik: ${missing}`
  );
}

main()
  .catch((e) => {
    console.error("❌ Backfill selhal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
