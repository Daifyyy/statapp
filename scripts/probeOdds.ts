// Diagnostika kurzů zápasu – ověří, zda API-Football pro daný fixtureId vůbec nabízí
// kurzy a pro které trhy. Vysvětluje, proč tip v Tipovačce nemá „vytažený kurz",
// i když už má výsledek: kurz a výsledek jsou NEZÁVISLÉ. Výsledek se dopočítá ze skóre
// (existuje pro každý dohraný zápas), kurz se snapshotuje jen v okamžiku vložení tipu –
// a je prázdný, když ho sázkovka pro zápas tehdy neměla (časté mimo top ligy, u
// reprezentací, daleko před výkopem, u starších zápasů).
//
// Vypisuje i **linie trhů s linkami** napříč knihami – rohy, KARTY a týmové totaly (ty
// se mezi sázkovkami liší) – a s `--markets` seznam všech trhů i s id, značený
// **skutečnými matchery** z `apiFootball.ts`. Tím se ověří, že se trh chytá podle názvu.
// Nešlo to ověřit při implementaci (mezisezóna), tak si to ověř na prvním zápase
// s kurzy. U karet navíc vypíše trhy, které se VĚDOMĚ nesnímají (booking points,
// „jen žluté“) – tam je jednotka past.
//
// Spuštění: npm run probe-odds -- <fixtureId> [<fixtureId> ...] [--markets]
// (na tomto stroji s NODE_OPTIONS=--use-system-ca kvůli TLS proxy, jako ostatní sondy)
import {
  fetchOdds,
  fetchOddsRaw,
  isCardBet,
  isCornerBet,
  teamTotalSide,
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
      console.log(`\n  Sázkovek v odpovědi: ${books.length}`);
      for (const [label, key] of [
        ["Rohy", "corners"],
        ["Karty", "cards"],
        ["Total domácích", "totalHome"],
        ["Total hostů", "totalAway"],
      ] as const) {
        const lines = new Map<number, number>();
        for (const b of books) {
          for (const c of b[key] ?? []) {
            if (c.over != null || c.under != null) {
              lines.set(c.line, (lines.get(c.line) ?? 0) + 1);
            }
          }
        }
        if (lines.size === 0) {
          console.log(`  ${label}: ŽÁDNÉ – nenabízí ani jedna kniha.`);
          continue;
        }
        console.log(`  ${label} (linie → kolik knih ji kotuje):`);
        for (const [line, n] of [...lines.entries()].sort((a, b) => b[1] - a[1])) {
          const best = books
            .flatMap((b) => (b[key] ?? []).filter((c) => c.line === line).map((c) => c.over))
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
            // Značí se **skutečnými matchery** z `apiFootball.ts`, ne jejich kopií –
            // smysl sondy je ověřit tu logiku, která data opravdu plní. Kopie by se
            // s ní mohla tiše rozejít a sonda by pak potvrzovala samu sebe.
            const total = teamTotalSide(bet);
            const mark = isCornerBet(bet)
              ? "  ← ROHY"
              : isCardBet(bet)
                ? "  ← KARTY"
                : total
                  ? `  ← TÝMOVÝ TOTAL (${total === "home" ? "domácí" : "hosté"})`
                  : "";
            console.log(`    ${String(bet.id).padStart(4)}  ${bet.name ?? "(bez názvu)"}${mark}`);
          }
          // Trhy se slovem „card", které se ZÁMĚRNĚ nesnímají – u karet je jednotka past
          // (booking points váží červenou 2.5×, „jen žluté" je jiná veličina). Když se
          // tady něco objeví, je to k zamyšlení, ne nutně chyba.
          const skipped = first.bets.filter(
            (b) => /card/i.test(b.name ?? "") && !isCardBet(b)
          );
          if (skipped.length) {
            console.log("\n  Trhy s kartami, které se VĚDOMĚ nesnímají (jiná veličina):");
            for (const b of skipped) console.log(`    ${String(b.id).padStart(4)}  ${b.name}`);
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
