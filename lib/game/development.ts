// Rozvoj klubu mezi sezónami. Za odehranou sezónu dostaneš **rozvojové body** podle
// výsledku (umístění, splnění cíle, titul/Evropa/postup, reputace) a rozdělíš je mezi
// útok / obranu / mládež / stadion / skauting. Čisté funkce (žádné IO), konstanty v `balance.ts`.
//
// Klíčový návrhový požadavek: **jedna dobrá sezóna nesmí udělat top tým.** Drží to tři
// nezávislé stropy:
//   1. `MAX_DEV_POINTS` (6) na sezónu – strop na to, kolik vůbec můžeš investovat,
//   2. malý zisk na bod (`DEV_ATTACK_STEP` = 0.08) – 6 bodů do útoku = +0.48,
//   3. `DEV_LEAGUE_CEILING` – nesmíš přeskočit špičku ligy o víc než 5 %.
// Ze středu tabulky do Evropy kolem 5.–6. sezóny, medián titulu 7. (`npm run sim-game`).
//
// Oblasti se liší i TRVANLIVOSTÍ, ne jen výnosem. Útok a obrana mezisezónní drift částečně
// smyje (regrese k průměru ligy), mládež ten propad tlumí, a `stadion` neregreduje vůbec –
// proto má nejnižší okamžitý výnos na bod a společný strop `HOME_BOOST_CAP`.
// `skauting` stojí stranou téhle úvahy úplně: nekupuje λ, ale JISTOTU hlášení o soupeři
// (`scoutConfidence`). Proto ho `applyDevelopment` ignoruje a `sim-game` ho nezměří.

import {
  DEV_ATTACK_STEP,
  DEV_DEFENSE_STEP,
  DEV_EUROPE_POINTS,
  DEV_LEAGUE_CEILING,
  DEV_OBJECTIVE_POINTS,
  DEV_RANK_POINTS,
  DEV_RELEGATION_POINTS,
  DEV_REPUTATION_THRESHOLD,
  DEV_STADIUM_STEP,
  DEV_TITLE_POINTS,
  DEV_YOUTH_MAX,
  DEV_YOUTH_REGRESSION_CUT,
  DRIFT_REGRESSION,
  HOME_BOOST_CAP,
  MAX_DEV_POINTS,
  SCOUT_LEVEL_MAX,
} from "./balance";
import type { GameTeam, SeasonSummary } from "./types";

/** Rozdělení rozvojových bodů. Každý bod = 1 krok v dané oblasti. */
export interface DevSpend {
  attack: number;
  defense: number;
  youth: number;
  stadium: number;
  /** Skautské oddělení – kupuje INFORMACI (konfidenci hlášení), ne sílu. Nesahá na λ. */
  scouting: number;
}

export const EMPTY_SPEND: DevSpend = {
  attack: 0,
  defense: 0,
  youth: 0,
  stadium: 0,
  scouting: 0,
};

export const DEV_AREA_LABEL: Record<keyof DevSpend, string> = {
  attack: "Útok",
  defense: "Obrana",
  youth: "Mládež",
  stadium: "Stadion",
  scouting: "Skauting",
};

export const DEV_AREA_HINT: Record<keyof DevSpend, string> = {
  attack: "Vyšší očekávané góly. Mezi sezónami mírně regreduje k průměru ligy.",
  defense: "Nižší obdržené góly. Mezi sezónami mírně regreduje k průměru ligy.",
  youth: "Tlumí mezisezónní propad ratingu — udrží, co jsi vydřel (patří klubu).",
  stadium: "Silnější domácí prostředí. Roste pomalu, ale je TRVALÝ — nikdy neklesne.",
  scouting: "Spolehlivější hlášení o soupeři. Nezvýší sílu týmu — jen tvoji jistotu.",
};

/** Kolik bodů je celkem rozděleno. */
export function spendTotal(spend: DevSpend): number {
  return (
    spend.attack + spend.defense + spend.youth + spend.stadium + spend.scouting
  );
}

