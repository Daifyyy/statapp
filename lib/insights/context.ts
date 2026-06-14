import type {
  EntityType,
  MatchPrediction,
  MatchStat,
  MetricValue,
  TeamComparison,
  TeamSummary,
  Venue,
} from "@/lib/types";
import { matchesVenue } from "@/lib/stats/aggregate";

/** Vstup pravidel o jednom týmu (vše už spočítané + syrové zápasy pro série). */
export interface TeamContext {
  side: "home" | "away";
  team: TeamComparison["team"];
  values: MetricValue[];
  summary: TeamSummary[];
  matches: MatchStat[];
  entityType: EntityType;
  /**
   * Perspektivní varianta tohoto týmu pro daný zápas:
   * klub domácí → HOME, klub host → AWAY, reprezentace → TOTAL (neutrální).
   */
  venue: Venue;
  now: Date;
}

/** Vstup maticových pravidel: oba týmy + predikce. */
export interface MatchupContext {
  home: TeamContext;
  away: TeamContext;
  prediction: MatchPrediction;
  entityType: EntityType;
}

export function buildTeamContext(
  side: "home" | "away",
  comparison: TeamComparison,
  matches: MatchStat[],
  entityType: EntityType,
  now: Date
): TeamContext {
  const venue: Venue =
    entityType === "NATIONAL" ? "TOTAL" : side === "home" ? "HOME" : "AWAY";
  return {
    side,
    team: comparison.team,
    values: comparison.values,
    summary: comparison.summary,
    matches,
    entityType,
    venue,
    now,
  };
}

/** Souhrn varianty TOTAL (forma/CS/FTS). */
export function totalSummary(ctx: TeamContext): TeamSummary | undefined {
  return ctx.summary.find((s) => s.venue === "TOTAL");
}

/** Souhrn perspektivní varianty týmu (fallback na TOTAL, když chybí/prázdný). */
export function perspectiveSummary(ctx: TeamContext): TeamSummary | undefined {
  const s = ctx.summary.find((x) => x.venue === ctx.venue);
  if (s && s.sampleSize > 0) return s;
  return totalSummary(ctx);
}

/** Zápasy filtrované na perspektivní variantu (reprezentace TOTAL → všechny). */
export function perspectiveMatches(ctx: TeamContext): MatchStat[] {
  const filtered = ctx.matches.filter((m) => matchesVenue(m, ctx.venue));
  // Klub s prázdným domácím/venkovním vzorkem → radši všechny zápasy než nic.
  return filtered.length > 0 ? filtered : ctx.matches;
}
