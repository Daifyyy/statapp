// Předzápasová analýza ve stylu „Porovnání týmů" – ale z ODEHRANÉ simulované sezóny.
// Čistá agregace výsledků (žádná nová data): průměr gólů (celkově/doma/venku), forma,
// % čistých kont, pozice/body. Pohání panel u predikce nejbližšího zápasu.
//
// POZOR: tenhle modul je UI vrstva, ne agency. Importuje `engine.ts` (kvůli tabulce),
// takže na něm NESMÍ stavět `scouting.ts` ani `events.ts` – jinak vznikne cyklus
// `engine → scouting → analysis → engine`. Formu berou z `form.ts`.

import { currentTable } from "./engine";
import { teamForm } from "./form";
import type { SeasonState } from "./types";

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
  awayAvgFor: number;
  awayAvgAgainst: number;
}

function avg(sum: number, n: number): number {
  return n ? Math.round((sum / n) * 100) / 100 : 0;
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
    awayAvgFor: avg(awayGf, awayN),
    awayAvgAgainst: avg(awayGa, awayN),
  };
}
