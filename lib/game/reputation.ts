// Reputace trenéra + job market. Reputace roste s úspěchem (titul, evropské poháry,
// přeplnění očekávání) a klesá při sestupu/podvýkonu. Řídí, které týmy si tě najmou.
// Čisté funkce (testovatelné). Prahy laditelné tady.

import { teamPrestige, teamStrengthScore } from "./leagues";
import type { EuropeSpot, GameTeam, SeasonSummary } from "./types";

/** Bonus k reputaci za evropskou příčku (základní fáze > předkolo). */
const EUROPE_REP: Record<EuropeSpot, number> = {
  UCL: 6,
  UCL_Q: 4,
  UEL: 3,
  UEL_Q: 2,
  UECL: 2,
  UECL_Q: 1,
  NONE: 0,
};

/** O kolik smí prestiž týmu přesáhnout reputaci, aby tě přesto najal (mírné natažení). */
export const HIRE_MARGIN = 4;

/** Očekávané umístění týmu = jeho pořadí síly v lize (1 = nejsilnější). */
export function expectedRank(team: GameTeam, league: GameTeam[]): number {
  const sorted = [...league].sort(
    (a, b) => teamStrengthScore(b) - teamStrengthScore(a)
  );
  return sorted.findIndex((t) => t.id === team.id) + 1;
}

/**
 * Nová reputace po sezóně. Kombinuje výsledek (poháry/sestup), over/under-performance
 * vůči očekávanému umístění a splnění sezónního cíle. Plynulá změna, clamp 0–100.
 */
export function updateReputation(
  prev: number,
  summary: SeasonSummary
): number {
  const euroRep = EUROPE_REP[summary.europe];
  const championRep = summary.champion ? 6 : 0;
  const relegRep = summary.relegated ? -12 : 0;
  const objectiveRep = summary.objectiveMet ? 3 : 0;
  // Kladné = skončil jsi líp, než se čekalo (nižší rank = lepší).
  const performance = clamp(summary.expectedRank - summary.yourRank, -10, 10);
  const delta = euroRep + championRep + relegRep + objectiveRep + performance * 0.6;
  return clamp(Math.round(prev + delta), 0, 100);
}

/** Najme si tě tým? Prestiž týmu nesmí příliš přesáhnout tvou reputaci. */
export function isHireable(
  team: GameTeam,
  leagueId: number,
  league: GameTeam[],
  reputation: number
): boolean {
  return teamPrestige(team, leagueId, league) <= reputation + HIRE_MARGIN;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
