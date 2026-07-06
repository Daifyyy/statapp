// Balanc hry na JEDNOM místě. Mapování „síla útoku/obrany → λ" a taktické páky.
// Ladí se výhradně tady; cíl je realistický rozptyl ligy (mistr ~2.2/0.8, dno ~1.0/1.8),
// referencí jsou profily v lib/data/mock/seed.ts. Viz test „silnější tým vyhraje častěji".

import type { Tactic } from "./types";

/** Meze λ (očekávané góly) – stejné jako predikční jádro, pojistka proti extrémům. */
export const MIN_LAMBDA = 0.2;
export const MAX_LAMBDA = 5;

/** Dixon–Coles ρ (korekce nízkých skóre) – publikovaný default jako v predict.ts. */
export const DC_RHO = -0.13;

/**
 * Taktické multiplikátory. `attack` = násobič vstřelených, `defense` = násobič
 * OBDRŽENÝCH (>1 = dostáváš víc). Útočná = víc dáš i dostaneš (vysoká variance),
 * defenzivní = míň gólů na obou stranách (zavři obranu proti favoritovi).
 */
export const TACTIC_MULT: Record<Tactic, { attack: number; defense: number }> = {
  attack: { attack: 1.15, defense: 1.15 },
  balanced: { attack: 1, defense: 1 },
  defense: { attack: 0.85, defense: 0.85 },
};

/** Rozsah generovaných ratingů ligy (od nejsilnějšího po nejslabší tým). */
export const ATTACK_MIN = 0.95;
export const ATTACK_MAX = 2.35;
export const DEFENSE_BEST = 0.75; // nejlepší obrana (nejnižší obdržené)
export const DEFENSE_WORST = 1.85; // nejhorší obrana

/** Domácí výhoda: rozsah homeBoost (násobič útoku doma). */
export const HOME_BOOST_MIN = 1.05;
export const HOME_BOOST_MAX = 1.15;
