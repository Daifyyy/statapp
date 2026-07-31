// Diagnostika ŽIVÝCH statistik – jediná cesta, jak ověřit, že přehled probíhajícího
// zápasu opravdu dostává data. Živý zápas se nedá nasimulovat a mimo zápasové okno se
// tahle cesta vůbec nepoužije, takže regrese v ní je jinak neviditelná až do dalšího kola.
//
// Značí **skutečnými parsery z repa** (`statsToMetrics`, `buildLiveReport`), ne jejich
// kopií – kopie by potvrzovala sama sebe. Pointa je vidět přesně to, co uvidí uživatel.
//
// Čtyři věci, které to má odhalit (a které jinak vypadají jako „liga statistiky nemá"):
//  1) vrací API u rozehraného zápasu vůbec něco a od které minuty,
//  2) je živě k dispozici xG (bez něj jede Nebezpečnost fallbackem a texty jsou fádnější),
//  3) rostou hodnoty v čase (= jsou kumulativní), nebo jsou zamrzlé/projektované,
//  4) neobjevil se typ statistiky, který `STAT_TYPE_MAP` nemapuje.
//
// Bod 4 je poučení z `oddsCoverage`: jeden chybějící zápas je normální, ale NULA napříč
// celým vzorkem je podezření na parsování – a pozná se jen v agregátu, ne na jednom zápase.
//
// Spuštění:
//   npm run probe-live                      # živé zápasy našich lig + přehled prvních tří
//   npm run probe-live -- <fixtureId>       # detail jednoho zápasu (i dohraného – viz níž)
//   npm run probe-live -- <id> --watch 120  # snímek po 120 s a diff (důkaz kumulativnosti)
// (na tomto stroji s NODE_OPTIONS=--use-system-ca kvůli TLS proxy, jako ostatní sondy)
import {
  fetchLiveFixtures,
  fetchFixturesByIds,
  fetchFixtureStatistics,
  fetchStatus,
  STAT_TYPE_MAP,
  LIVE_STATUSES,
  type ApiFixture,
  type ApiFixtureStats,
} from "../lib/data/apiFootball.ts";
import { statsToMetrics } from "../lib/data/realRepository.ts";
import { buildLiveReport } from "../lib/stats/liveReport.ts";
import { FIXTURE_LIST_LEAGUE_IDS } from "../lib/data/catalog.ts";
import type { Metric } from "../lib/types.ts";

/** Kolik zápasů rozebrat do detailu, když se nezadá konkrétní id. */
const DETAIL_LIMIT = 3;

/**
 * Metriky, u kterých je nula napříč vzorkem **normální**, ne podezřelá: API u nich posílá
 * `null` místo `0`, takže se z odpovědi vůbec nenamapují (`parseStatValue` → `null`).
 * Ověřeno na živých i dohraných zápasech – zápas bez červené karty prostě `Red Cards`
 * nemá. Kdyby se na ně alarm vztahoval, sonda by křičela skoro pokaždé a přestala by se
 * číst – což je přesně ten způsob, jakým hlídač přestane hlídat.
 */
const SPARSE_BY_NATURE = new Set<Metric>(["RED_CARDS"]);

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? (process.argv[idx + 1] ?? "") : null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Side = Partial<Record<Metric, number>>;

/** Syrové páry type/value tak, jak dorazily – včetně těch, které nemapujeme. */
function printRaw(stats: ApiFixtureStats): void {
  for (const team of stats) {
    console.log(`  --- tým ${team.team.id}`);
    for (const s of team.statistics) {
      const mapped = STAT_TYPE_MAP[s.type];
      const flag = mapped ? `→ ${mapped}` : "→ NEMAPOVÁNO";
      console.log(`      ${JSON.stringify(s.type).padEnd(24)} = ${JSON.stringify(s.value)}  ${flag}`);
    }
  }
}

