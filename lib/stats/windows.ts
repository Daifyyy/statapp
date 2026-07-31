import type { EntityType, MatchStat, WindowKey } from "@/lib/types";
import { ENTITY_WINDOWS } from "./weights";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Zápas z **aktuálně rozehrané sezóny**. `isBaseline` značí nejnovější DOKONČENOU
 * sezónu (`tagBaseline` v `realRepository`) a pool klubu obsahuje jen tyhle dvě sezóny,
 * takže „ne baseline" = „letos". U reprezentací je `isBaseline` vždy `false` (mají časová
 * okna, ne sezónní baseline) → predikát je pro ně no-op a jejich okna se nemění.
 */
const isCurrentSeason = (m: MatchStat): boolean => !m.isBaseline;

/** Přepínač pro λ – viz `crossSeasonForm` níž. */
export interface WindowOptions {
  /** Smí formová okna sáhnout i do minulé sezóny? (Zobrazení ne, λ zatím ano.) */
  crossSeasonForm?: boolean;
}

/**
 * Vybere zápasy spadající do daného okna z předtříděného pole (sestupně dle data).
 *
 * Kluby:
 *  - SEASON = zápasy nejnovější DOKONČENÉ sezóny (m.isBaseline) – „minulá sezóna"
 *  - LAST10 = posledních 10 zápasů **aktuální sezóny**
 *  - LAST5  = posledních 5 zápasů **aktuální sezóny**
 * Reprezentace (časová okna, §3.4a):
 *  - BASE   = 12–24 měsíců zpět
 *  - LAST12 = posledních 12 měsíců
 *  - LAST6  = posledních 6 měsíců
 *
 * **Formová okna nepřekračují hranici sezóny.** Dřív brala prostě N nejnovějších zápasů
 * dle data, takže v srpnu znamenalo „posl. 5 zápasů" **květen** – a to s vahou 55 %.
 * Od minulé sezóny je tu okno SEASON; míchat ji i do formy dělá z popisku lež a z čísla
 * něco, co uživatel nemůže interpretovat. V prvních kolech okna prostě chybí a
 * `weightedAverage` váhy přerozdělí na SEASON – hodnota je pak přiznaně z minulé sezóny,
 * místo aby se za formu vydávala.
 */
export function selectWindowMatches(
  matches: MatchStat[],
  window: WindowKey,
  now: Date = new Date(),
  opts: WindowOptions = {}
): MatchStat[] {
  const form = opts.crossSeasonForm ? matches : matches.filter(isCurrentSeason);
  switch (window) {
    case "SEASON":
      return matches.filter((m) => m.isBaseline);
    case "LAST10":
      return byDateDesc(form).slice(0, 10);
    case "LAST5":
      return byDateDesc(form).slice(0, 5);
    case "BASE":
      return withinMonths(matches, now, 12, 24);
    case "LAST12":
      return withinMonths(matches, now, 0, 12);
    case "LAST6":
      return withinMonths(matches, now, 0, 6);
  }
}

function byDateDesc(matches: MatchStat[]): MatchStat[] {
  return [...matches].sort((a, b) => b.date.localeCompare(a.date));
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
