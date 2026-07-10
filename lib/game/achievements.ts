// Achievementy / zásluhy sbírané napříč kariérami – čistý registr + vyhodnocení.
// Podmínky čtou jen trvalé rekordy (AllTimeRecords), poslední dohranou sezónu a reputaci.
// Vyhodnocuje se na konci sezóny; odemčené se ukládají do trvalého profilu.

import { coachedAllTop5 } from "./profile";
import type { AllTimeRecords, CupSummary, SeasonSummary, TournamentSummary } from "./types";

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

// ───────────────────────── reprezentační achievementy (Phase 4) ─────────────────────────
//
// Druhý registr s vlastním kontextem (TournamentSummary). `EarnedAchievement.id` je plochý
// string → jeden `owned` set pokryje oba registry beze změny perzistence; sloučí se až v UI.

export interface TournamentCtx {
  allTime: AllTimeRecords;
  /** Právě dohraný reprezentační turnaj. */
  last: TournamentSummary;
  reputation: number;
}

export interface TournamentAchievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  tier: AchievementTier;
  check: (ctx: TournamentCtx) => boolean;
}

export const TOURNAMENT_ACHIEVEMENTS: TournamentAchievement[] = [
  {
    id: "nat_debut",
    title: "Reprezentační debut",
    desc: "Převezmi reprezentaci a odehraj s ní kvalifikaci.",
    icon: "🌐",
    tier: "bronze",
    check: (c) => (c.allTime.tournamentsPlayed ?? 0) >= 1,
  },
  {
    id: "nat_qualify",
    title: "Jedeme na turnaj",
    desc: "Proboj se s reprezentací na závěrečný turnaj.",
    icon: "🎫",
    tier: "bronze",
    check: (c) => c.last.qualified,
  },
  {
    id: "nat_knockout",
    title: "Vyřazovací boje",
    desc: "Postup ze skupiny do vyřazovací fáze turnaje.",
    icon: "⚔️",
    tier: "silver",
    check: (c) => c.last.qualified && c.last.stageReached !== "group",
  },
  {
    id: "nat_final",
    title: "Až do finále",
    desc: "Dovedení reprezentace do finále velkého turnaje.",
    icon: "🥈",
    tier: "silver",
    check: (c) => c.last.stageReached === "final",
  },
  {
    id: "nat_euro",
    title: "Král Evropy",
    desc: "Vyhraj mistrovství Evropy.",
    icon: "🏆",
    tier: "gold",
    check: (c) => c.last.champion && c.last.competitionId === "EURO",
  },
  {
    id: "nat_world",
    title: "Mistr světa",
    desc: "Vyhraj mistrovství světa.",
    icon: "🌍",
    tier: "gold",
    check: (c) => c.last.champion && c.last.competitionId === "WC",
  },
  {
    id: "nat_dynasty",
    title: "Reprezentační dynastie",
    desc: "Vyhraj 2 velké turnaje napříč kariérou.",
    icon: "👑",
    tier: "gold",
    check: (c) => (c.allTime.majorTitles ?? 0) >= 2,
  },
  {
    id: "nat_globetrotter",
    title: "Selekce světa",
    desc: "Veď 3 různé reprezentace.",
    icon: "🧭",
    tier: "silver",
    check: (c) => (c.allTime.nationsCoached ?? []).length >= 3,
  },
  {
    id: "nat_underdog",
    title: "David proti Goliášovi",
    desc: "Dojdi aspoň do semifinále s outsiderskou reprezentací (prestiž ≤ 65).",
    icon: "🐜",
    tier: "gold",
    check: (c) =>
      c.last.qualified &&
      (c.last.stageReached === "sf" || c.last.stageReached === "final") &&
      (c.last.teamPrestige ?? 100) <= 65,
  },
  {
    id: "nat_invincible",
    title: "Neporažený mistr",
    desc: "Vyhraj turnaj bez jediné prohry (vč. kvalifikace).",
    icon: "🛡️",
    tier: "gold",
    check: (c) => c.last.champion && c.last.loss === 0,
  },
  {
    id: "nat_goals",
    title: "Ofenzivní smršť",
    desc: "Nastřílej 15+ gólů v jednom reprezentačním běhu.",
    icon: "🎯",
    tier: "silver",
    check: (c) => c.last.goalsFor >= 15,
  },
  {
    id: "nat_five_nations",
    title: "Kočovný selektor",
    desc: "Veď 5 různých reprezentací.",
    icon: "🗺️",
    tier: "gold",
    check: (c) => (c.allTime.nationsCoached ?? []).length >= 5,
  },
];

