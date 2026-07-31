import type { MatchStat } from "@/lib/types";

/** Soutěžní zápas má plnou váhu, přátelák nižší. §3.4b */
export const FRIENDLY_WEIGHT = 0.4;

/**
 * Váha jednoho zápasu uvnitř okna: soutěžní zápas 1.0, přátelák `FRIENDLY_WEIGHT`.
 *
 * Platí pro **oba typy entit**. U reprezentací to bylo vždycky (kvalifikace/turnaj
 * vs. přáteláky), kluby dřív dostávaly natvrdo 1.0 s odůvodněním, že ligové fixtures
 * jsou soutěžní vždycky. To sedí pro hlavní cestu, ale ne pro **fallback nováčka**
 * (`buildClubTeam` → `fetchLastFixtures`, zápasy napříč soutěžemi): tam se v červenci
 * a srpnu tahá letní příprava proti soupeřům o několik pater níž a počítala se stejnou
 * vahou jako ligové kolo. Vědomě jde o tutéž konstantu – club-specific hodnotu není
 * na čem fitnout, a nefitnuté druhé číslo je horší než sdílené.
 */
export function matchWeight(match: MatchStat): number {
  return match.competitive ? 1 : FRIENDLY_WEIGHT;
}
