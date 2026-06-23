import type { EntityType } from "@/lib/types";

/**
 * Společný stavitel deep-linku do Porovnání (`/porovnani`) pro klikací řádky
 * zápasů/tipů/výsledků. Jeden zdroj pravdy pro „klikatelný jen když známe ligu
 * obou stran" – klub má `leagueId` u obou vždy, reprezentace má konfederaci
 * každého týmu (může chybět → `null` = neklikací řádek).
 *
 * Sdílí ho `FixtureRow` (Zápasy), `PickRow` (Tipy) i `ResultRow` (Výsledky).
 */
export interface CompareLinkSource {
  compareMode: EntityType;
  home: { id: number };
  away: { id: number };
  homeCompareLeagueId: number | null;
  awayCompareLeagueId: number | null;
}

export function buildCompareHref(x: CompareLinkSource): string | null {
  if (x.homeCompareLeagueId == null || x.awayCompareLeagueId == null) return null;
  const params = new URLSearchParams({
    mode: x.compareMode,
    homeLeague: String(x.homeCompareLeagueId),
    awayLeague: String(x.awayCompareLeagueId),
    home: String(x.home.id),
    away: String(x.away.id),
  });
  return `/porovnani?${params.toString()}`;
}
