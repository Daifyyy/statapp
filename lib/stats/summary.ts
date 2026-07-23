import type { MatchResult, MatchStat, TeamSummary, Venue } from "@/lib/types";
import { matchesVenue } from "./aggregate";

/** Z kolika nejnovějších zápasů se počítá forma a CS/FTS. */
const FORM_SIZE = 5;
const RATE_SIZE = 10;

/**
 * Souhrn formy a podílů čistého konta / zápasů bez gólu pro jednu variantu.
 * Stojí mimo vážený průměr: forma je sekvence (ne číslo) a procenta dávají smysl
 * jen s jedním jasným jmenovatelem (`sampleSize`), ne s váženým mixem oken.
 */
export function computeSummary(
  matches: MatchStat[],
  venue: Venue
): TeamSummary {
  const selected = matches
    .filter((m) => matchesVenue(m, venue))
    .sort((a, b) => b.date.localeCompare(a.date)); // nejnovější první

  const formMatches = selected.slice(0, FORM_SIZE);
  const form = formMatches.map(resultOf);
  const formOpponents = formMatches.map((m) => m.opponent ?? null);

  const sample = selected.slice(0, RATE_SIZE);
  const sampleSize = sample.length;
  const cleanSheets = sample.filter((m) => m.metrics.GOALS_AGAINST === 0).length;
  const failedToScore = sample.filter((m) => m.metrics.GOALS_FOR === 0).length;

  return {
    venue,
    form,
    formOpponents,
    formSampleSize: form.length,
    cleanSheetPct: sampleSize ? Math.round((cleanSheets / sampleSize) * 100) : null,
    failedToScorePct: sampleSize
      ? Math.round((failedToScore / sampleSize) * 100)
      : null,
    sampleSize,
  };
}

/** Souhrn pro všechny varianty (HOME/AWAY/TOTAL). */
export function computeAllSummaries(matches: MatchStat[]): TeamSummary[] {
  return (["HOME", "AWAY", "TOTAL"] as Venue[]).map((v) =>
    computeSummary(matches, v)
  );
}

function resultOf(m: MatchStat): MatchResult {
  const gf = m.metrics.GOALS_FOR ?? 0;
  const ga = m.metrics.GOALS_AGAINST ?? 0;
  if (gf > ga) return "W";
  if (gf < ga) return "L";
  return "D";
}
