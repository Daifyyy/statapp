// Rozvoj klubu mezi sezónami. Za odehranou sezónu dostaneš **rozvojové body** podle
// výsledku (umístění, splnění cíle, titul/Evropa/postup, reputace) a rozdělíš je mezi
// útok / obranu / mládež / stadion. Čisté funkce (žádné IO), konstanty v `balance.ts`.
//
// Klíčový návrhový požadavek: **jedna dobrá sezóna nesmí udělat top tým.** Drží to tři
// nezávislé stropy:
//   1. `MAX_DEV_POINTS` (6) na sezónu – strop na to, kolik vůbec můžeš investovat,
//   2. malý zisk na bod (`DEV_ATTACK_STEP` = 0.03) – 6 bodů do útoku = +0.18,
//   3. `DEV_LEAGUE_CEILING` – nesmíš přeskočit špičku ligy o víc než 5 %.
// Z čistého středu tabulky na titul to dělá zhruba 4–6 sezón konzistentního přeplňování
// cíle (ověřeno `npm run sim-game`).

import {
  DEV_ATTACK_STEP,
  DEV_DEFENSE_STEP,
  DEV_EUROPE_POINTS,
  DEV_LEAGUE_CEILING,
  DEV_OBJECTIVE_POINTS,
  DEV_RANK_POINTS,
  DEV_RELEGATION_POINTS,
  DEV_REPUTATION_THRESHOLD,
  DEV_STADIUM_MAX,
  DEV_STADIUM_STEP,
  DEV_TITLE_POINTS,
  DEV_YOUTH_MAX,
  DEV_YOUTH_REGRESSION_CUT,
  DRIFT_REGRESSION,
  MAX_DEV_POINTS,
} from "./balance";
import type { GameTeam, SeasonSummary } from "./types";

/** Rozdělení rozvojových bodů. Každý bod = 1 krok v dané oblasti. */
export interface DevSpend {
  attack: number;
  defense: number;
  youth: number;
  stadium: number;
}

export const EMPTY_SPEND: DevSpend = { attack: 0, defense: 0, youth: 0, stadium: 0 };

export const DEV_AREA_LABEL: Record<keyof DevSpend, string> = {
  attack: "Útok",
  defense: "Obrana",
  youth: "Mládež",
  stadium: "Stadion",
};

export const DEV_AREA_HINT: Record<keyof DevSpend, string> = {
  attack: "Vyšší očekávané góly tvého týmu.",
  defense: "Nižší očekávané obdržené góly.",
  youth: "Menší mezisezónní propad ratingu — udrží, co jsi vydřel.",
  stadium: "Silnější domácí prostředí (homeBoost).",
};

/** Kolik bodů je celkem rozděleno. */
export function spendTotal(spend: DevSpend): number {
  return spend.attack + spend.defense + spend.youth + spend.stadium;
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
      Math.min(DEV_STADIUM_MAX, team.homeBoost + spend.stadium * DEV_STADIUM_STEP)
    ),
  };
}

/** Nová hodnota mládeže po investici (kumulativní, se stropem). */
export function nextYouth(youth: number, spend: DevSpend): number {
  return clamp(youth + spend.youth, 0, DEV_YOUTH_MAX);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
