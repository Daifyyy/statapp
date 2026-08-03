// Sonda na `/fixtures/events` – **spustit DŘÍV, než se napíše zod schéma.**
//
// Endpoint se v repu zatím nepoužívá, takže o jeho skutečném tvaru nemáme z provozu
// žádný důkaz. Dokumentace API-Footballu se u okrajových polí rozchází s realitou
// (viz `oddsText` v `apiFootball.ts`, kde numerická `value` rok tiše zabíjela kurzy),
// proto se schéma píše až proti vypsané odpovědi.
//
// Co to má ukázat:
//  1) jaké `type` hodnoty reálně chodí (Goal / Card / subst / Var …) a s jakými `detail`,
//  2) jestli je `time.extra` (nastavení) opravdu `null` nebo číslo,
//  3) čím se liší gól z penalty / vlastní gól – aby se v UI neukázal střelec u vlastňáku,
//  4) jestli u střídání sedí `player` = odchází a `assist` = přichází (dokumentace to
//     tvrdí, ale je to přesně ten typ detailu, který se ověřit vyplatí).
//
// Spuštění (na tomhle stroji s NODE_OPTIONS=--use-system-ca kvůli TLS proxy):
//   npm run probe-events -- <fixtureId>
//   npm run probe-events                    # vezme první živý zápas našich lig
import { apiGet, fetchLiveFixtures } from "../lib/data/apiFootball.ts";
import { FIXTURE_LIST_LEAGUE_IDS } from "../lib/data/catalog.ts";
import { z } from "zod";

/** Schválně **volné** schéma: cílem je uvidět, co chodí, ne to hned validovat. */
const looseEvents = z.array(z.record(z.string(), z.unknown()));

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  let fixtureId = arg ? Number(arg) : null;

  if (fixtureId == null) {
    const live = await fetchLiveFixtures(FIXTURE_LIST_LEAGUE_IDS);
    if (live.length === 0) {
      console.log(
        "Žádný živý zápas našich lig. Spusť s konkrétním id: npm run probe-events -- <fixtureId>"
      );
      return;
    }
    fixtureId = live[0].fixture.id;
    console.log(
      `Živý zápas: ${live[0].teams.home.name} – ${live[0].teams.away.name} (${fixtureId})\n`
    );
  }

  const events = await apiGet("/fixtures/events", { fixture: fixtureId }, looseEvents);
  console.log(`Událostí: ${events.length}\n`);

  if (events.length === 0) {
    console.log("Prázdná odpověď – zápas ještě nemá události, nebo je liga nedodává.");
    return;
  }

  // Přehled typů a detailů – z toho se rozhodne, co vůbec zobrazovat.
  const kinds = new Map<string, number>();
  for (const e of events) {
    const key = `${String(e.type)} / ${String(e.detail)}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  console.log("type / detail:");
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}× ${k}`);
  }

  console.log("\nPrvní tři události v syrové podobě:");
  console.log(JSON.stringify(events.slice(0, 3), null, 2));

  // Klíčové pro UI: nastavení (`time.extra`) a tvar střídání.
  const withExtra = events.filter(
    (e) => (e.time as { extra?: unknown } | undefined)?.extra != null
  );
  console.log(`\nUdálostí s nastavením (time.extra != null): ${withExtra.length}`);

  const subs = events.filter((e) => String(e.type).toLowerCase() === "subst");
  if (subs.length > 0) {
    console.log("\nStřídání (ověř, kdo je player a kdo assist):");
    console.log(JSON.stringify(subs.slice(0, 2), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
