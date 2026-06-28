import { z } from "zod";
import type {
  MatchPick,
  MatchPrediction,
  PickMarket,
  PickRule,
  PredictionRow,
} from "@/lib/types";
import { isNationalTournamentLeague } from "@/lib/data/catalog";
import { rowValue } from "./value";

/**
 * Pravidla výběru zápasů do predikční záložky. Čisté funkce nad uloženými
 * predikcemi (`PredictionRow`) – žádná data ani síť. Sdílí je API i testy.
 */

/** Zod schéma pravidla (sdílí endpointy /api/picks i /api/picks/stats). */
export const ruleSchema = z.object({
  market: z.enum(["win", "over25", "btts"]).default("win"),
  venue: z.enum(["home", "away", "any"]).default("home"),
  minProb: z.coerce.number().min(0).max(1).default(0.65),
  // Volitelný práh edge (value betting). Vynechán → kurzy se ignorují (chování jako dnes).
  minEdge: z.coerce.number().optional(),
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
  /** Edge nad kurzem sázkovky (prob×kurz−1); null = kurz nedotažen. */
  edge: number | null;
}

/** Pravděpodobnost a strana relevantní pro trh pravidla (bez posouzení prahů). */
function targetOf(
  row: PredictionRow,
  rule: PickRule
): { prob: number; side: "home" | "away" | null } {
  if (rule.market === "over25") return { prob: row.over25, side: null };
  if (rule.market === "btts") return { prob: row.bttsYes, side: null };
  // market === "win"
  if (rule.venue === "home") return { prob: row.homeWin, side: "home" };
  if (rule.venue === "away") return { prob: row.awayWin, side: "away" };
  // venue === "any" → silnější strana
  const side = row.homeWin >= row.awayWin ? "home" : "away";
  return { prob: Math.max(row.homeWin, row.awayWin), side };
}

/**
 * Posoudí, zda predikce splňuje pravidlo, a vrátí relevantní pravděpodobnost + edge.
 * Práh `minProb` platí vždy; je-li navíc nastaven `minEdge`, tip projde jen se známým
 * kurzem a dostatečnou hranou nad trhem (value betting). Bez `minEdge` se kurz ignoruje.
 */
export function evaluateRule(row: PredictionRow, rule: PickRule): RuleMatch {
  if (!row.available) return { ok: false, prob: 0, side: null, edge: null };

  const { prob, side } = targetOf(row, rule);
  const edge = rowValue(row, rule.market, side)?.edge ?? null;

  let ok = prob >= rule.minProb;
  if (rule.minEdge != null) ok = ok && edge != null && edge >= rule.minEdge;

  return { ok, prob, side, edge };
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
    // Přesná skóre nejsou v uloženém řádku (UI-only obohacení z živé mřížky); pravidla je nepotřebují.
    topScores: [],
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
    // Klub → CLUB mód, „liga" = `leagueId` u obou (deep-link rovnou klikací).
    // Reprezentační turnaj → NATIONAL mód, konfederace doplní `/api/picks` (zde null).
    const national = isNationalTournamentLeague(row.leagueId);
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
      value: rowValue(row, rule.market, m.side),
      explanation: explain(row, rule.market, m.side, m.prob),
      compareMode: national ? "NATIONAL" : "CLUB",
      homeCompareLeagueId: national ? null : row.leagueId,
      awayCompareLeagueId: national ? null : row.leagueId,
    });
  }
  return picks.sort((a, b) => {
    const dayCmp = a.kickoff.slice(0, 10).localeCompare(b.kickoff.slice(0, 10));
    if (dayCmp !== 0) return dayCmp;
    return b.prob - a.prob;
  });
}
