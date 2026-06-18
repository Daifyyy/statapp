// Import přestupů z Transfermarkt datasetu do DB (aktuální okno, top-5 kluby).
// Spuštění: NODE_OPTIONS=--use-system-ca npm run import-transfers
import { importTransfersFromDataset } from "../lib/data/transfersDataset.ts";

async function main() {
  console.log("Stahuji a importuji přestupy z TM datasetu…");
  const stats = await importTransfersFromDataset();
  console.log(
    `Hotovo. Okno od ${stats.windowStart} | prošlo ${stats.scanned} řádků | ` +
      `naše ${stats.matched} | uloženo ${stats.inserted}.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
