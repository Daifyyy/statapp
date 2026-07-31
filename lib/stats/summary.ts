import type { MatchResult, MatchStat, TeamSummary, Venue } from "@/lib/types";
import { matchesVenue } from "./aggregate";

/** Z kolika nejnovějších zápasů se počítá forma a CS/FTS. */
export const FORM_SIZE = 5;
const RATE_SIZE = 10;

/**
 * Zápasy varianty seřazené od nejnovějšího – **jediný zdroj výběru formy**.
 * Exportováno, aby `formQuality.ts` počítalo nad **týmiž zápasy ve stejném pořadí**;
 * dvě nezávislé kopie tohoto filtru by se mohly tiše rozejít a UI by pak kreslilo
 * hodnocení výkonu k jinému zápasu, než ukazuje badge formy.
 *
 * Bere **jen aktuální sezónu** (`isBaseline` = minulá, u reprezentací vždy `false` → pro
 * ně se nic nemění). Proužek W/D/L i „čisté konto z posl. 10" jsou tvrzení o **formě**;
 * dokud nová sezóna nezačala, správná odpověď je „zatím nic", ne květnové výsledky
 * s logy soupeřů, které od té doby půlka kádru opustila. Minulá sezóna má vlastní
 * okno (SEASON) a čísla z ní tečou do metrik přes ně – přiznaně.
 */
export function orderedMatches(matches: MatchStat[], venue: Venue): MatchStat[] {
  return matches
    .filter((m) => !m.isBaseline && matchesVenue(m, venue))
    .sort((a, b) => b.date.localeCompare(a.date)); // nejnovější první
}

/**
 * Souhrn formy a podílů čistého konta / zápasů bez gólu pro jednu variantu.
 * Stojí mimo vážený průměr: forma je sekvence (ne číslo) a procenta dávají smysl
 * jen s jedním jasným jmenovatelem (`sampleSize`), ne s váženým mixem oken.
 */
export function computeSummary(
  matches: MatchStat[],
  venue: Venue
): TeamSummary {
  const selected = orderedMatches(matches, venue);

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
