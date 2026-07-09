// Forma týmu z odehraných výsledků. Nejmenší společný jmenovatel pro scouting, eventy
// i analytický panel — čistá funkce nad `MatchResult[]`, bez tabulky a bez `SeasonState`.
//
// Proč vlastní modul: `scoutOpponent` si formu bral z `teamSeasonStats` (`analysis.ts`),
// které kvůli tabulce importuje `engine.ts` → vznikal cyklus
// `engine → scouting → analysis → engine`. `events.ts` ho obcházel tím, že si formu
// počítal znovu vlastní kopií. Tady je jednou a bez cyklu: `form.ts` neimportuje nic
// z herního jádra, takže na něm můžou stavět všichni (liga i turnaj).

import type { MatchResult } from "./types";

export type Outcome = "W" | "D" | "L";

/** Zápasy daného týmu v pořadí, jak byly odehrány. */
export function teamMatches(results: MatchResult[], teamId: number): MatchResult[] {
  return results.filter((r) => r.homeId === teamId || r.awayId === teamId);
}

/** Góly týmu v zápase z jeho pohledu: `[vstřelené, obdržené]`. */
export function goalsFor(result: MatchResult, teamId: number): [number, number] {
  return result.homeId === teamId
    ? [result.homeGoals, result.awayGoals]
    : [result.awayGoals, result.homeGoals];
}

/** Výsledek zápasu z pohledu daného týmu. */
export function outcomeOf(result: MatchResult, teamId: number): Outcome {
  const [f, a] = goalsFor(result, teamId);
  return f > a ? "W" : f < a ? "L" : "D";
}

/** Posledních `n` výsledků týmu (nejstarší → nejnovější). Kratší, když tolik nehrál. */
export function teamForm(results: MatchResult[], teamId: number, n = 5): Outcome[] {
  return teamMatches(results, teamId)
    .slice(-n)
    .map((r) => outcomeOf(r, teamId));
}

/** Kolik z posledních `n` zápasů tým udržel čisté konto. */
export function recentCleanSheets(results: MatchResult[], teamId: number, n: number): number {
  return teamMatches(results, teamId)
    .slice(-n)
    .filter((r) => goalsFor(r, teamId)[1] === 0).length;
}

/** Kolik zápasů tým dosud odehrál. */
export function playedCount(results: MatchResult[], teamId: number): number {
  return teamMatches(results, teamId).length;
}

/**
 * Potkaly se ty dva týmy už v téhle sezóně (turnaji)? Zdroj „známosti" pro konfidenci
 * scoutingu – odvetu proti soupeři, kterého jsi už hrál, přečteš líp než premiéru.
 */
export function hasMet(results: MatchResult[], teamId: number, oppId: number): boolean {
  return results.some(
    (r) =>
      (r.homeId === teamId && r.awayId === oppId) ||
      (r.homeId === oppId && r.awayId === teamId)
  );
}
