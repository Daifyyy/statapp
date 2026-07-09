// Reputace trenéra + job market. Reputace roste s úspěchem (titul, evropské poháry,
// přeplnění očekávání) a klesá při sestupu/podvýkonu. Řídí, které týmy si tě najmou.
// Čisté funkce (testovatelné). Prahy laditelné tady.
//
// ZÁMĚRNĚ NEIMPLEMENTOVÁNO: decay/"burnout" reputace na stropu 100 (dlouhá kariéra na
// elitní úrovni zůstává navždy hireable, žádný tlak udržet formu). Vyžaduje produktové
// rozhodnutí (jak přesně by decay měl fungovat, aby netrestal hráče jen za to, že je
// dobrý), ne jen inženýrskou volbu — neimplementovat bez toho rozhodnutí.

import { teamPrestige, teamStrengthScore } from "./leagues";
import {
  CHAMPION_REP,
  EUROPE_REP,
  MIN_HIREABLE_PRESTIGE,
  OBJECTIVE_MET_REP,
  PROMOTION_REP,
  RELEGATION_REP,
  REP_PERF_CLAMP,
  REP_PERF_WEIGHT,
  TOURN_CHAMPION_REP,
  TOURN_MISS_REP,
  TOURN_QUALIFY_REP,
  TOURN_STAGE_REP,
} from "./balance";
import type { GameTeam, SeasonSummary, TournamentSummary } from "./types";

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
  const championRep = summary.champion ? CHAMPION_REP : 0;
  const relegRep = summary.relegated ? RELEGATION_REP : 0;
  const promotionRep = summary.promoted ? PROMOTION_REP : 0;
  const objectiveRep = summary.objectiveMet ? OBJECTIVE_MET_REP : 0;
  // Kladné = skončil jsi líp, než se čekalo (nižší rank = lepší).
  const performance = clamp(
    summary.expectedRank - summary.yourRank,
    -REP_PERF_CLAMP,
    REP_PERF_CLAMP
  );
  const delta =
    euroRep + championRep + relegRep + promotionRep + objectiveRep + performance * REP_PERF_WEIGHT;
  return clamp(Math.round(prev + delta), 0, 100);
}

/**
 * Nová reputace po reprezentačním turnaji. Paralelní k `updateReputation` (ta čte 6 ligových
 * polí → nevolatelná). Neúspěch v kvalifikaci reputaci ubere; postup ji zvedne, dál pak dle
 * nejdál dosažené fáze, s bonusem za titul. Clamp 0–100.
 */
export function updateReputationTournament(
  prev: number,
  summary: TournamentSummary
): number {
  let delta: number;
  if (!summary.qualified) {
    delta = TOURN_MISS_REP;
  } else {
    const stageRep = TOURN_STAGE_REP[summary.stageReached] ?? 0;
    delta = TOURN_QUALIFY_REP + stageRep + (summary.champion ? TOURN_CHAMPION_REP : 0);
  }
  return clamp(Math.round(prev + delta), 0, 100);
}

/**
 * Najme si tě tým? Prestiž nesmí příliš přesáhnout reputaci – VÝJIMKA: nejmenší kluby
 * (prestiž ≤ `MIN_HIREABLE_PRESTIGE`) tě vezmou vždycky, aby kariéra po sérii sestupů
 * neuvízla ve slepé uličce (vždy existuje klub k převzetí).
 */
export function isHireable(
  team: GameTeam,
  leagueId: number,
  league: GameTeam[],
  reputation: number
): boolean {
  const prestige = teamPrestige(team, leagueId, league);
  return prestige <= MIN_HIREABLE_PRESTIGE || prestige <= reputation + HIRE_MARGIN;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
