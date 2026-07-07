// Balanc hry na JEDNOM místě. Mapování „síla útoku/obrany → λ", zápasové plány,
// countery, morálka a rozptyl sil ligy. Ladí se výhradně tady; cíl je realistický
// rozptyl ligy (mistr ~2.2/0.8, dno ~1.0/1.8) a náročnost (favorit ať vyhraje častěji,
// ale trenérovo rozhodnutí ať znatelně hýbe λ). Referencí jsou profily v mock/seed.ts.
//
// POZOR – stav ladění (podobně jako LAMBDA_SHARPEN v predict.ts): tyto konstanty jsou
// RUČNĚ odhadnuté/empiricky vyzkoušené na malém počtu odehraných sezón (řádově desítky,
// ne stovky), NE statisticky kalibrované na velkém objemu dat. Empirická čísla v CLAUDE.md
// (mistr ~80 b, poslední ~26 b, adaptivní plán ~+2.4 b/sezónu) jsou orientační ověření
// směru, ne přesná kalibrace. Než tyto hodnoty měnit na základě "pocitu" z pár her, počkej
// na větší vzorek odehraných karier (desítky+) napříč různými hráči.

import type { EuropeSpot, Plan } from "./types";

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

// Meze po roztažení rozptylu (amplifySpread) – širší než generační rozsah, ať SPREAD
// nekomprimuje špičku zpět (λ je stejně stropované MAX_LAMBDA).
export const SPREAD_ATTACK_MIN = 0.4;
export const SPREAD_ATTACK_MAX = 3.4;
export const SPREAD_DEFENSE_MIN = 0.4;
export const SPREAD_DEFENSE_MAX = 3.2;

/** Shrinkage konstanta pro odhad ratingu z malého vzorku zápasů (`shrink` v teams.ts). */
export const SHRINK_K = 3;

/**
 * Mezisezónní drift ratingu (`driftTeams` v career.ts): regrese ke středu ligy +
 * náhodný šum, ať pořadí sil mezi sezónami mírně kolísá.
 */
export const DRIFT_REGRESSION = 0.1;
export const DRIFT_NOISE = 0.25;

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

/**
 * Vývoj morálky po zápase (`updateMorale` v morale.ts): základní posun dle výsledku
 * (výhra/prohra/remíza), bonus/postih za překvapivý výsledek (výhra nad silnějším /
 * prohra se slabším), a pomalá regrese ke středu (50), ať se morálka nezasekne.
 */
export const MORALE_OUTCOME_DELTA = { win: 8, loss: -8, draw: 1 };
export const MORALE_SURPRISE_BONUS = 5;
export const MORALE_DRIFT = 0.05;

/**
 * Prahy scoutingu soupeře (`scoutOpponent` v scouting.ts): jak velký rozdíl
 * útok/obrana oproti ligovému průměru už znamená "attacking"/"defensive" styl nebo
 * trait (silný útok/děravá obrana/pevná obrana), a jak velký rozdíl síly = favorit/outsider.
 */
export const SCOUT_STYLE_GAP = 0.1;
export const SCOUT_TRAIT_RATIO_HIGH = 1.1;
export const SCOUT_TRAIT_RATIO_LOW = 0.9;
export const SCOUT_STRENGTH_GAP = 0.25;

/**
 * Měkký strop na KOMBINOVANÉ stohování plán × counter × morálka × eventové modifikátory
 * (`resolveAdjust` v engine.ts). Bez něj by "perfektní bouře" (správný counter + morálka
 * 100 + stacknuté eventy) mohla poslat attack/concede mimo rozumný rozsah, i když každý
 * systém sám o sobě je odladěný na menší výkyv. `MIN_LAMBDA`/`MAX_LAMBDA` chrání jen
 * konečnou λ, ne tento mezikrok.
 */
export const ADJUST_MIN = 0.7;
export const ADJUST_MAX = 1.4;

/** Šance, že v kole nastane náhodný event (deterministicky dle seedu+kola). */
export const EVENT_CHANCE = 0.3;

// ───────────────────────── kariéra (Phase 1C) ─────────────────────────

/** Reputace nového profilu na startu kariéry (gatuje výběr prvního klubu). */
export const STARTING_REPUTATION = 30;

/**
 * Reputace po sezóně (`updateReputation` v reputation.ts): bonus za evropskou příčku
 * (základní fáze > předkolo), titul, sestup, splnění cíle + over/under-performance vůči
 * očekávanému umístění (clamp ± `REP_PERF_CLAMP`, váha `REP_PERF_WEIGHT`).
 */
export const EUROPE_REP: Record<EuropeSpot, number> = {
  UCL: 6,
  UCL_Q: 4,
  UEL: 3,
  UEL_Q: 2,
  UECL: 2,
  UECL_Q: 1,
  NONE: 0,
};
export const CHAMPION_REP = 6;
export const RELEGATION_REP = -12;
export const PROMOTION_REP = 8;
export const OBJECTIVE_MET_REP = 3;
export const REP_PERF_CLAMP = 10;
export const REP_PERF_WEIGHT = 0.6;

/**
 * Spodní patro job marketu (pojistka proti uvíznutí kariéry): kluby s prestiží ≤ tohoto
 * prahu si tě najmou VŽDY, bez ohledu na reputaci ("nejmenší ryba vezme kohokoliv").
 * Zajišťuje, že i po několika sestupech za sebou existuje klub, který můžeš vzít –
 * kariéra nikdy neskončí ve slepé uličce. Kryje nejslabší kluby malých lig i 2. ligy.
 */
export const MIN_HIREABLE_PRESTIGE = 40;

/** Posun/rozsah prestiže týmu v rámci ligy (`teamPrestige` v leagues.ts). */
export const PRESTIGE_SHIFT = -18;
export const PRESTIGE_SCALE = 34;
