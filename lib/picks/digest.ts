import type { MatchPick, PredictionRow } from "@/lib/types";
import { buildPick } from "./rules";
import { rowValue } from "./value";

/**
 * Týdenní digest = nejhodnotnější tipy nejbližších dní napříč trhy (1X2 výhra, Over 2.5,
 * BTTS). Pro každý zápas se vybere **nejlepší edge** (kde má model největší výhodu nad
 * kurzem) a vyberou se zápasy s kladnou hranou, seřazené sestupně dle edge. Čistá funkce
 * nad uloženými `PredictionRow` – žádná data ani síť (kurzy už jsou na řádku z pipeline).
 */

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 5;

/** Kandidátní trh/strana k posouzení value (remíza se netipuje). */
const CANDIDATES: { market: MatchPick["market"]; side: "home" | "away" | null }[] = [
  { market: "win", side: "home" },
  { market: "win", side: "away" },
  { market: "over25", side: null },
  { market: "btts", side: null },
];

/** Nejlepší value nabídka zápasu (trh s nejvyšším kladným edge), nebo null. */
function bestValue(row: PredictionRow): {
  market: MatchPick["market"];
  side: "home" | "away" | null;
  prob: number;
  edge: number;
} | null {
  let best: { market: MatchPick["market"]; side: "home" | "away" | null; prob: number; edge: number } | null = null;
  for (const c of CANDIDATES) {
    const v = rowValue(row, c.market, c.side);
    if (!v || v.edge <= 0) continue;
    if (!best || v.edge > best.edge) {
      best = { market: c.market, side: c.side, prob: v.prob, edge: v.edge };
    }
  }
  return best;
}

export interface DigestOptions {
  now?: Date;
  days?: number;
  limit?: number;
}

/**
 * Vybere top value tipy v okně `days` dní od `now`. Bere jen dostupné predikce s kurzy
 * (jinak edge nelze spočítat) a kladnou hranou; řadí dle edge sestupně, vrátí top `limit`.
 * Výstup jsou `MatchPick` (sdílí PickRow/deep-link s tipovací záložkou).
 */
export function buildDigest(
  rows: PredictionRow[],
  { now = new Date(), days = DEFAULT_DAYS, limit = DEFAULT_LIMIT }: DigestOptions = {}
): MatchPick[] {
  const from = now.getTime();
  const to = from + days * 24 * 60 * 60 * 1000;

  const scored: { pick: MatchPick; edge: number }[] = [];
  for (const row of rows) {
    if (!row.available) continue;
    const t = new Date(row.kickoff).getTime();
    if (!Number.isFinite(t) || t < from || t > to) continue;
    const best = bestValue(row);
    if (!best) continue;
    scored.push({ pick: buildPick(row, best.market, best.side, best.prob), edge: best.edge });
  }

  return scored
    .sort((a, b) => b.edge - a.edge)
    .slice(0, limit)
    .map((s) => s.pick);
}
