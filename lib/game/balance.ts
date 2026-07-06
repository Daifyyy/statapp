// Balanc hry na JEDNOM místě. Mapování „síla útoku/obrany → λ", zápasové plány,
// countery, morálka a rozptyl sil ligy. Ladí se výhradně tady; cíl je realistický
// rozptyl ligy (mistr ~2.2/0.8, dno ~1.0/1.8) a náročnost (favorit ať vyhraje častěji,
// ale trenérovo rozhodnutí ať znatelně hýbe λ). Referencí jsou profily v mock/seed.ts.

import type { Plan } from "./types";

/** Meze λ (očekávané góly) – stejné jako predikční jádro, pojistka proti extrémům. */
export const MIN_LAMBDA = 0.2;
export const MAX_LAMBDA = 5;

/** Dixon–Coles ρ (korekce nízkých skóre) – publikovaný default jako v predict.ts. */
export const DC_RHO = -0.13;

/** Rozsah generovaných ratingů ligy (od nejsilnějšího po nejslabší tým). */
export const ATTACK_MIN = 0.95;
export const ATTACK_MAX = 2.35;
export const DEFENSE_BEST = 0.75; // nejlepší obrana (nejnižší obdržené)
export const DEFENSE_WORST = 1.85; // nejhorší obrana

/** Domácí výhoda: rozsah homeBoost (násobič útoku doma). */
export const HOME_BOOST_MIN = 1.05;
export const HOME_BOOST_MAX = 1.15;

/**
 * Rozptyl sil ligy: násobí odchylku ratingu od ligového průměru (`amplifySpread`).
 * >1 = mistr silnější a dno slabší → favorit dominuje realističtěji, hráč to nemá zadarmo.
 */
export const SPREAD = 1.35;

// ───────────────────────── manažerská agency (Phase 2) ─────────────────────────

/**
 * Základní efekt zápasového plánu na tvůj tým. `attack` = násobič vstřelených,
 * `concede` = násobič OBDRŽENÝCH (>1 = dostáváš víc). `balanced` = přesný no-op.
 * Countery proti stylu soupeře se přičítají zvlášť (viz plans.ts).
 */
export const PLAN_BASE: Record<Plan, { attack: number; concede: number }> = {
  balanced: { attack: 1.0, concede: 1.0 },
  open: { attack: 1.15, concede: 1.15 }, // otevřená hra: víc dáš i dostaneš
  low_block: { attack: 0.82, concede: 0.8 }, // nízký blok: zavři obranu, míň dáš
  press: { attack: 1.08, concede: 1.05 }, // presink: aktivní, mírné riziko vzadu
  counter: { attack: 1.02, concede: 0.9 }, // kontry: pevná obrana, oportunní útok
};

/** Síla counteru: správný protitah proti stylu soupeře = výhoda, špatný = postih. */
export const COUNTER_BONUS = 0.1;
export const COUNTER_PENALTY = 0.1;

/** Morálka: rozkyv λ (±) při morálce 0 vs 100 oproti neutrálním 50. */
export const MORALE_SWING = 0.06;
export const STARTING_MORALE = 50;

/** Šance, že v kole nastane náhodný event (deterministicky dle seedu+kola). */
export const EVENT_CHANCE = 0.3;

// ───────────────────────── kariéra (Phase 1C) ─────────────────────────

/** Reputace nového profilu na startu kariéry (gatuje výběr prvního klubu). */
export const STARTING_REPUTATION = 30;
