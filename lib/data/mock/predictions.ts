import type { PredictionRow, Team } from "@/lib/types";
import { compareTeams } from "@/lib/stats/compare";
import { buildTeams } from "./seed";

/**
 * Deterministické mock predikce, aby predikční záložka i track-record fungovaly
 * bez DB/API (mock režim). Predikce počítá reálným jádrem (compareTeams) nad
 * mock týmy → čísla jsou konzistentní s ostatkem appky. modelVersion = 0 (mock).
 */

function rowFrom(
  home: Team,
  away: Team,
  fixtureId: number,
  kickoff: string,
  status: string,
  homeGoals: number | null,
  awayGoals: number | null
): PredictionRow {
  const r = compareTeams(home, away);
  const p = r.prediction!;
  return {
    fixtureId,
    leagueId: home.leagueId,
    season: 2025,
    kickoff,
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeName: r.home.team.name,
    awayName: r.away.team.name,
    homeLogo: r.home.team.logoUrl,
    awayLogo: r.away.team.logoUrl,
    available: p.available,
    lambdaHome: p.lambdaHome,
    lambdaAway: p.lambdaAway,
    homeWin: p.homeWin,
    draw: p.draw,
    awayWin: p.awayWin,
    bttsYes: p.bttsYes,
    over25: p.over25,
    lowConfidence: p.lowConfidence,
    modelVersion: 0,
    status,
    homeGoals,
    awayGoals,
  };
}

/** Dvojice klubů ze stejné ligy (po sobě jdoucí). */
function clubPairs(): [Team, Team][] {
  const clubs = buildTeams().filter((t) => t.entityType === "CLUB");
  const pairs: [Team, Team][] = [];
  for (let i = 0; i + 1 < clubs.length; i += 2) {
    if (clubs[i].leagueId === clubs[i + 1].leagueId) {
      pairs.push([clubs[i], clubs[i + 1]]);
    }
  }
  return pairs;
}

const DAY = 24 * 60 * 60 * 1000;

/** Nadcházející mock predikce (status NS, výkop v budoucnu). */
export function mockUpcomingPredictions(): PredictionRow[] {
  const pairs = clubPairs().slice(0, 8);
  return pairs.map(([h, a], i) =>
    rowFrom(
      h,
      a,
      900000 + i,
      new Date(Date.now() + (i + 1) * DAY).toISOString(),
      "NS",
      null,
      null
    )
  );
}

/** Odehrané mock predikce s výsledkem (pro track-record). Každý 3. = překvapení. */
export function mockSettledPredictions(): PredictionRow[] {
  const pairs = clubPairs().slice(8, 20);
  return pairs.map(([h, a], i) => {
    const r = compareTeams(h, a);
    const p = r.prediction!;
    const homeFav = p.homeWin >= p.awayWin;
    const upset = i % 3 === 2; // občas favorit nevyjde
    const favWins = !upset;
    const [hg, ag] = favWins
      ? homeFav
        ? [2, 1]
        : [1, 2]
      : homeFav
        ? [1, 1]
        : [1, 1];
    return rowFrom(
      h,
      a,
      910000 + i,
      new Date(Date.now() - (i + 1) * DAY).toISOString(),
      "FT",
      hg,
      ag
    );
  });
}
