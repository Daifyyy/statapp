import type { MatchupContext, TeamContext } from "../context";
import { totalSummary } from "../context";
import { valueOf } from "@/lib/stats/metricLookup";

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

  return { favorite, strengthLabel, reasons: collectReasons(fav, opp, favorite) };
}

function collectReasons(
  fav: TeamContext,
  opp: TeamContext,
  favorite: "home" | "away"
): string[] {
  const reasons: string[] = [];

  const favWins = totalSummary(fav)?.form.filter((r) => r === "W").length ?? 0;
  const oppWins = totalSummary(opp)?.form.filter((r) => r === "W").length ?? 0;
  if (favWins - oppWins >= 1) reasons.push("lepší forma");

  const favGf = valueOf(fav.values, "GOALS_FOR", "TOTAL");
  const oppGf = valueOf(opp.values, "GOALS_FOR", "TOTAL");
  if (favGf != null && oppGf != null && favGf > oppGf * 1.15)
    reasons.push("silnější útok");

  const favGa = valueOf(fav.values, "GOALS_AGAINST", "TOTAL");
  const oppGa = valueOf(opp.values, "GOALS_AGAINST", "TOTAL");
  if (favGa != null && oppGa != null && favGa < oppGa * 0.85)
    reasons.push("pevnější obrana");

  if (favorite === "home") reasons.push("výhoda domácího prostředí");

  const favPos = valueOf(fav.values, "POSSESSION", "TOTAL");
  const oppPos = valueOf(opp.values, "POSSESSION", "TOTAL");
  if (favPos != null && oppPos != null && favPos > oppPos + 8)
    reasons.push("víc drží míč");

  return reasons.slice(0, 3);
}
