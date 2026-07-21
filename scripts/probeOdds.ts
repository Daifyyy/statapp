// Diagnostika kurzů zápasu – ověří, zda API-Football pro daný fixtureId vůbec nabízí
// kurzy a pro které trhy. Vysvětluje, proč tip v Tipovačce nemá „vytažený kurz",
// i když už má výsledek: kurz a výsledek jsou NEZÁVISLÉ. Výsledek se dopočítá ze skóre
// (existuje pro každý dohraný zápas), kurz se snapshotuje jen v okamžiku vložení tipu –
// a je prázdný, když ho sázkovka pro zápas tehdy neměla (časté mimo top ligy, u
// reprezentací, daleko před výkopem, u starších zápasů).
//
// Spuštění: npm run probe-odds -- <fixtureId> [<fixtureId> ...]
// (na tomto stroji s NODE_OPTIONS=--use-system-ca kvůli TLS proxy, jako ostatní sondy)
import { fetchOdds, PINNACLE_FIRST_BOOKMAKERS } from "../lib/data/apiFootball.ts";

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
    } catch (e) {
      console.log("Chyba dotazu:", (e as Error).message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
