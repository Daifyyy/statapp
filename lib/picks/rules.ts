import { z } from "zod";
import type {
  MatchPick,
  MatchPrediction,
  PickMarket,
  PickRule,
  PredictionRow,
} from "@/lib/types";

/**
 * Pravidla výběru zápasů do predikční záložky. Čisté funkce nad uloženými
 * predikcemi (`PredictionRow`) – žádná data ani síť. Sdílí je API i testy.
 */

/** Zod schéma pravidla (sdílí endpointy /api/picks i /api/picks/stats). */
export const ruleSchema = z.object({
  market: z.enum(["win", "over25", "btts"]).default("win"),
  venue: z.enum(["home", "away", "any"]).default("home"),
  minProb: z.coerce.number().min(0).max(1).default(0.65),
});

/** Přednastavená pravidla (rychlá volba v UI). */
export const PICK_PRESETS: { id: string; label: string; rule: PickRule }[] = [
  { id: "home-fav-65", label: "Domácí favorit ≥ 65 %", rule: { market: "win", venue: "home", minProb: 0.65 } },
  { id: "away-fav-60", label: "Hostující favorit ≥ 60 %", rule: { market: "win", venue: "away", minProb: 0.6 } },
  { id: "over25-60", label: "Přes 2.5 gólu ≥ 60 %", rule: { market: "over25", venue: "any", minProb: 0.6 } },
  { id: "btts-60", label: "Oba skórují ≥ 60 %", rule: { market: "btts", venue: "any", minProb: 0.6 } },
];

export interface RuleMatch {
  ok: boolean;
  prob: number;
  side: "home" | "away" | null;
}

/** Posoudí, zda predikce splňuje pravidlo, a vrátí relevantní pravděpodobnost. */
export function evaluateRule(row: PredictionRow, rule: PickRule): RuleMatch {
  if (!row.available) return { ok: false, prob: 0, side: null };

  if (rule.market === "over25") {
    return { ok: row.over25 >= rule.minProb, prob: row.over25, side: null };
  }
  if (rule.market === "btts") {
    return { ok: row.bttsYes >= rule.minProb, prob: row.bttsYes, side: null };
  }
  // market === "win"
  if (rule.venue === "home") {
    return { ok: row.homeWin >= rule.minProb, prob: row.homeWin, side: "home" };
  }
  if (rule.venue === "away") {
    return { ok: row.awayWin >= rule.minProb, prob: row.awayWin, side: "away" };
  }
  // venue === "any" → silnější strana
  const side = row.homeWin >= row.awayWin ? "home" : "away";
  const prob = Math.max(row.homeWin, row.awayWin);
  return { ok: prob >= rule.minProb, prob, side };
}

function predictionOf(row: PredictionRow): MatchPrediction {
  return {
    available: row.available,
    lambdaHome: row.lambdaHome,
    lambdaAway: row.lambdaAway,
    homeWin: row.homeWin,
    draw: row.draw,
    awayWin: row.awayWin,
    bttsYes: row.bttsYes,
    over25: row.over25,
    lowConfidence: row.lowConfidence,
  };
}

function explain(
  row: PredictionRow,
  market: PickMarket,
  side: "home" | "away" | null,
  prob: number
): string {
  const pct = Math.round(prob * 100);
  if (market === "over25") return `Přes 2.5 gólu · ${pct} %`;
  if (market === "btts") return `Oba týmy skórují · ${pct} %`;
  const name = side === "home" ? row.homeName : row.awayName;
  const where = side === "home" ? "doma" : "venku";
  return `${name} ${where} favorit · ${pct} % na výhru`;
}

/**
 * Vybere a seřadí tipy splňující pravidlo: nejdříve hrané zápasy první,
 * při stejném dni nejvyšší pravděpodobnost první.
 */
export function filterPicks(
  rows: PredictionRow[],
  rule: PickRule
): MatchPick[] {
  const picks: MatchPick[] = [];
  for (const row of rows) {
    const m = evaluateRule(row, rule);
    if (!m.ok) continue;
    picks.push({
      fixtureId: row.fixtureId,
      kickoff: row.kickoff,
      leagueId: row.leagueId,
      home: { id: row.homeTeamId, name: row.homeName, logoUrl: row.homeLogo },
      away: { id: row.awayTeamId, name: row.awayName, logoUrl: row.awayLogo },
      prediction: predictionOf(row),
      market: rule.market,
      side: m.side,
      prob: m.prob,
      explanation: explain(row, rule.market, m.side, m.prob),
    });
  }
  return picks.sort((a, b) => {
    const dayCmp = a.kickoff.slice(0, 10).localeCompare(b.kickoff.slice(0, 10));
    if (dayCmp !== 0) return dayCmp;
    return b.prob - a.prob;
  });
}
