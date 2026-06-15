// Živá sonda API-Football – ověří klíč, kvótu a tvary odpovědí.
// Spuštění: node --env-file=.env scripts/probe.ts
import {
  fetchStatus,
  fetchLeagueTeams,
  fetchTeamFixtures,
  fetchFixtureStatistics,
  fetchLeagueUpcomingFixtures,
  fetchFixturesByIds,
  FINISHED_STATUSES,
} from "../lib/data/apiFootball.ts";

const PREMIER_LEAGUE = 39;
const SEASON = 2023; // dokončená sezóna → jistě má data
const MAN_CITY = 50;

async function main() {
  console.log("=== /status ===");
  const status = await fetchStatus();
  console.log("plán:", status.subscription?.plan, "| aktivní:", status.subscription?.active);
  console.log("kvóta:", status.requests?.current, "/", status.requests?.limit_day);

  console.log("\n=== /teams (Premier League 2023) ===");
  const teams = await fetchLeagueTeams(PREMIER_LEAGUE, SEASON);
  console.log("počet týmů:", teams.length, "| první:", teams[0]?.team.name, teams[0]?.team.id);

  console.log("\n=== /fixtures (Man City, PL 2023) ===");
  const fixtures = await fetchTeamFixtures(MAN_CITY, PREMIER_LEAGUE, SEASON);
  const finished = fixtures.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short));
  console.log("zápasů celkem:", fixtures.length, "| odehraných:", finished.length);
  const f0 = finished[0];
  console.log("ukázka:", {
    id: f0?.fixture.id,
    date: f0?.fixture.date,
    homeId: f0?.teams.home.id,
    awayId: f0?.teams.away.id,
    goals: f0?.goals,
  });

  console.log("\n=== /fixtures/statistics (první odehraný zápas) ===");
  if (f0) {
    const stats = await fetchFixtureStatistics(f0.fixture.id);
    for (const teamStats of stats) {
      const types = teamStats.statistics.map((s) => `${s.type}=${s.value}`);
      console.log(`tým ${teamStats.team.id}:`, types.join(", "));
    }
  }
  console.log("\n=== /fixtures?next= (nadcházející, Premier League) ===");
  const upcoming = await fetchLeagueUpcomingFixtures(PREMIER_LEAGUE, 5);
  console.log("nadcházejících:", upcoming.length);
  const u0 = upcoming[0];
  console.log("ukázka:", {
    id: u0?.fixture.id,
    date: u0?.fixture.date,
    status: u0?.fixture.status.short,
    season: u0?.league.season,
    homeId: u0?.teams.home.id,
    awayId: u0?.teams.away.id,
    goals: u0?.goals, // očekáváme {home:null, away:null}
  });

  // V létě jsou top ligy mimo sezónu → ověř i ligu, která v červnu hraje (Norsko 103).
  console.log("\n=== /fixtures?next= (Eliteserien 103, letní sezóna) ===");
  const upNor = await fetchLeagueUpcomingFixtures(103, 5);
  console.log("nadcházejících:", upNor.length);
  const n0 = upNor[0];
  console.log("ukázka:", {
    id: n0?.fixture.id,
    date: n0?.fixture.date,
    status: n0?.fixture.status.short,
    season: n0?.league.season,
    homeId: n0?.teams.home.id,
    awayId: n0?.teams.away.id,
    goals: n0?.goals,
  });

  const probeFixtureId = u0?.fixture.id ?? n0?.fixture.id;
  if (probeFixtureId) {
    console.log("\n=== /fixtures?ids= (batch dle ID) ===");
    const byId = await fetchFixturesByIds([probeFixtureId]);
    console.log("vráceno:", byId.length, "| status:", byId[0]?.fixture.status.short);
  }

  console.log("\n✅ Sonda OK");
}

main().catch((e) => {
  console.error("❌ Sonda selhala:", e.message);
  process.exit(1);
});
