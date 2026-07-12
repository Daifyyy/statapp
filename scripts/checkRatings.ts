// Rychlá kontrola produkční cesty ratingů (C2) nad reálnou DB. 0 volání API.
// Spuštění: node --env-file=.env --import tsx scripts/checkRatings.ts [ligaId]
import { getLeagueRatings } from "../lib/data/realRepository.ts";
import { getTeamsByLeague } from "../lib/data/repository.ts";
import { prisma } from "../lib/db.ts";

const leagueId = Number(process.argv[2] ?? 39);

async function main() {
  const ratings = await getLeagueRatings(leagueId);
  if (!ratings) {
    console.log(`Liga ${leagueId}: ratingy nedostupné → predikce padne na okenní model.`);
    return;
  }
  const names = new Map((await getTeamsByLeague(leagueId)).map((t) => [t.id, t.name]));
  const rows = [...ratings.entries()]
    .map(([id, s]) => ({ name: names.get(id) ?? String(id), ...s }))
    .sort((a, b) => b.attack / b.defense - a.attack / a.defense);

  console.log(`Liga ${leagueId}: ${rows.length} týmů (1.0 = ligový průměr)\n`);
  const line = (t: (typeof rows)[number]) =>
    `  ${t.name.padEnd(24)} útok ${t.attack.toFixed(2)}  obrana ${t.defense.toFixed(2)}  vzorek ${t.sample.toFixed(1)}`;
  console.log("Nejsilnější:");
  rows.slice(0, 5).forEach((t) => console.log(line(t)));
  console.log("Nejslabší:");
  rows.slice(-3).forEach((t) => console.log(line(t)));
}

main()
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
