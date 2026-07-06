// Trvalý manažerský profil (síň slávy) – čisté funkce nad rekordy napříč všemi
// kariérami. Foldují se sem dohrané sezóny; přežívá „Novou kariéru". Rekordy pohání
// profilový panel i vyhodnocení achievementů. Žádné IO.

import type { AllTimeRecords, ManagerProfile, SeasonSummary } from "./types";

/** Prázdný profil nového trenéra. */
export function emptyProfile(): ManagerProfile {
  return {
    allTime: {
      careers: 0,
      seasons: 0,
      titles: 0,
      europeanQualifs: 0,
      uclQualifs: 0,
      relegations: 0,
      totalWin: 0,
      totalDraw: 0,
      totalLoss: 0,
      totalGoalsFor: 0,
      totalGoalsAgainst: 0,
      cleanSheets: 0,
      bestRank: 0,
      bestSeasonPoints: 0,
      mostGoalsSeason: 0,
      bestReputation: 0,
      leaguesCoached: [],
      invincibleSeasons: 0,
    },
    achievements: [],
  };
}

/** Založení nové kariéry: zvýší počítadlo kariér (profil jinak beze změny). */
export function startCareer(profile: ManagerProfile): ManagerProfile {
  return {
    ...profile,
    allTime: { ...profile.allTime, careers: profile.allTime.careers + 1 },
  };
}

/**
 * Přičte jednu dohranou sezónu do trvalých rekordů. `reputationAfter` = reputace po
 * této sezóně (pro `bestReputation`). Čistá funkce – vrací nový profil.
 */
export function foldSeason(
  profile: ManagerProfile,
  summary: SeasonSummary,
  reputationAfter: number
): ManagerProfile {
  const a = profile.allTime;
  const leaguesCoached = a.leaguesCoached.includes(summary.leagueId)
    ? a.leaguesCoached
    : [...a.leaguesCoached, summary.leagueId];
  const invincible = summary.loss === 0;
  return {
    ...profile,
    allTime: {
      ...a,
      seasons: a.seasons + 1,
      titles: a.titles + (summary.champion ? 1 : 0),
      europeanQualifs: a.europeanQualifs + (summary.europe !== "NONE" ? 1 : 0),
      uclQualifs: a.uclQualifs + (summary.europe === "UCL" ? 1 : 0),
      relegations: a.relegations + (summary.relegated ? 1 : 0),
      totalWin: a.totalWin + summary.win,
      totalDraw: a.totalDraw + summary.draw,
      totalLoss: a.totalLoss + summary.loss,
      totalGoalsFor: a.totalGoalsFor + summary.goalsFor,
      totalGoalsAgainst: a.totalGoalsAgainst + summary.goalsAgainst,
      cleanSheets: a.cleanSheets + summary.cleanSheets,
      bestRank: a.bestRank === 0 ? summary.yourRank : Math.min(a.bestRank, summary.yourRank),
      bestSeasonPoints: Math.max(a.bestSeasonPoints, summary.yourPoints),
      mostGoalsSeason: Math.max(a.mostGoalsSeason, summary.goalsFor),
      bestReputation: Math.max(a.bestReputation, Math.round(reputationAfter)),
      leaguesCoached,
      invincibleSeasons: a.invincibleSeasons + (invincible ? 1 : 0),
    },
  };
}

/** Pomocník pro achievement „Grand Tour": id všech Top-5 lig. */
export const TOP5_LEAGUE_IDS = [39, 140, 135, 78, 61];

/** Splnil profil pokrytí všech Top-5 lig? */
export function coachedAllTop5(records: AllTimeRecords): boolean {
  return TOP5_LEAGUE_IDS.every((id) => records.leaguesCoached.includes(id));
}
