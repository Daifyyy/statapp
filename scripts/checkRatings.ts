// Rychlá kontrola produkční cesty ratingů (C2). Kluby: 0 volání API (z cache zápasů).
// Reprezentace: `national` → globální pool (stahuje soutěže, pak cache).
// Spuštění: node --env-file=.env --import tsx scripts/checkRatings.ts [ligaId|national]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLeagueRatings, getNationalRatings } from "../lib/data/realRepository.ts";
import { getTeamsByLeague } from "../lib/data/repository.ts";
import { prisma } from "../lib/db.ts";

const target = process.argv[2] ?? "39";

/** Jména reprezentací z lokální cache backtestu (jen pro čitelný výpis kontroly). */
function nationalNames(): Map<number, string> {
  const dir = join(process.cwd(), ".cache", "backtest");
  const names = new Map<number, string>();
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("nat-")) continue;
    const rows = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
      homeId: number;
      awayId: number;
      homeName: string;
      awayName: string;
    }[];
    for (const m of rows) {
      names.set(m.homeId, m.homeName);
      names.set(m.awayId, m.awayName);
    }
  }
  return names;
}

async function national() {
  const ratings = await getNationalRatings();
  if (!ratings) {
    console.log("Reprezentační ratingy nedostupné → predikce padne na okenní model.");
    return;
  }
  const names = nationalNames();
  const rows = [...ratings.entries()]
    .map(([id, s]) => ({ name: names.get(id) ?? `id ${id}`, ...s }))
    .filter((t) => t.sample >= 8) // týmy s pár zápasy nemají co říct
    .sort((a, b) => b.attack / b.defense - a.attack / a.defense);
  console.log(`Globální pool: ${ratings.size} reprezentací (1.0 = světový průměr)\n`);
  const line = (t: (typeof rows)[number]) =>
    `  ${t.name.padEnd(22)} útok ${t.attack.toFixed(2)}  obrana ${t.defense.toFixed(2)}  vzorek ${t.sample.toFixed(1)}`;
  console.log("Nejsilnější:");
  rows.slice(0, 8).forEach((t) => console.log(line(t)));
  console.log("Nejslabší:");
  rows.slice(-5).forEach((t) => console.log(line(t)));
}

const leagueId = Number(target);

async function main() {
  if (target === "national") return national();
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
