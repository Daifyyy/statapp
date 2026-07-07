// Achievementy / zásluhy sbírané napříč kariérami – čistý registr + vyhodnocení.
// Podmínky čtou jen trvalé rekordy (AllTimeRecords), poslední dohranou sezónu a reputaci.
// Vyhodnocuje se na konci sezóny; odemčené se ukládají do trvalého profilu.

import { coachedAllTop5 } from "./profile";
import type { AllTimeRecords, SeasonSummary } from "./types";

export type AchievementTier = "bronze" | "silver" | "gold";

export interface AchievementCtx {
  /** Rekordy PO započtení poslední sezóny. */
  allTime: AllTimeRecords;
  /** Právě dohraná sezóna. */
  last: SeasonSummary;
  /** Reputace po poslední sezóně. */
  reputation: number;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  tier: AchievementTier;
  check: (ctx: AchievementCtx) => boolean;
}

/** Kurátorovaná sada. Pořadí = pořadí zobrazení v profilu. */
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_win",
    title: "Premiéra",
    desc: "Získej první výhru v kariéře.",
    icon: "🎉",
    tier: "bronze",
    check: (c) => c.allTime.totalWin >= 1,
  },
  {
    id: "europe_first",
    title: "Evropská noc",
    desc: "Poprvé se probojuj do evropského poháru.",
    icon: "🌍",
    tier: "bronze",
    check: (c) => c.allTime.europeanQualifs >= 1,
  },
  {
    id: "first_title",
    title: "Šampion",
    desc: "Vyhraj svůj první ligový titul.",
    icon: "🏆",
    tier: "silver",
    check: (c) => c.allTime.titles >= 1,
  },
  {
    id: "ucl",
    title: "Král Evropy",
    desc: "Kvalifikuj se do ligové fáze Ligy mistrů.",
    icon: "👑",
    tier: "silver",
    check: (c) => c.allTime.uclQualifs >= 1,
  },
  {
    id: "survival",
    title: "Zázrak záchrany",
    desc: "Udrž se, i když se čekal boj o sestup.",
    icon: "🛟",
    tier: "silver",
    check: (c) => c.last.expectedRank >= 15 && !c.last.relegated,
  },
  {
    id: "promotion",
    title: "Návrat mezi elitu",
    desc: "Postup z druhé ligy zpět do nejvyšší soutěže.",
    icon: "🔼",
    tier: "silver",
    check: (c) => Boolean(c.last.promoted),
  },
  {
    id: "fairytale",
    title: "Pohádka",
    desc: "Vyhraj titul s týmem, u kterého se čekalo 7. místo a hůř.",
    icon: "🧚",
    tier: "gold",
    check: (c) => c.last.champion && c.last.expectedRank - c.last.yourRank >= 6,
  },
  {
    id: "invincible",
    title: "Neporazitelní",
    desc: "Projdi celou sezónu bez jediné prohry.",
    icon: "🛡️",
    tier: "gold",
    check: (c) => c.last.win + c.last.draw + c.last.loss > 0 && c.last.loss === 0,
  },
  {
    id: "dominance",
    title: "Dominance",
    desc: "Nasbírej 90+ bodů v jedné sezóně.",
    icon: "💪",
    tier: "gold",
    check: (c) => c.allTime.bestSeasonPoints >= 90,
  },
  {
    id: "goal_machine",
    title: "Kanonýři",
    desc: "Vstřel 90+ gólů v jedné sezóně.",
    icon: "⚽",
    tier: "gold",
    check: (c) => c.allTime.mostGoalsSeason >= 90,
  },
  {
    id: "iron_wall",
    title: "Železná zeď",
    desc: "Udrž 18+ čistých kont v jedné sezóně.",
    icon: "🧱",
    tier: "gold",
    check: (c) => c.last.cleanSheets >= 18,
  },
  {
    id: "dynasty",
    title: "Dynastie",
    desc: "Získej 3 tituly v kariéře.",
    icon: "🏅",
    tier: "gold",
    check: (c) => c.allTime.titles >= 3,
  },
  {
    id: "legend",
    title: "Legenda",
    desc: "Získej 10 titulů napříč kariérami.",
    icon: "🌟",
    tier: "gold",
    check: (c) => c.allTime.titles >= 10,
  },
  {
    id: "journeyman",
    title: "Světoběžník",
    desc: "Trénuj ve 3 různých ligách.",
    icon: "🧳",
    tier: "silver",
    check: (c) => c.allTime.leaguesCoached.length >= 3,
  },
  {
    id: "grand_tour",
    title: "Grand Tour",
    desc: "Trénuj v každé z Top-5 lig (Anglie, Španělsko, Itálie, Německo, Francie).",
    icon: "🗺️",
    tier: "gold",
    check: (c) => coachedAllTop5(c.allTime),
  },
  {
    id: "elite",
    title: "Elitní trenér",
    desc: "Vyšplhej s reputací na 85+.",
    icon: "🎖️",
    tier: "gold",
    check: (c) => c.allTime.bestReputation >= 85,
  },
  {
    id: "veteran",
    title: "Matador",
    desc: "Odehraj 10 sezón napříč kariérami.",
    icon: "⏳",
    tier: "silver",
    check: (c) => c.allTime.seasons >= 10,
  },
];

/** Vyhledá achievement dle id (pro UI render z EarnedAchievement). */
export function getAchievement(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Ids všech achievementů splněných v daném kontextu. */
export function evaluateAchievements(ctx: AchievementCtx): string[] {
  return ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id);
}

/** Achievementy, které se právě odemkly (splněné a dosud nedržené). */
export function newlyEarned(
  ownedIds: string[],
  ctx: AchievementCtx
): Achievement[] {
  const owned = new Set(ownedIds);
  return ACHIEVEMENTS.filter((a) => !owned.has(a.id) && a.check(ctx));
}
