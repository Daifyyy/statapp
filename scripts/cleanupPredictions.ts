// Úklid zbytkových/testovacích řádků v `FixturePrediction`: smaže predikce lig,
// které NEJSOU v `ALL_PREDICTION_LEAGUES` (např. norská Eliteserien = 103, natažená
// při testu). Tyhle řádky se jinak drží v záložce (čtení nefiltruje podle ligy) a
// po settle by kazily i track-record.
//
// Spuštění (dry-run, jen vypíše): node --env-file=.env --import tsx scripts/cleanupPredictions.ts
// Skutečné smazání:                node --env-file=.env --import tsx scripts/cleanupPredictions.ts --apply
import { prisma } from "../lib/db.ts";
import { ALL_PREDICTION_LEAGUES } from "../lib/data/predictions.ts";

async function main() {
  const apply = process.argv.includes("--apply");

  const grouped = await prisma.fixturePrediction.groupBy({
    by: ["leagueId"],
    where: { leagueId: { notIn: ALL_PREDICTION_LEAGUES } },
    _count: { _all: true },
  });

  if (grouped.length === 0) {
    console.log("Žádné řádky mimo sledované ligy – nic k úklidu.");
    return;
  }

  console.log("Sledované ligy:", ALL_PREDICTION_LEAGUES.join(", "));
  console.log("Řádky mimo seznam (ke smazání):");
  let total = 0;
  for (const g of grouped) {
    total += g._count._all;
    console.log(`  liga ${g.leagueId}: ${g._count._all} řádků`);
  }
  console.log(`Celkem: ${total} řádků.`);

  if (!apply) {
    console.log("\n(DRY-RUN) Nic nesmazáno. Pro smazání spusť znovu s --apply.");
    return;
  }

  const res = await prisma.fixturePrediction.deleteMany({
    where: { leagueId: { notIn: ALL_PREDICTION_LEAGUES } },
  });
  console.log(`\nSmazáno ${res.count} řádků.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
