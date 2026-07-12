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

/**
 * Skóre po **90 minutách** (regulérní hrací doba) – to, co predikuje model.
 *
 * `fixture.goals` je koncové skóre, takže u zápasů rozhodnutých v prodloužení (`AET`)
 * nebo na penalty (`PEN`) nese góly ze 120 minut: vyřazovací zápas 1:1 po 90 min
 * skončí v `goals` jako 2:1 → settle by z remízy udělal výhru a kalibrace by z toho
 * počítala 1X2, Over 2.5 i Dixon–Coles ρ proti tomu, co model vůbec nemodeluje.
 * `score.fulltime` drží stav po 90 min → settle bere jeho.
 *
 * Fallback na `goals` je pro případ, že API `score` nevrátí (u `FT` jsou obě hodnoty
 * shodné, takže fallback nic nezkreslí). `null` = skóre neznámé.
 */
export function fullTimeGoals(
  f: ApiFixture
): { home: number; away: number } | null {
  const ft = f.score?.fulltime;
  if (typeof ft?.home === "number" && typeof ft?.away === "number") {
    return { home: ft.home, away: ft.away };
  }
  const { home, away } = f.goals;
  if (home == null || away == null) return null;
  return { home, away };
}
