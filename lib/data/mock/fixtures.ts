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

/**
 * Mock **živých** zápasů. Bez nich se živý režim nedá v `npm run dev` vůbec zobrazit
 * (mock `getLiveFixtures` vracel prázdno) a regrese vzniklá mimo zápasové okno by byla
 * neviditelná až do dalšího víkendu.
 *
 * Minuty jsou zvolené tak, aby pokryly všechny tři stavy živého přehledu: **12'** je pod
 * prahem („na přehled je zatím brzy"), **38'** je běžný průběh a **72'** závěr, kde se
 * zapínají i pozorování vázaná na čas.
 *
 * `fixtureId` se čísluje od 9 000 000 vzestupně přes dny, takže při běžném sedmidenním
 * okně padne každý z těchhle tří na **první zápas jiného dne** (dnes / zítra / pozítří).
 * Pro vývoj to stačí – stavy se proklikají záložkami dnů; „živý" zápas na zítřejší kartě
 * je artefakt mocku, ne chování produkce.
 */
export const MOCK_LIVE = [
  { fixtureId: 9_000_000, elapsed: 12, homeGoals: 0, awayGoals: 0, status: "1H", halftimeHome: 0, halftimeAway: 0 },
  { fixtureId: 9_000_001, elapsed: 38, homeGoals: 1, awayGoals: 0, status: "1H", halftimeHome: 1, halftimeAway: 0 },
  // Ve druhém poločase je poločasový stav skutečně poločasový → v přehledu se objeví
  // věta o vývoji po přestávce (tady 1:1 → 1:2, tedy jeden gól).
  { fixtureId: 9_000_002, elapsed: 72, homeGoals: 1, awayGoals: 2, status: "2H", halftimeHome: 1, halftimeAway: 1 },
] as const;

const MOCK_LIVE_BY_ID = new Map<number, (typeof MOCK_LIVE)[number]>(
  MOCK_LIVE.map((l) => [l.fixtureId, l])
);

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
        const id = fixtureId++;
        // Živý stav nese už SSR snapshot – jinak by se klientský poll vůbec nespustil
        // (`plausiblyLive` chce buď běžící zápas, nebo výkop v posledních 2.5 h).
        const liveState = MOCK_LIVE_BY_ID.get(id);
        return {
          fixtureId: id,
          ...(liveState
            ? {
                live: true,
                elapsed: liveState.elapsed,
                liveHome: liveState.homeGoals,
                liveAway: liveState.awayGoals,
              }
            : {}),
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
