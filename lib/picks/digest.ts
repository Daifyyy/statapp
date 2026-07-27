import type { MatchPick, PredictionRow } from "@/lib/types";
import { buildPick } from "./rules";
import { rowValue } from "./value";

/**
 * Týdenní digest = zápasy, kde se model nejvíc rozchází s trhem (1X2 výhra, Over 2.5,
 * BTTS). Pro každý zápas se vybere trh s **největším rozdílem proti férové (odmaržované)
 * ceně**, vyberou se kladné rozdíly a seřadí se sestupně. Čistá funkce nad uloženými
 * `PredictionRow` – žádná data ani síť (kurzy už jsou na řádku z pipeline).
 *
 * **Není to seznam ziskových sázek.** Backtest (26. 7. 2026) ukázal, že model trh
 * neporazí a že větší rozdíl proti trhu koreluje s **horším** výsledkem, ne lepším.
 * Digest je tedy přehled „kde stojí za to se podívat, proč se lišíme", ne tipovací služba.
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

/**
 * Trh s největším kladným rozdílem proti férové ceně, nebo null.
 * Fallback na syrový `edge` je pro **starší řádky**, které ještě nemají uloženou
 * protistranu trhu (a tedy ani férovou cenu) – jinak by z digestu vypadly úplně.
 */
function bestValue(row: PredictionRow): {
  market: MatchPick["market"];
  side: "home" | "away" | null;
  prob: number;
  edge: number;
} | null {
  let best: { market: MatchPick["market"]; side: "home" | "away" | null; prob: number; edge: number } | null = null;
  for (const c of CANDIDATES) {
    const v = rowValue(row, c.market, c.side);
    if (!v) continue;
    const score = v.edgeFair ?? v.edge;
    if (score <= 0) continue;
    if (!best || score > best.edge) {
      best = { market: c.market, side: c.side, prob: v.prob, edge: score };
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
