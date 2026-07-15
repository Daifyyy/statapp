import { actualOutcome } from "@/lib/picks/trackRecord";
import type { TipMarket, TipRow } from "./types";

/**
 * Bilance osobního deníku tipů (úspěšnost + ROI). Čistá funkce nad `TipRow[]`.
 * ROI staví na snapshotu kurzu při vložení tipu (skrytém během tipování): profit
 * jednoho tipu = `hit ? stake·(odds−1) : −stake`, počítá se jen když je kurz znám.
 * Úspěšnost se počítá ze všech vyhodnocených tipů (i bez kurzu).
 */

export interface MarketStats {
  settled: number;
  hits: number;
  accuracy: number | null; // hits / settled
  staked: number; // suma stake vyhodnocených tipů s kurzem
  returned: number; // suma výplat (hit ? stake·odds : 0)
  profit: number; // returned − staked
  roi: number | null; // profit / staked
}

export interface TipStats {
  count: number; // všechny tipy
  pending: number; // čeká na výsledek
  settled: number; // vyhodnocené
  hits: number;
  accuracy: number | null;
  staked: number;
  returned: number;
  profit: number;
  roi: number | null;
  byMarket: Record<TipMarket, MarketStats>;
  /** Porovnání s modelem na 1X2 tipech, kde existuje modelová predikce (pro zajímavost). */
  vsModel: { n: number; you: number; model: number } | null;
}

function emptyMarket(): MarketStats {
  return { settled: 0, hits: 0, accuracy: null, staked: 0, returned: 0, profit: 0, roi: null };
}

/** Je tip vyhodnocený (známe výsledek)? */
function isSettled(t: TipRow): boolean {
  return t.homeGoals != null && t.awayGoals != null && t.hit != null;
}

function finalize(m: MarketStats): MarketStats {
  m.profit = m.returned - m.staked;
  m.accuracy = m.settled > 0 ? m.hits / m.settled : null;
  m.roi = m.staked > 0 ? m.profit / m.staked : null;
  return m;
}

export function computeTipStats(
  rows: TipRow[],
  opts: { modelPick?: Map<number, "home" | "draw" | "away"> } = {}
): TipStats {
  const byMarket: Record<TipMarket, MarketStats> = {
    win: emptyMarket(),
    over25: emptyMarket(),
    btts: emptyMarket(),
  };
  const total = emptyMarket();
  let pending = 0;

  for (const t of rows) {
    if (!isSettled(t)) {
      pending++;
      continue;
    }
    const m = byMarket[t.market];
    const hit = t.hit === true;
    for (const bucket of [m, total]) {
      bucket.settled++;
      if (hit) bucket.hits++;
      if (t.odds != null) {
        bucket.staked += t.stake;
        bucket.returned += hit ? t.stake * t.odds : 0;
      }
    }
  }

  finalize(total);
  for (const k of Object.keys(byMarket) as TipMarket[]) finalize(byMarket[k]);

  // Porovnání s modelem: jen 1X2 tipy s dostupnou modelovou predikcí + známým výsledkem.
  let vsModel: TipStats["vsModel"] = null;
  const modelPick = opts.modelPick;
  if (modelPick) {
    let n = 0;
    let youHits = 0;
    let modelHits = 0;
    for (const t of rows) {
      if (t.market !== "win" || !isSettled(t)) continue;
      const mp = modelPick.get(t.fixtureId);
      if (!mp) continue;
      n++;
      if (t.hit === true) youHits++;
      if (mp === actualOutcome(t.homeGoals!, t.awayGoals!)) modelHits++;
    }
    if (n > 0) vsModel = { n, you: youHits / n, model: modelHits / n };
  }

  return {
    count: rows.length,
    pending,
    settled: total.settled,
    hits: total.hits,
    accuracy: total.accuracy,
    staked: total.staked,
    returned: total.returned,
    profit: total.profit,
    roi: total.roi,
    byMarket,
    vsModel,
  };
}