/**
 * Rozvojové body za dohranou sezónu. Roste s umístěním a úspěchem, sestup ubírá,
 * silná reputace přitáhne investory. `devBonus` = kumulovaný bonus/malus z eventů
 * (`SeasonState.devBonus`). Vždy `0…MAX_DEV_POINTS` – strop je hlavní pojistka proti
 * tomu, aby jedna vydařená sezóna udělala z průměru top tým.
 */
export function developmentPoints(
  summary: SeasonSummary,
  reputation: number,
  leagueSize: number,
  devBonus = 0
): number {
  // Percentil umístění: 1. místo = 1, poslední = 0.
  const pct = leagueSize > 1 ? (leagueSize - summary.yourRank) / (leagueSize - 1) : 0.5;
  let points = Math.round(pct * DEV_RANK_POINTS);
  if (summary.objectiveMet) points += DEV_OBJECTIVE_POINTS;
  if (summary.champion || summary.promoted) points += DEV_TITLE_POINTS;
  else if (summary.europe !== "NONE") points += DEV_EUROPE_POINTS;
  if (summary.relegated) points += DEV_RELEGATION_POINTS; // záporná konstanta
  if (reputation >= DEV_REPUTATION_THRESHOLD) points += 1;
  return clamp(points + devBonus, 0, MAX_DEV_POINTS);
}

/**
 * Mezisezónní regrese TVÉHO klubu po investicích do mládeže. Každý bod mládeže ubere
 * kus regrese → dřina se nesmyje. Nikdy pod nulu (mládež nedělá z klubu neregresní).
 */
export function youthRegression(youth: number): number {
  const y = clamp(youth, 0, DEV_YOUTH_MAX);
  return Math.max(0, DRIFT_REGRESSION - y * DEV_YOUTH_REGRESSION_CUT);
}

/**
 * Aplikuje investice na tvůj tým. Volá se PO driftu (drift renormalizuje ligu na
 * zachovaný rozptyl, takže by investici jinak smyl). `league` = ostatní týmy soutěže,
 * z nich se bere strop `DEV_LEAGUE_CEILING`.
 */
export function applyDevelopment(
  team: GameTeam,
  spend: DevSpend,
  league: GameTeam[]
): GameTeam {
  const others = league.filter((t) => t.id !== team.id);
  // Špička ligy: nejvyšší útok / nejlepší (nejnižší) obrana mezi soupeři.
  const bestAttack = others.length ? Math.max(...others.map((t) => t.attack)) : team.attack;
  const bestDefense = others.length ? Math.min(...others.map((t) => t.defense)) : team.defense;

  const attackCap = bestAttack * DEV_LEAGUE_CEILING;
  const defenseFloor = bestDefense / DEV_LEAGUE_CEILING; // obrana: nižší = lepší

  // Strop se uplatní jen když tě táhne DOLŮ – kdo už je nad špičkou (třeba po sestupu
  // do slabší ligy), o nic nepřijde, jen dál neroste.
  const rawAttack = team.attack + spend.attack * DEV_ATTACK_STEP;
  const rawDefense = team.defense - spend.defense * DEV_DEFENSE_STEP;

  return {
    ...team,
    attack: round2(Math.min(rawAttack, Math.max(attackCap, team.attack))),
    defense: round2(Math.max(rawDefense, Math.min(defenseFloor, team.defense))),
    homeBoost: round2(
      Math.min(HOME_BOOST_CAP, team.homeBoost + spend.stadium * DEV_STADIUM_STEP)
    ),
  };
}

/** Nová hodnota mládeže po investici (kumulativní, se stropem). */
export function nextYouth(youth: number, spend: DevSpend): number {
  return clamp(youth + spend.youth, 0, DEV_YOUTH_MAX);
}

/**
 * Nová úroveň skautingu po investici (kumulativní, se stropem). Vědomě mimo
 * `applyDevelopment` – skauting není rating, nesahá na λ ani na drift.
 */
export function nextScouting(scouting: number, spend: DevSpend): number {
  return clamp(scouting + spend.scouting, 0, SCOUT_LEVEL_MAX);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
