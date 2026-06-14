// Discovery katalogu. node --env-file=.env scripts/discover.ts
const BASE = "https://v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY!;

type Season = { current?: boolean; year: number };
type LeagueRow = {
  league: { id: number; name: string };
  country: { name: string };
  seasons: Season[];
};
type TeamRow = { team: { id: number; name: string; national: boolean } };

async function api<T = unknown>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": key } });
  const json = await res.json();
  if (json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length)) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.response as T[];
}

function currentSeason(seasons: Season[]): number | undefined {
  const cur = seasons.find((s) => s.current);
  return (cur ?? seasons[seasons.length - 1])?.year;
}

async function main() {
  console.log("=== Stahuji /leagues (jednou) ===");
  const leagues = await api<LeagueRow>("/leagues");
  console.log("celkem lig:", leagues.length);

  console.log("\n=== WC kvalifikační soutěže (discovery konfederací) ===");
  const wc = leagues.filter((l) =>
    /world cup.*qualif/i.test(l.league.name)
  );
  for (const l of wc) {
    console.log(
      `id=${l.league.id} | ${l.league.name} | country=${l.country.name} | season=${currentSeason(l.seasons)}`
    );
  }

  console.log("\n=== Ověření kandidátních klubových lig ===");
  const clubIds = [39, 140, 135, 78, 61, 94, 88, 40, 144, 203, 345, 179, 197, 103, 119, 106, 218, 207];
  for (const id of clubIds) {
    const l = leagues.find((x) => x.league.id === id);
    if (l) console.log(`id=${id} OK | ${l.league.name} (${l.country.name}) | season=${currentSeason(l.seasons)}`);
    else console.log(`id=${id} ??? NENALEZENO`);
  }

  console.log("\n=== Test: vrací WC-qual /teams národní týmy? ===");
  for (const l of wc.slice(0, 6)) {
    const season = currentSeason(l.seasons)!;
    try {
      const teams = await api<TeamRow>("/teams", { league: l.league.id, season });
      const nat = teams.filter((t) => t.team.national);
      console.log(`${l.league.name} (id=${l.league.id}, s=${season}): teams=${teams.length}, national=${nat.length}, sample=${nat.slice(0,3).map((t)=>t.team.name).join(", ")}`);
    } catch (e: unknown) {
      console.log(`${l.league.name}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
