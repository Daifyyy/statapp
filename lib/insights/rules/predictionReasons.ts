import type { MatchupContext, TeamContext } from "../context";
import { perspectiveSummary } from "../context";
import { valueOrTotal } from "@/lib/stats/metricLookup";

export interface PredictionReasons {
  favorite: "home" | "away" | null;
  strengthLabel: string; // „Jasný favorit" / „Mírný favorit" / „Lehká výhoda" / „Vyrovnané"
  reasons: string[]; // krátké důvody ve prospěch favorita (max 3)
}

/** Z predikce určí favorita a vysvětlí, čím si vede – sdílí verdikt i matchup pravidlo. */
export function predictionReasons(ctx: MatchupContext): PredictionReasons {
  const { homeWin, awayWin } = ctx.prediction;
  const diff = homeWin - awayWin;
  const mag = Math.abs(diff);

  if (mag < 0.08) {
    return { favorite: null, strengthLabel: "Vyrovnané", reasons: [] };
  }
  const favorite = diff > 0 ? "home" : "away";
  const fav = favorite === "home" ? ctx.home : ctx.away;
  const opp = favorite === "home" ? ctx.away : ctx.home;
  const strengthLabel =
    mag > 0.3 ? "Jasný favorit" : mag > 0.12 ? "Mírný favorit" : "Lehká výhoda";

  return {
    favorite,
    strengthLabel,
    reasons: collectReasons(fav, opp, favorite, ctx.entityType),
  };
}

function collectReasons(
  fav: TeamContext,
  opp: TeamContext,
  favorite: "home" | "away",
  entityType: MatchupContext["entityType"]
): string[] {
  const reasons: string[] = [];

  const favWins = perspectiveSummary(fav)?.form.filter((r) => r === "W").length ?? 0;
  const oppWins = perspectiveSummary(opp)?.form.filter((r) => r === "W").length ?? 0;
  if (favWins - oppWins >= 1) reasons.push("lepší forma");

  const favGf = valueOrTotal(fav.values, "GOALS_FOR", fav.venue);
  const oppGf = valueOrTotal(opp.values, "GOALS_FOR", opp.venue);
  if (favGf != null && oppGf != null && favGf > oppGf * 1.15)
    reasons.push("silnější útok");

  const favGa = valueOrTotal(fav.values, "GOALS_AGAINST", fav.venue);
  const oppGa = valueOrTotal(opp.values, "GOALS_AGAINST", opp.venue);
  if (favGa != null && oppGa != null && favGa < oppGa * 0.85)
    reasons.push("pevnější obrana");

  // Domácí výhoda jen pro kluby – reprezentace hrají venue-neutrálně.
  if (favorite === "home" && entityType !== "NATIONAL")
    reasons.push("výhoda domácího prostředí");

  const favPos = valueOrTotal(fav.values, "POSSESSION", fav.venue);
  const oppPos = valueOrTotal(opp.values, "POSSESSION", opp.venue);
  if (favPos != null && oppPos != null && favPos > oppPos + 8)
    reasons.push("víc drží míč");

  return reasons.slice(0, 3);
}
