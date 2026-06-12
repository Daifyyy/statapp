// Živá sonda API-Football – ověří klíč, kvótu a tvary odpovědí.
// Spuštění: node --env-file=.env scripts/probe.ts
import {
  fetchStatus,
  fetchLeagueTeams,
  fetchTeamFixtures,
  fetchFixtureStatistics,
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
  console.log("\n✅ Sonda OK");
}

main().catch((e) => {
  console.error("❌ Sonda selhala:", e.message);
  process.exit(1);
});
