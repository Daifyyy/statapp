import type { EntityType, MatchStat } from "@/lib/types";

/** Soutěžní zápas má plnou váhu, přátelák nižší (jen reprezentace). §3.4b */
export const FRIENDLY_WEIGHT = 0.4;

/**
 * Váha jednoho zápasu uvnitř okna. U klubů vždy 1.0; u reprezentací dostávají
 * soutěžní zápasy (kvalifikace, MS/ME, Liga národů) vyšší váhu než přáteláky.
 */
export function matchWeight(match: MatchStat, entityType: EntityType): number {
  if (entityType === "CLUB") return 1;
  return match.competitive ? 1 : FRIENDLY_WEIGHT;
}
