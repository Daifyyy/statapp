// Přepočet uložených pravděpodobností po změně post-parametrů modelu (Dixon–Coles ρ,
// zostření λ) – z uložených ZÁKLADNÍCH λ, tedy čistou matematikou: **0 API volání**.
//
// Proč to jde: `MODEL_VERSION` verzuje jen to, co λ *vyrábí*. ρ a zostření se aplikují až
// NA λ (`PREDICT_PARAMS` v lib/stats/predict.ts), takže po jejich změně stačí přepočítat
// mřížku nad tím, co už v DB je – žádný reset datasetu, historie zůstane použitelná.
//
// Spuštění: npm run reprice            (suchý běh – vypíše, co by se změnilo)
//           npm run reprice -- --apply (zapíše do DB)
import { prisma } from "../lib/db.ts";
import { MODEL_VERSION } from "../lib/data/predictions.ts";
import { gridProbs, PREDICT_PARAMS } from "../lib/stats/predict.ts";

const apply = process.argv.includes("--apply");
const EPS = 1e-9;

/** Řádek je aktuální, jen když sedí VŠECHNY post-parametry (null = starý řádek → přepočítat). */
function isCurrent(
  rho: number | null,
  sharpen: number | null,
  calibA: number | null,
  calibB: number | null
): boolean {
  return (
    rho != null &&
    sharpen != null &&
    calibA != null &&
    calibB != null &&
    Math.abs(rho - PREDICT_PARAMS.rho) < EPS &&
    Math.abs(sharpen - PREDICT_PARAMS.sharpen) < EPS &&
    Math.abs(calibA - PREDICT_PARAMS.calibA) < EPS &&
    Math.abs(calibB - PREDICT_PARAMS.calibB) < EPS
  );
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

async function main() {
  console.log(
    `Model v${MODEL_VERSION} | post-parametry: ρ=${PREDICT_PARAMS.rho}, zostření=${PREDICT_PARAMS.sharpen}, ` +
      `kalibrace a=${PREDICT_PARAMS.calibA}/b=${PREDICT_PARAMS.calibB}` +
      (apply ? "" : "  [suchý běh – zapiš přes -- --apply]")
  );

  // Jen aktuální verze modelu: ρ/zostření se fitují k DANÝM λ, takže je nemá smysl
  // vnucovat řádkům ze staré verze (jejich λ vznikla jiným výpočtem). Ty zůstanou
  // historickým záznamem s parametry, se kterými byly spočítané.
  const rows = await prisma.fixturePrediction.findMany({
    where: { available: true, modelVersion: MODEL_VERSION },
    select: {
      fixtureId: true,
      homeName: true,
      awayName: true,
      lambdaHome: true,
      lambdaAway: true,
      homeWin: true,
      draw: true,
      awayWin: true,
      rho: true,
      sharpen: true,
      calibA: true,
      calibB: true,
    },
    orderBy: { kickoff: "asc" },
  });

  const stale = rows.filter((r) => !isCurrent(r.rho, r.sharpen, r.calibA, r.calibB));
  console.log(
    `Řádků s predikcí: ${rows.length} | k přepočtu: ${stale.length} | aktuálních: ${rows.length - stale.length}`
  );
  if (stale.length === 0) {
    console.log("Vše sedí na aktuální parametry – není co dělat.");
    return;
  }

  let moved = 0;
  for (const r of stale) {
    const g = gridProbs(r.lambdaHome, r.lambdaAway);
    const shift = Math.max(
      Math.abs(g.homeWin - r.homeWin),
      Math.abs(g.draw - r.draw),
      Math.abs(g.awayWin - r.awayWin)
    );
    // Řádky spočítané starou verzí kódu (rho/sharpen = null) mohou vyjít beze změny –
    // pak jen dorazítkujeme parametry. Vypisuj jen skutečné posuny.
    if (shift > 0.005) {
      moved++;
      console.log(
        `${r.homeName} vs ${r.awayName}: 1X2 ` +
          `${pct(r.homeWin)}/${pct(r.draw)}/${pct(r.awayWin)} → ` +
          `${pct(g.homeWin)}/${pct(g.draw)}/${pct(g.awayWin)}`
      );
    }
    if (apply) {
      await prisma.fixturePrediction.update({
        where: { fixtureId: r.fixtureId },
        data: {
          homeWin: g.homeWin,
          draw: g.draw,
          awayWin: g.awayWin,
          over25: g.over25,
          // `bttsYes` se ZÁMĚRNĚ nepřepisuje: jako jediný trh nevzniká z mřížky, ale
          // z empirických frekvencí skórování (viz `predict.ts`), takže z uložených λ
          // ho přepočítat nejde – mřížkovou hodnotou bychom ho jen pokazili.
          rho: PREDICT_PARAMS.rho,
          sharpen: PREDICT_PARAMS.sharpen,
          calibA: PREDICT_PARAMS.calibA,
          calibB: PREDICT_PARAMS.calibB,
        },
      });
    }
  }

  console.log(
    `\n${apply ? "Přepočteno" : "K přepočtu"}: ${stale.length} řádků ` +
      `(z toho s posunem 1X2 > 0.5 p.b.: ${moved})`
  );
  if (!apply) console.log("Zapiš: npm run reprice -- --apply, pak npm run calibrate.");
}

main()
  .catch((e) => {
    console.error("❌ Přepočet selhal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
