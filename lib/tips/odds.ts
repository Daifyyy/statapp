import type { MatchOdds } from "@/lib/data/apiFootball";
import type { TipMarket, TipSelection } from "./types";

/**
 * Vybere z `MatchOdds` desetinný kurz odpovídající trhu/straně tipu. `null`, když
 * kurz pro danou stranu chybí (tip se pak počítá do úspěšnosti, ne do ROI). Čistá –
 * mapuje jen už stažené hodnoty, žádná síť.
 */
export function pickOddsForTip(
  odds: MatchOdds | null,
  market: TipMarket,
  selection: TipSelection
): number | null {
  if (!odds) return null;
  if (market === "win") {
    if (selection === "home") return odds.home;
    if (selection === "draw") return odds.draw;
    if (selection === "away") return odds.away;
    return null;
  }
  if (market === "over25") {
    return selection === "over" ? odds.over25 : (odds.under25 ?? null);
  }
  // btts
  return selection === "yes" ? odds.btts : (odds.bttsNo ?? null);
}
