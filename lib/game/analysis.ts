// Předzápasová analýza ve stylu „Porovnání týmů" – ale z ODEHRANÉ simulované sezóny.
// Čistá agregace výsledků (žádná nová data): průměr gólů (celkově/doma/venku), forma,
// % čistých kont, pozice/body. Pohání panel „Čísla soupeře" u nejbližšího zápasu.
//
// Panel je **objektivní protiváha skautskému hlášení**: `scoutOpponent` odvozuje styl
// soupeře z jeho útoku/obrany vůči ligovému průměru, ale hlásí ho jen s nějakou
// konfidencí. Ta samá čísla (`venueStats` vs `leagueGoalsPerTeamGame`) dovolí hráči
// hlášení ověřit — a proto se ukazují venue-specificky, ne v celkovém průměru.
//
// POZOR: tenhle modul je UI vrstva, ne agency. Importuje `engine.ts` (kvůli tabulce),
// takže na něm NESMÍ stavět `scouting.ts` ani `events.ts` – jinak vznikne cyklus
// `engine → scouting → analysis → engine`. Formu berou z `form.ts`.

import { currentTable } from "./engine";
import { teamForm } from "./form";
import type { MatchResult, SeasonState } from "./types";

export interface TeamSeasonStats {
  teamId: number;
  played: number;
  rank: number;
  points: number;
  avgFor: number;
  avgAgainst: number;
  cleanSheetPct: number;
  /** Posledních až 5 zápasů (nejstarší → nejnovější). */
  form: ("W" | "D" | "L")[];
  homeAvgFor: number;
  homeAvgAgainst: number;
  homePlayed: number;
  awayAvgFor: number;
  awayAvgAgainst: number;
  awayPlayed: number;
}

/** Venue-specifický pohled na tým (jen ta čísla, která u nadcházejícího zápasu platí). */
export interface VenueStats {
  avgFor: number;
  avgAgainst: number;
  played: number;
}

function avg(sum: number, n: number): number {
  return n ? Math.round((sum / n) * 100) / 100 : 0;
}

/**
 * Průměr gólů **na tým a zápas** za celou soutěž = referenční bod pro „nad/pod ⌀ ligy".
 * Jmenovatel je `2 × počet zápasů` (každý zápas přispěje dvěma týmo-zápasy), takže se to
 * dá porovnat s `avgFor`/`avgAgainst` jednoho týmu. Prázdná sezóna → 0.
 *
 * Stejné měřítko jako `computeLeagueGoalsAvg` v `lib/data/standings.ts` (goals-per-team-game),
 * jen počítané ze simulovaných výsledků.
 */
export function leagueGoalsPerTeamGame(results: MatchResult[]): number {
  if (results.length === 0) return 0;
  const goals = results.reduce((s, r) => s + r.homeGoals + r.awayGoals, 0);
  return Math.round((goals / (results.length * 2)) * 100) / 100;
}

/**
 * Vybere z týmových statistik tu polovinu, která pro nadcházející zápas platí: hraješ-li
 * doma, tvoje domácí čísla a soupeřova venkovní. Bez toho by se „⌀ vstřelené" počítalo
 * přes obě prostředí a smazalo přesně tu informaci, kvůli které se na panel hráč dívá.
 */
export function venueStats(s: TeamSeasonStats, isHome: boolean): VenueStats {
  return isHome
    ? { avgFor: s.homeAvgFor, avgAgainst: s.homeAvgAgainst, played: s.homePlayed }
    : { avgFor: s.awayAvgFor, avgAgainst: s.awayAvgAgainst, played: s.awayPlayed };
}

/** Statistiky týmu z dosud odehraných výsledků sezóny. */
export function teamSeasonStats(
  state: SeasonState,
  teamId: number
): TeamSeasonStats {
  const table = currentTable(state);
  const row = table.find((r) => r.teamId === teamId);

  let played = 0;
  let gf = 0;
  let ga = 0;
  let cs = 0;
  let homeGf = 0;
  let homeGa = 0;
  let homeN = 0;
  let awayGf = 0;
  let awayGa = 0;
  let awayN = 0;

  for (const r of state.results) {
    const isHome = r.homeId === teamId;
    const isAway = r.awayId === teamId;
    if (!isHome && !isAway) continue;
    const forGoals = isHome ? r.homeGoals : r.awayGoals;
    const againstGoals = isHome ? r.awayGoals : r.homeGoals;
    played++;
    gf += forGoals;
    ga += againstGoals;
    if (againstGoals === 0) cs++;
    if (isHome) {
      homeGf += forGoals;
      homeGa += againstGoals;
      homeN++;
    } else {
      awayGf += forGoals;
      awayGa += againstGoals;
      awayN++;
    }
  }

  // Forma je sdílená se scoutingem i eventy (`form.ts`) – nepočítat ji potřetí.
  const form = teamForm(state.results, teamId, 5);

  return {
    teamId,
    played,
    rank: row?.rank ?? 0,
    points: row?.points ?? 0,
    avgFor: avg(gf, played),
    avgAgainst: avg(ga, played),
    cleanSheetPct: played ? Math.round((cs / played) * 100) : 0,
    form,
    homeAvgFor: avg(homeGf, homeN),
    homeAvgAgainst: avg(homeGa, homeN),
    homePlayed: homeN,
    awayAvgFor: avg(awayGf, awayN),
    awayAvgAgainst: avg(awayGa, awayN),
    awayPlayed: awayN,
  };
}