async function detail(
  f: { id: number; status: string; elapsed: number | null; home: { id: number; name: string }; away: { id: number; name: string }; goals: { home: number | null; away: number | null }; halftime: { home: number | null; away: number | null } },
  coverage: Map<Metric, number>,
  seen: { count: number },
  raw: boolean
): Promise<{ home: Side; away: Side } | null> {
  const stats = await fetchFixtureStatistics(f.id);
  if (!stats || stats.length === 0) {
    console.log("  ŽÁDNÉ statistiky – API pro tento běžící zápas zatím nic nevrací.");
    return null;
  }
  if (raw) printRaw(stats);

  const pick = (id: number) => stats.find((s) => s.team.id === id) ?? null;
  const home = statsToMetrics(pick(f.home.id));
  const away = statsToMetrics(pick(f.away.id));

  // Počítá se po STRANÁCH, ne po zápasech – pokrytí se plní taky za každou stranu zvlášť,
  // jinak by jmenovatel neseděl s čitatelem (a tabulka hlásila „2/1").
  for (const side of [home, away]) {
    seen.count++;
    for (const key of Object.keys(side) as Metric[]) {
      coverage.set(key, (coverage.get(key) ?? 0) + 1);
    }
  }

  const report = buildLiveReport({
    home,
    away,
    teams: { home: f.home.name, away: f.away.name },
    goals:
      f.goals.home != null && f.goals.away != null
        ? { home: f.goals.home, away: f.goals.away }
        : null,
    elapsed: f.elapsed,
    status: f.status,
    halftime:
      f.halftime.home != null && f.halftime.away != null
        ? { home: f.halftime.home, away: f.halftime.away }
        : null,
  });

  console.log(`  metriky domácí: ${JSON.stringify(home)}`);
  console.log(`  metriky hosté : ${JSON.stringify(away)}`);
  console.log("  ── co uvidí uživatel ──────────────────────────────");
  console.log(`  ${report.available ? "" : `[nedostupné: ${report.reason}] `}${report.headline}`);
  for (const n of report.notes) console.log(`   • ${n}`);
  const chips = [report.character.openness, report.character.balance, report.character.intensity]
    .filter((c) => c != null)
    .join(", ");
  if (chips) console.log(`  chipy: ${chips}`);
  for (const d of report.dimensions.filter((d) => d.available)) {
    console.log(`  ${d.label.padEnd(14)} ${d.home.toFixed(1)} : ${d.away.toFixed(1)}   (${d.detail})`);
  }
  console.log(`  stav v ${report.minute}. minutě`);
  return { home, away };
}

