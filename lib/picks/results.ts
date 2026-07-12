import type { PredictionRow, SettledMatch } from "@/lib/types";
import { isNationalTournamentLeague, leagueLogoUrl } from "@/lib/data/catalog";
import { actualOutcome, argmaxOutcome, probOfSide } from "./trackRecord";

/**
 * Zmapuje odehrané predikce na výsledkové řádky pro záložku „Výsledky" (jak dopadly
 * naše predikce). Čistá funkce – jen řádky s dostupnou predikcí a známým skóre.
 * Klub → CLUB deep-link (liga = `leagueId`); reprezentační turnaj → NATIONAL mód,
 * konfederace doplní volající (real data), jinak `null` = neklikací řádek.
 */
export function summarizeSettled(rows: PredictionRow[]): SettledMatch[] {
  const out: SettledMatch[] = [];
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const predictedSide = argmaxOutcome(r);
    const national = isNationalTournamentLeague(r.leagueId);
    out.push({
      fixtureId: r.fixtureId,
      leagueId: r.leagueId,
      leagueLogoUrl: leagueLogoUrl(r.leagueId),
      kickoff: r.kickoff,
      home: { id: r.homeTeamId, name: r.homeName, logoUrl: r.homeLogo },
      away: { id: r.awayTeamId, name: r.awayName, logoUrl: r.awayLogo },
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
      afterExtraTime: r.status === "AET" || r.status === "PEN",
      predictedSide,
      predictedProb: probOfSide(r, predictedSide),
      outcomeHit: predictedSide === actualOutcome(r.homeGoals, r.awayGoals),
      compareMode: national ? "NATIONAL" : "CLUB",
      homeCompareLeagueId: national ? null : r.leagueId,
      awayCompareLeagueId: national ? null : r.leagueId,
    });
  }
  // Nejnovější první (řádky z DB jsou už kickoff desc, ale mock parita to nezaručí).
  return out.sort((a, b) => b.kickoff.localeCompare(a.kickoff));
}
