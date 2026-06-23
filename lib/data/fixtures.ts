import type { UpcomingFixture } from "@/lib/types";
import { FINISHED_STATUSES, type ApiFixture } from "./apiFootball";
import {
  FIXTURE_LIST_LEAGUE_IDS,
  isNationalTournamentLeague,
  leagueLogoUrl,
} from "./catalog";

const FIXTURE_LEAGUES = new Set(FIXTURE_LIST_LEAGUE_IDS);

/**
 * Profiltruje a normalizuje syrové zápasy z `/fixtures?date=` na lehký tvar pro
 * záložku „Zápasy": jen naše ligy (`FIXTURE_LEAGUES`), bez dohraných
 * (`FINISHED_STATUSES`), seřazené dle výkopu. Čistá funkce (testovatelná, bez DB).
 *
 * Cíl deep-linku: klub → CLUB mód s `leagueId` u obou týmů; reprezentace → NATIONAL mód,
 * kde „ligou" je konfederace týmu – tu zde neznáme (potřebuje cachované seznamy), proto
 * `null` a dotahuje ji `getFixturesByDates` (real). Mock plní klubové fixtures rovnou.
 */
export function normalizeUpcomingFixtures(raw: ApiFixture[]): UpcomingFixture[] {
  return raw
    .filter(
      (f) =>
        FIXTURE_LEAGUES.has(f.league.id) &&
        !FINISHED_STATUSES.has(f.fixture.status.short)
    )
    .map((f) => {
      const national = isNationalTournamentLeague(f.league.id);
      return {
        fixtureId: f.fixture.id,
        leagueId: f.league.id,
        leagueName: f.league.name,
        leagueLogoUrl: leagueLogoUrl(f.league.id),
        kickoff: f.fixture.date,
        home: { id: f.teams.home.id, name: f.teams.home.name, logoUrl: f.teams.home.logo },
        away: { id: f.teams.away.id, name: f.teams.away.name, logoUrl: f.teams.away.logo },
        national,
        compareMode: national ? ("NATIONAL" as const) : ("CLUB" as const),
        homeCompareLeagueId: national ? null : f.league.id,
        awayCompareLeagueId: national ? null : f.league.id,
      };
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