async function main() {
  const before = await fetchStatus();
  console.log(
    `kvóta na startu: ${before.requests?.current} / ${before.requests?.limit_day}\n`
  );

  const ids = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"))
    .map(Number)
    .filter(Number.isFinite);
  const raw = !process.argv.includes("--no-raw");
  const watchSec = Number(arg("watch") ?? 0);

  console.log("=== /fixtures?live= (naše ligy, 1 volání) ===");
  const live = await fetchLiveFixtures(FIXTURE_LIST_LEAGUE_IDS);
  const running = live.filter((f) => LIVE_STATUSES.has(f.fixture.status.short));
  console.log(`živých zápasů: ${running.length}`);
  for (const f of running) {
    console.log(
      `  ${f.fixture.id} | ${f.fixture.status.short.padEnd(4)} | ${String(f.fixture.status.elapsed ?? "?").padStart(3)}' | ` +
        `${f.league.name} | ${f.teams.home.name} ${f.goals.home ?? 0}:${f.goals.away ?? 0} ${f.teams.away.name}`
    );
  }

  /**
   * Se zadaným `fixtureId` se sonda nedrží živé sady. Je to schválně: jinak by se detailní
   * větev (mapování, přehled, tabulka pokrytí) dala spustit jen v úzkém okně, kdy zrovna
   * něco běží – a neověřený diagnostický nástroj je k ničemu právě ve chvíli, kdy ho
   * potřebuješ. Na dohraném zápase projde tatáž cesta, jen s plným objemem.
   */
  let chosen: ApiFixture[];
  if (ids.length) {
    const fromLive = running.filter((f) => ids.includes(f.fixture.id));
    const missing = ids.filter((id) => !fromLive.some((f) => f.fixture.id === id));
    const fetched = missing.length ? await fetchFixturesByIds(missing) : [];
    for (const f of fetched) {
      if (!LIVE_STATUSES.has(f.fixture.status.short)) {
        console.log(
          `\n⚠ ${f.fixture.id} právě neběží (${f.fixture.status.short}) – jede se na dohraném` +
            " zápase. Prahy živého přehledu tím neověříš, jen mapování a tvar výstupu."
        );
      }
    }
    chosen = [...fromLive, ...fetched];
  } else {
    chosen = running.slice(0, DETAIL_LIMIT);
  }

  if (chosen.length === 0) {
    console.log(
      running.length === 0
        ? "\nNic neběží → pusť sondu během zápasového okna, nebo zadej konkrétní fixtureId."
        : "\nZadané fixtureId se nepodařilo načíst."
    );
    return;
  }

  const coverage = new Map<Metric, number>();
  const seen = { count: 0 };
  const snapshots = new Map<number, { home: Side; away: Side }>();

  for (const f of chosen) {
    console.log(`\n=== /fixtures/statistics?fixture=${f.fixture.id} ===`);
    const meta = {
      id: f.fixture.id,
      status: f.fixture.status.short,
      elapsed: f.fixture.status.elapsed ?? null,
      home: f.teams.home,
      away: f.teams.away,
      goals: f.goals,
      halftime: { home: f.score?.halftime?.home ?? null, away: f.score?.halftime?.away ?? null },
    };
    const got = await detail(meta, coverage, seen, raw);
    if (got) snapshots.set(f.fixture.id, got);
  }

  // Pokrytí metrik napříč vzorkem. Jeden chybějící zápas je normální; nula napříč všemi
  // je podezření na parsování – a to jde poznat jen tady, v agregátu.
  if (seen.count > 0) {
    console.log(`\n=== Pokrytí metrik (${seen.count} stran ve vzorku) ===`);
    const wanted = new Set<Metric>(Object.values(STAT_TYPE_MAP));
    const missing: Metric[] = [];
    for (const m of [...wanted].sort()) {
      const n = coverage.get(m) ?? 0;
      const suspicious = n === 0 && !SPARSE_BY_NATURE.has(m);
      const note = n === 0 && !suspicious ? "  (běžné – API posílá null místo nuly)" : "";
      const mark = suspicious ? "  ← NULA napříč vzorkem, podezření na parsování" : note;
      console.log(`  ${m.padEnd(20)} ${n}/${seen.count}${mark}`);
      if (suspicious) missing.push(m);
    }
    if (missing.length) {
      console.log(`\n⚠ Bez dat napříč celým vzorkem: ${missing.join(", ")}`);
      console.log("  U xG to může být vlastnost ligy; u držení/střel je to spíš porucha.");
    } else {
      console.log("\n✔ Žádná metrika nechybí napříč celým vzorkem.");
    }
  }

  // Druhý snímek → důkaz, že hodnoty ROSTOU (jsou kumulativní k aktuální minutě).
  if (watchSec > 0) {
    console.log(`\n=== --watch: druhý snímek za ${watchSec} s ===`);
    await sleep(watchSec * 1000);
    const live2 = await fetchLiveFixtures(FIXTURE_LIST_LEAGUE_IDS);
    for (const [id, first] of snapshots) {
      const f = live2.find((x) => x.fixture.id === id);
      if (!f) {
        console.log(`  ${id}: už neběží (dohráno).`);
        continue;
      }
      const stats = await fetchFixtureStatistics(id);
      const pick = (tid: number) => stats.find((s) => s.team.id === tid) ?? null;
      const now = statsToMetrics(pick(f.teams.home.id));
      console.log(`  ${id} | ${f.fixture.status.elapsed ?? "?"}' – změny domácích:`);
      let changed = 0;
      for (const key of Object.keys(now) as Metric[]) {
        const a = first.home[key];
        const b = now[key];
        if (a !== b) {
          changed++;
          console.log(`    ${key.padEnd(20)} ${a} → ${b}`);
        }
      }
      if (changed === 0) {
        console.log("    beze změny – buď se nic nestalo, nebo jsou hodnoty ZAMRZLÉ (ověř na delším okně).");
      }
    }
  }

  const after = await fetchStatus();
  // Rozdíl je orientační: `/status` se u API-Footballu aktualizuje se zpožděním, takže
  // těsně po běhu umí ukázat i nulu. Slouží k zachycení řádu, ne k účetnictví.
  console.log(
    `\nkvóta na konci: ${after.requests?.current} / ${after.requests?.limit_day}` +
      ` (rozdíl proti startu ${Number(after.requests?.current ?? 0) - Number(before.requests?.current ?? 0)},` +
      " `/status` se aktualizuje se zpožděním)"
  );
  console.log("✅ Sonda OK");
}

main().catch((e) => {
  console.error("❌ Sonda selhala:", e.message);
  process.exit(1);
});
