// Generátor crosswalku API-Football team id ↔ Transfermarkt club_id pro top-5 ligy.
// Spuštění: NODE_OPTIONS=--use-system-ca node --env-file=.env --import tsx scripts/buildCrosswalk.ts
// Výstup ručně zkontrolovat a uložit do lib/data/clubCrosswalk.ts.
import { gunzipSync } from "node:zlib";
import { getTeamsByLeague } from "../lib/data/repository.ts";

const BASE = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data";

// naše leagueId → TM domestic_competition_id
const LEAGUE_TO_COMP: Record<number, string> = {
  39: "GB1",
  140: "ES1",
  135: "IT1",
  78: "L1",
  61: "FR1",
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(
      /\b(fc|cf|afc|ac|ssc|us|uc|sc|ss|ud|cd|rc|rcd|sv|sd|vfb|vfl|tsg|fsv|bsc|calcio|club|football|deportivo|de|the|1899|1900|1904|1907|1909|1846|05|04|08|1846)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean));
}

function score(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (na && nb && na === nb) return 1;
  // substring normalizovaných řetězců (Lyon ⊂ Lyonnais, Sevilla ⊂ Sevilla Futbol)
  const ca = na.replace(/ /g, "");
  const cb = nb.replace(/ /g, "");
  if (ca && cb && (cb.includes(ca) || ca.includes(cb))) return 0.9;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  if (shared === Math.min(ta.size, tb.size)) return 0.8; // jedna množina je podmnožinou
  return shared / new Set([...ta, ...tb]).size;
}

async function main() {
  const clubs = (
    gunzipSync(Buffer.from(await (await fetch(`${BASE}/clubs.csv.gz`)).arrayBuffer()))
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean)
  ).map((l) => l.split(","));
  const ch = clubs[0];
  const cId = ch.indexOf("club_id");
  const cName = ch.indexOf("name");
  const cComp = ch.indexOf("domestic_competition_id");
  const cLast = ch.indexOf("last_season");

  const byComp: Record<string, { id: string; name: string }[]> = {};
  for (const r of clubs.slice(1)) {
    if (Number(r[cLast]) < 2024) continue;
    const comp = r[cComp];
    if (!Object.values(LEAGUE_TO_COMP).includes(comp)) continue;
    (byComp[comp] ??= []).push({ id: r[cId], name: r[cName] });
  }

  const mapLines: string[] = [];
  const review: string[] = [];

  for (const [leagueIdStr, comp] of Object.entries(LEAGUE_TO_COMP)) {
    const leagueId = Number(leagueIdStr);
    const apiTeams = await getTeamsByLeague(leagueId);
    const tmClubs = byComp[comp] ?? [];
    console.log(`\n=== liga ${leagueId} (${comp}): API ${apiTeams.length} / TM ${tmClubs.length} ===`);
    for (const a of apiTeams) {
      let best: { id: string; name: string } | null = null;
      let bestScore = 0;
      for (const c of tmClubs) {
        const sc = score(a.name, c.name);
        if (sc > bestScore) {
          bestScore = sc;
          best = c;
        }
      }
      const flag = bestScore >= 0.6 ? "OK " : "?? ";
      const line = `${flag}api ${a.id} "${a.name}" -> tm ${best?.id ?? "—"} "${best?.name ?? "—"}" (${bestScore.toFixed(2)})`;
      console.log("  " + line);
      if (best && bestScore >= 0.6) {
        mapLines.push(`  ${best.id}: { apiId: ${a.id}, leagueId: ${leagueId} }, // ${a.name} = ${best.name}`);
      } else {
        review.push(line);
        // vypiš kandidáty dané ligy k ruční volbě
        review.push(
          "    kandidáti: " + tmClubs.map((c) => `${c.id}:${c.name}`).join(" | ")
        );
      }
    }
  }

  console.log("\n\n// ===== NÁVRH MAPY (tmClubId -> {apiId, leagueId}) =====");
  console.log("export const TM_TO_API: Record<number, { apiId: number; leagueId: number }> = {");
  mapLines.forEach((l) => console.log(l));
  console.log("};");
  console.log(`\n// K RUČNÍ KONTROLE (${review.length}):`);
  review.forEach((l) => console.log("// " + l));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
