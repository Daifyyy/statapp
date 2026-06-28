// Stáhne přestupy top-5 lig z API-Footballu do DB (aktuální okno, perspektiva klubu).
// Spuštění: NODE_OPTIONS=--use-system-ca npm run refresh-transfers
//   --league=39   jen jedna liga (cold-fill, ať cron nevyprší ~100 voláními)
//   --wipe        nejdřív smaže tabulku Transfer (jednorázová migrace ze starého zdroje)
import { runRefreshTransfers, TRANSFER_LEAGUES } from "../lib/data/transfers.ts";
import { prisma } from "../lib/db.ts";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

async function main() {
  if (process.argv.includes("--wipe")) {
    const { count } = await prisma.transfer.deleteMany({});
    console.log(`Vyčištěno ${count} starých řádků (Transfer).`);
  }

  const league = arg("league");
  const leagueIds = league ? [Number(league)] : TRANSFER_LEAGUES;
  console.log(`Stahuji přestupy z API-Footballu (ligy: ${leagueIds.join(", ")})…`);
  const stats = await runRefreshTransfers(leagueIds);
  console.log(
    `Hotovo. Ligy ${stats.leagues} | klubů ${stats.clubs} | uloženo ${stats.transfers} | ` +
      `pruned ${stats.pruned}.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