/** Ids reprezentačních achievementů splněných v daném kontextu. */
export function evaluateTournamentAchievements(ctx: TournamentCtx): string[] {
  return TOURNAMENT_ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id);
}

/** Reprezentační achievementy, které se právě odemkly. */
export function newlyEarnedTournament(
  ownedIds: string[],
  ctx: TournamentCtx
): TournamentAchievement[] {
  const owned = new Set(ownedIds);
  return TOURNAMENT_ACHIEVEMENTS.filter((a) => !owned.has(a.id) && a.check(ctx));
}

// ───────────────────────── klubový pohár – achievementy ─────────────────────────
//
// Třetí registr, stejný princip jako reprezentační: vlastní kontext (`CupSummary`),
// plochý `id` sdílí jeden `owned` set se zbylými dvěma registry.

export interface CupCtx {
  allTime: AllTimeRecords;
  /** Právě dohraný klubový pohár. */
  last: CupSummary;
  reputation: number;
}

export interface CupAchievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  tier: AchievementTier;
  check: (ctx: CupCtx) => boolean;
}

export const CUP_ACHIEVEMENTS: CupAchievement[] = [
  {
    id: "cup_debut",
    title: "Evropská premiéra",
    desc: "Odehraj svůj první klubový pohár.",
    icon: "🎟️",
    tier: "bronze",
    check: (c) => (c.allTime.cupsPlayed ?? 0) >= 1,
  },
  {
    id: "cup_knockout",
    title: "Do vyřazovačky",
    desc: "Postup ze skupiny klubového poháru do vyřazovací fáze.",
    icon: "⚔️",
    tier: "silver",
    check: (c) => c.last.stageReached !== "group",
  },
  {
    id: "cup_final",
    title: "Evropské finále",
    desc: "Dovedení klubu do finále klubového poháru.",
    icon: "🥈",
    tier: "silver",
    check: (c) => c.last.stageReached === "final",
  },
  {
    id: "cup_champion",
    title: "Vládce Evropy",
    desc: "Vyhraj klubový pohár.",
    icon: "🏆",
    tier: "gold",
    check: (c) => c.last.champion,
  },
  {
    id: "cup_dynasty",
    title: "Evropská dynastie",
    desc: "Vyhraj klubový pohár 2× napříč kariérami.",
    icon: "👑",
    tier: "gold",
    check: (c) => (c.allTime.cupTitles ?? 0) >= 2,
  },
  {
    id: "cup_underdog",
    title: "David v Evropě",
    desc: "Dojdi aspoň do semifinále klubového poháru s klubem prestiže ≤ 65.",
    icon: "🐜",
    tier: "gold",
    check: (c) =>
      (c.last.stageReached === "sf" || c.last.stageReached === "final") &&
      (c.last.teamPrestige ?? 100) <= 65,
  },
];

/** Klubové poháry, které se právě odemkly. */
export function newlyEarnedCup(ownedIds: string[], ctx: CupCtx): CupAchievement[] {
  const owned = new Set(ownedIds);
  return CUP_ACHIEVEMENTS.filter((a) => !owned.has(a.id) && a.check(ctx));
}

/** Zobrazovací tvar achievementu (bez `check`) – sjednocuje všechny registry pro UI grid. */
export type AchievementDisplay = Omit<Achievement, "check">;

function toDisplay(
  a: Achievement | TournamentAchievement | CupAchievement
): AchievementDisplay {
  return { id: a.id, title: a.title, desc: a.desc, icon: a.icon, tier: a.tier };
}

/** Všechny achievementy (ligové + reprezentační + klubový pohár) pro zobrazení v profilu. */
export const ALL_ACHIEVEMENTS: AchievementDisplay[] = [
  ...ACHIEVEMENTS.map(toDisplay),
  ...TOURNAMENT_ACHIEVEMENTS.map(toDisplay),
  ...CUP_ACHIEVEMENTS.map(toDisplay),
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
