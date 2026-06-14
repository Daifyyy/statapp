import type { MatchupContext } from "../context";
import { predictionReasons } from "./predictionReasons";

/**
 * Jednovětný verdikt: favorit + síla + tendence skóre (+ klíčový důvod).
 * Deterministický template z predikce – žádný LLM.
 */
export function buildVerdict(ctx: MatchupContext): string {
  const { prediction } = ctx;
  const { lambdaHome, lambdaAway } = prediction;
  const score = `${lambdaHome.toFixed(1)}–${lambdaAway.toFixed(1)}`;
  const total = lambdaHome + lambdaAway;
  const tendency =
    total >= 2.8
      ? "očekává se otevřený zápas"
      : total <= 2.0
        ? "spíš opatrný zápas"
        : "vyrovnané tempo";

  const r = predictionReasons(ctx);
  if (!r.favorite) {
    return `Vyrovnaný souboj · ${tendency} (${score}).`;
  }

  const name = r.favorite === "home" ? ctx.home.team.name : ctx.away.team.name;
  const winPct = Math.round(
    (r.favorite === "home" ? prediction.homeWin : prediction.awayWin) * 100
  );
  const reason = r.reasons.length ? ` · ${r.reasons[0]}` : "";
  return `${r.strengthLabel}: ${name} (${winPct} %) · ${tendency} (${score})${reason}.`;
}
