import { getCompareTeam } from "./repository";
import { compareTeams } from "@/lib/stats/compare";
import {
  fetchLeagueUpcomingFixtures,
  fetchFixturesByIds,
  FINISHED_STATUSES,
} from "./apiFootball";
import {
  upsertPrediction,
  getUnsettledPredictions,
  applyResult,
} from "./predictionStore";

/**
 * Orchestrace predikční pipeline (běží jen na pozadí / cron, real data).
 * predict-upcoming: pro Top 5 lig spočítá predikce nadcházejících zápasů a uloží.
 * settle-results: u odehraných predikcí dotáhne skutečný výsledek.
 */

/** Verze modelu – bump při změně DC_RHO/logiky (kvůli kalibraci per verzi). */
export const MODEL_VERSION = 1;

/** Sledované soutěže (uživatelská volba: Top 5 lig). */
export const PREDICTION_LEAGUES = [39, 140, 135, 78, 61];

/** Kolik nejbližších zápasů ligy predikovat (pokryje kolo + rezervu). */
const UPCOMING_PER_LEAGUE = 15;

/**
 * Spočítá a uloží predikce nadcházejících zápasů. `leagueIds` umožní ruční/dávkový
 * běh jedné ligy (mimo sezónu Top 5 vrací prázdno). Idempotentní (upsert).
 */
export async function runPredictUpcoming(
  leagueIds: number[] = PREDICTION_LEAGUES
): Promise<{ leagues: number; fixtures: number; predicted: number }> {
  let fixtures = 0;
  let predicted = 0;
  for (const leagueId of leagueIds) {
    let upcoming;
    try {
      upcoming = await fetchLeagueUpcomingFixtures(leagueId, UPCOMING_PER_LEAGUE);
    } catch {
      continue; // výpadek jedné ligy nezastaví ostatní
    }
    for (const f of upcoming) {
      fixtures++;
      try {
        const [home, away] = await Promise.all([
          getCompareTeam(f.teams.home.id, leagueId, false),
          getCompareTeam(f.teams.away.id, leagueId, false),
        ]);
        if (!home || !away) continue;
        const result = compareTeams(home, away);
        const p = result.prediction;
        if (!p) continue;
        await upsertPrediction({
          fixtureId: f.fixture.id,
          leagueId,
          season: f.league.season,
          kickoff: f.fixture.date,
          homeTeamId: f.teams.home.id,
          awayTeamId: f.teams.away.id,
          homeName: result.home.team.name,
          awayName: result.away.team.name,
          homeLogo: result.home.team.logoUrl,
          awayLogo: result.away.team.logoUrl,
          available: p.available,
          lambdaHome: p.lambdaHome,
          lambdaAway: p.lambdaAway,
          homeWin: p.homeWin,
          draw: p.draw,
          awayWin: p.awayWin,
          bttsYes: p.bttsYes,
          over25: p.over25,
          lowConfidence: p.lowConfidence,
          modelVersion: MODEL_VERSION,
        });
        predicted++;
      } catch {
        // přeskoč problémový zápas, pokračuj dál
      }
    }
  }
  return { leagues: leagueIds.length, fixtures, predicted };
}

/** Dotáhne výsledky u predikcí, jejichž zápas už proběhl (batch po 20 ID). */
export async function runSettleResults(): Promise<{
  pending: number;
  settled: number;
}> {
  const pending = await getUnsettledPredictions();
  let settled = 0;
  for (let i = 0; i < pending.length; i += 20) {
    const chunk = pending.slice(i, i + 20);
    let fixtures;
    try {
      fixtures = await fetchFixturesByIds(chunk.map((p) => p.fixtureId));
    } catch {
      continue;
    }
    for (const f of fixtures) {
      if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
      await applyResult(
        f.fixture.id,
        f.fixture.status.short,
        f.goals.home,
        f.goals.away
      );
      settled++;
    }
  }
  return { pending: pending.length, settled };
}
