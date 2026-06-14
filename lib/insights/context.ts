import type {
  EntityType,
  MatchPrediction,
  MatchStat,
  MetricValue,
  TeamComparison,
  TeamSummary,
} from "@/lib/types";

/** Vstup pravidel o jednom týmu (vše už spočítané + syrové zápasy pro série). */
export interface TeamContext {
  side: "home" | "away";
  team: TeamComparison["team"];
  values: MetricValue[];
  summary: TeamSummary[];
  matches: MatchStat[];
  entityType: EntityType;
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
  return {
    side,
    team: comparison.team,
    values: comparison.values,
    summary: comparison.summary,
    matches,
    entityType,
    now,
  };
}

/** Souhrn varianty TOTAL (forma/CS/FTS) – nejčastější vstup pravidel. */
export function totalSummary(ctx: TeamContext): TeamSummary | undefined {
  return ctx.summary.find((s) => s.venue === "TOTAL");
}
