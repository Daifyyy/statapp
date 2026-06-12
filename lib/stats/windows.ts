import type { EntityType, MatchStat, WindowKey } from "@/lib/types";
import { ENTITY_WINDOWS } from "./weights";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Vybere zápasy spadající do daného okna z předtříděného pole (sestupně dle data).
 *
 * Kluby (počtová okna):
 *  - SEASON = všechny zápasy z minulé sezóny (isPreviousSeason)
 *  - LAST10 = posledních 10 zápasů aktuální sezóny
 *  - LAST5  = posledních 5 zápasů aktuální sezóny
 * Reprezentace (časová okna, §3.4a):
 *  - BASE   = 12–24 měsíců zpět
 *  - LAST12 = posledních 12 měsíců
 *  - LAST6  = posledních 6 měsíců
 */
export function selectWindowMatches(
  matches: MatchStat[],
  window: WindowKey,
  now: Date = new Date()
): MatchStat[] {
  const current = matches.filter((m) => !m.isPreviousSeason);
  const previous = matches.filter((m) => m.isPreviousSeason);

  switch (window) {
    case "SEASON":
      return previous;
    case "LAST10":
      return current.slice(0, 10);
    case "LAST5":
      return current.slice(0, 5);
    case "BASE":
      return withinMonths(matches, now, 12, 24);
    case "LAST12":
      return withinMonths(matches, now, 0, 12);
    case "LAST6":
      return withinMonths(matches, now, 0, 6);
  }
}

function withinMonths(
  matches: MatchStat[],
  now: Date,
  fromMonths: number,
  toMonths: number
): MatchStat[] {
  const youngest = now.getTime() - fromMonths * 30 * MS_PER_DAY;
  const oldest = now.getTime() - toMonths * 30 * MS_PER_DAY;
  return matches.filter((m) => {
    const t = new Date(m.date).getTime();
    return t <= youngest && t > oldest;
  });
}

export function windowsFor(entityType: EntityType): WindowKey[] {
  return ENTITY_WINDOWS[entityType];
}
