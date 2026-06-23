import type { FixtureDay, UpcomingFixture } from "@/lib/types";
import { leagueLogoUrl } from "../catalog";
import { buildTeams, LEAGUES } from "./seed";

/**
 * Mock denního rozpisu pro záložku „Zápasy" – funguje bez DB/API. Páruje mock týmy
 * z jejich lig do několika zápasů a rozprostře je na zadané dny (`YYYY-MM-DD`).
 * Deterministické (stejné jako ostatní mock generátory).
 */
function leagueMeta(leagueId: number): { name: string; logoUrl: string } {
  const l = LEAGUES.find((x) => x.id === leagueId);
  return {
    name: l?.name ?? "Liga",
    logoUrl: l?.logoUrl ?? leagueLogoUrl(leagueId),
  };
}

export function mockFixturesByDates(dates: string[]): FixtureDay[] {
  const clubs = buildTeams().filter((t) => t.entityType === "CLUB");

  // Spáruj sousední týmy ve stejné lize (1–2 vs 3–4 …) → pár zápasů na ligu.
  const byLeague = new Map<number, typeof clubs>();
  for (const t of clubs) {
    const arr = byLeague.get(t.leagueId) ?? [];
    arr.push(t);
    byLeague.set(t.leagueId, arr);
  }

  const pairs: { leagueId: number; home: typeof clubs[number]; away: typeof clubs[number] }[] = [];
  for (const [leagueId, teams] of byLeague) {
    for (let i = 0; i + 1 < teams.length; i += 2) {
      pairs.push({ leagueId, home: teams[i], away: teams[i + 1] });
    }
  }

  // Rozprostři páry rovnoměrně mezi dny; každý pár dostane výkop v podvečer.
  let fixtureId = 9_000_000;
  return dates.map((date, dayIdx) => {
    const fixtures: UpcomingFixture[] = pairs
      .filter((_, i) => i % dates.length === dayIdx)
      .map((p, i) => {
        const meta = leagueMeta(p.leagueId);
        const hour = String(16 + (i % 5)).padStart(2, "0");
        return {
          fixtureId: fixtureId++,
          leagueId: p.leagueId,
          leagueName: meta.name,
          leagueLogoUrl: meta.logoUrl,
          kickoff: `${date}T${hour}:00:00+00:00`,
          home: { id: p.home.id, name: p.home.name, logoUrl: p.home.logoUrl },
          away: { id: p.away.id, name: p.away.name, logoUrl: p.away.logoUrl },
          national: false,
          compareMode: "CLUB" as const,
          homeCompareLeagueId: p.leagueId,
          awayCompareLeagueId: p.leagueId,
        };
      })
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
    return { date, fixtures };
  });
}
