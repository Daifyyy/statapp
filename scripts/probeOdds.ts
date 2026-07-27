// Diagnostika kurzů zápasu – ověří, zda API-Football pro daný fixtureId vůbec nabízí
// kurzy a pro které trhy. Vysvětluje, proč tip v Tipovačce nemá „vytažený kurz",
// i když už má výsledek: kurz a výsledek jsou NEZÁVISLÉ. Výsledek se dopočítá ze skóre
// (existuje pro každý dohraný zápas), kurz se snapshotuje jen v okamžiku vložení tipu –
// a je prázdný, když ho sázkovka pro zápas tehdy neměla (časté mimo top ligy, u
// reprezentací, daleko před výkopem, u starších zápasů).
//
// Vypisuje i **rohové linie** napříč knihami (ty se mezi sázkovkami liší) a s
// `--markets` seznam všech trhů i s id – tím se ověří, že se rohový trh chytá podle
// názvu. Rohy nešlo ověřit při implementaci (mezisezóna), tak si to ověř na prvním
// zápase, který bude mít kurzy.
//
// Spuštění: npm run probe-odds -- <fixtureId> [<fixtureId> ...] [--markets]
// (na tomto stroji s NODE_OPTIONS=--use-system-ca kvůli TLS proxy, jako ostatní sondy)
import {
  fetchOdds,
  fetchOddsRaw,
  PINNACLE_FIRST_BOOKMAKERS,
} from "../lib/data/apiFootball.ts";

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
  if (ids.length === 0) {
    console.error("Použití: npm run probe-odds -- <fixtureId> [<fixtureId> ...]");
    console.error("fixtureId najdeš v deep-linku zápasu nebo v DB tabulce UserTip.");
    process.exit(1);
  }

  for (const id of ids) {
    console.log(`\n=== /odds?fixture=${id} ===`);
    try {
      const mo = await fetchOdds(id, PINNACLE_FIRST_BOOKMAKERS);
      if (!mo) {
        console.log("Kurzy: ŽÁDNÉ – API pro tento zápas nevrací žádnou sázkovku.");
        console.log(
          "→ V Tipovačce se zobrazí „kurz nebyl k dispozici“. To NENÍ chyba: kurzy jsou"
        );
        console.log(
          "  nezávislé na výsledku a chybí často mimo top ligy, u repre a daleko před výkopem."
        );
        continue;
      }
      console.log("Sázkovka:", mo.bookmaker);
      const row = (label: string, v: number | null | undefined) =>
        console.log(`  ${label.padEnd(12)} ${v == null ? "—  (chybí)" : v.toFixed(2)}`);
      row("1 (home)", mo.home);
      row("X (draw)", mo.draw);
      row("2 (away)", mo.away);
      row("Over 2.5", mo.over25);
      row("Under 2.5", mo.under25);
      row("BTTS Yes", mo.btts);
      row("BTTS No", mo.bttsNo);
      console.log(
        "→ Tip na trh/stranu označenou „chybí“ zůstane bez kurzu, i když ostatní trhy kurz mají."
      );

      // ROHY: nabízené linie napříč knihami. Linie se mezi sázkovkami LIŠÍ (9.5 vs
      // 10.5 vs 11.5) a porovnávat kurzy napříč linkami je hrubá chyba – proto se
      // vypisuje pokrytí každé z nich zvlášť.
      const books = mo.books ?? [];
      const lines = new Map<number, number>();
      for (const b of books) {
        for (const c of b.corners ?? []) {
          if (c.over != null || c.under != null) {
            lines.set(c.line, (lines.get(c.line) ?? 0) + 1);
          }
        }
      }
      console.log(`\n  Sázkovek v odpovědi: ${books.length}`);
      if (lines.size === 0) {
        console.log("  Rohy: ŽÁDNÉ – nabídku Over/Under rohů nemá ani jedna kniha.");
      } else {
        console.log("  Rohy (linie → kolik knih ji kotuje):");
        for (const [line, n] of [...lines.entries()].sort((a, b) => b[1] - a[1])) {
          const best = books
            .flatMap((b) => (b.corners ?? []).filter((c) => c.line === line).map((c) => c.over))
            .filter((o): o is number => o != null);
          console.log(
            `    ${line.toFixed(2).padStart(6)}  ${String(n).padStart(2)} knih` +
              (best.length ? `  nejlepší Over ${Math.max(...best).toFixed(2)}` : "")
          );
        }
      }

      // Názvy trhů – rohy hledáme podle názvu, ne podle id, takže tohle je způsob,
      // jak si ověřit, že se shoda chytá (a jak se trh u téhle knihy vlastně jmenuje).
      if (process.argv.includes("--markets")) {
        const raw = await fetchOddsRaw(id);
        const first = raw[0]?.bookmakers?.[0];
        if (first) {
          console.log(`\n  Trhy u „${first.name}“ (id → název):`);
          for (const bet of first.bets) {
            const mark = bet.name && /corner/i.test(bet.name) ? "  ← ROHY" : "";
            console.log(`    ${String(bet.id).padStart(4)}  ${bet.name ?? "(bez názvu)"}${mark}`);
          }
        }
      }
    } catch (e) {
      console.log("Chyba dotazu:", (e as Error).message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
