// Audit evropských/sestupových příček herních lig (modul „Manažer").
// Spuštění: npm run audit-leagues            (všechny ligy)
//           npm run audit-leagues -- 345 39   (jen vybrané id)
//
// Pro každou ligu stáhne reálnou tabulku, ukáže popisky řádků (`description`), z nich
// odvozený klíč (`deriveLeagueAccess`) a porovná ho s kurátorovaným fallbackem
// (`LEAGUE_ACCESS` v lib/game/leagues.ts). Slouží k ruční kontrole, že sestupová
// i pohárová zóna sedí realitě – curated tabulka jede v mock režimu a při výpadku dat.
//
// Pozn.: čte přes `fetchLeagueStandings`, tj. 1 volání na ligu (mimo `ApiCache`).
// Ligy s nadstavbou vrací několik podtabulek za sebou (základní + evropská + sestupová),
// proto ranky nejsou globální a `rows.length` není velikost ligy.
import { fetchLeagueStandings } from "../lib/data/apiFootball.ts";
import { deriveLeagueAccess } from "../lib/data/standings.ts";
import { CURRENT_SEASON, PREVIOUS_SEASON } from "../lib/data/catalog.ts";
import { GAME_LEAGUES, SECOND_TIERS, curatedAccess } from "../lib/game/leagues.ts";
import type { LeagueAccess } from "../lib/game/types.ts";
import type { ApiStandingRow } from "../lib/data/apiFootball.ts";

const ALL = [
  ...GAME_LEAGUES.map((l) => ({ id: l.id, name: l.name, country: l.country, tier: 1 })),
  ...SECOND_TIERS.map((l) => ({ id: l.id, name: l.name, country: l.country, tier: 2 })),
];

function fmtSlots(access: LeagueAccess | null): string {
  if (!access) return "—";
  if (!access.slots.length) return "(žádné evropské sloty)";
  return access.slots.map((s) => `${s.rank}.→${s.spot}`).join(", ");
}

function fmtReleg(v: number | null | undefined): string {
  return v === null || v === undefined ? "null (neznámo)" : String(v);
}

/** Kolik unikátních týmů tabulka popisuje (podtabulky se u nadstavby opakují). */
function leagueSize(rows: ApiStandingRow[]): number {
  return new Set(rows.map((r) => r.team.id)).size;
}

async function standingsWithFallback(
  id: number
): Promise<{ rows: ApiStandingRow[]; season: number }> {
  const rows = await fetchLeagueStandings(id, CURRENT_SEASON);
  const played = rows.reduce((s, r) => s + (r.all?.played ?? 0), 0);
  // Mezisezóna: aktuální tabulka je prázdná → popisky ještě nejsou vyplněné.
  if (rows.length && played > 0) return { rows, season: CURRENT_SEASON };
  const prev = await fetchLeagueStandings(id, PREVIOUS_SEASON).catch(() => []);
  return prev.length ? { rows: prev, season: PREVIOUS_SEASON } : { rows, season: CURRENT_SEASON };
}

async function auditLeague(l: (typeof ALL)[number]): Promise<boolean> {
  const label = `${l.name} (${l.country}, id=${l.id}, ${l.tier}. liga)`;
  let rows: ApiStandingRow[];
  let season: number;
  try {
    ({ rows, season } = await standingsWithFallback(l.id));
  } catch (e) {
    console.log(`\n=== ${label} ===\n  ⚠ chyba při stahování: ${(e as Error).message}`);
    return false;
  }
  if (!rows.length) {
    console.log(`\n=== ${label} ===\n  ⚠ prázdná tabulka (mimo sezónu?)`);
    return false;
  }

  const size = leagueSize(rows);
  console.log(`\n=== ${label} — sezóna ${season}, ${size} týmů, ${rows.length} řádků ===`);
  for (const r of rows) {
    const desc = r.description?.trim();
    if (desc) console.log(`  ${String(r.rank).padStart(2)}. ${r.team.name.padEnd(24)} ${desc}`);
  }

  const derived = deriveLeagueAccess(rows);
  const curated = curatedAccess(l.id);
  console.log(`  ── odvozeno:    sloty [${fmtSlots(derived)}]  sestup ${fmtReleg(derived?.relegBottom)}`);
  console.log(`  ── kurátorové:  sloty [${fmtSlots(curated)}]  sestup ${fmtReleg(curated?.relegBottom)}`);

  // Rozdíl hlásíme jen tam, kde curated reálně jede: sloty když je odvozený nemá,
  // sestup když ho odvozený nezná (typicky nadstavba) → curated je jediný zdroj pravdy.
  let mismatch = false;
  if (!curated) {
    console.log("  ⚠ CHYBÍ kurátorovaný záznam → padá na generický default");
    mismatch = true;
  } else {
    if (derived?.relegBottom != null && derived.relegBottom !== curated.relegBottom) {
      console.log(
        `  ⚠ SESTUP: odvozeno ${derived.relegBottom}, kurátorové ${fmtReleg(curated.relegBottom)}` +
          " → sjednoť curated (mock/fallback jinak sestupuje jinak než reálná data)"
      );
      mismatch = true;
    }
    if (derived?.relegBottom == null && curated.relegBottom == null) {
      console.log("  ⚠ SESTUP neznámý z dat A curated je null → spadne na generický default");
      mismatch = true;
    }
    const dSlots = fmtSlots(derived);
    const cSlots = fmtSlots(curated);
    if (derived?.slots.length && dSlots !== cSlots) {
      console.log(`  ℹ EVROPA: odvozeno ≠ curated (v reálu jede odvozené, curated je fallback)`);
    }
  }
  if (!mismatch) console.log("  ✓ ok");
  return !mismatch;
}

async function main() {
  const only = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const leagues = only.length ? ALL.filter((l) => only.includes(l.id)) : ALL;
  console.log(`Audit ${leagues.length} lig (sezóna ${CURRENT_SEASON})…`);

  let bad = 0;
  for (const l of leagues) {
    // Sériově: /standings je mimo ApiCache a rate limiter nás stejně stropuje.
    if (!(await auditLeague(l))) bad++;
  }
  console.log(`\n──────────\nHotovo: ${leagues.length - bad} ok, ${bad} k prověření.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
