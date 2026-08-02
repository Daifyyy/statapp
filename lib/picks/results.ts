import type {
  FixtureDay,
  FixtureTip,
  PredictionRow,
  SettledMatch,
} from "@/lib/types";
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

/**
 * Přiřadí odehraným zápasům náš tip (párování po `fixtureId`). Čistá funkce – mutuje
 * jen kopie, vrací nové dny.
 *
 * **Tip je překryv, ne filtr.** Zápas bez predikce projde beze změny; smyslem záložky je
 * ukázat, co se odehrálo, ne co jsme stihli tipnout. Vstupem jsou už zmapované
 * `SettledMatch` (tedy jen řádky s `available` a známým skóre) – zápas s predikcí, která
 * se nevyhodnotila, tak zůstane bez odznaku místo s prázdným.
 */
export function mergeTips(days: FixtureDay[], settled: SettledMatch[]): FixtureDay[] {
  if (settled.length === 0) return days;
  const tips = new Map<number, FixtureTip>();
  for (const s of settled) {
    tips.set(s.fixtureId, {
      side: s.predictedSide,
      prob: s.predictedProb,
      hit: s.outcomeHit,
    });
  }
  return days.map((day) => ({
    ...day,
    played: day.played.map((p) => {
      const tip = tips.get(p.fixtureId);
      return tip ? { ...p, tip } : p;
    }),
  }));
}
