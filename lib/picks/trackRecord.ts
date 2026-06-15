import type { PredictionRow } from "@/lib/types";

/**
 * Úspěšnost modelu z odehraných predikcí (čistá funkce nad `PredictionRow[]`).
 * Počítá jen řádky s dostupnou predikcí a známým výsledkem.
 */
export interface TrackRecord {
  n: number;
  outcomeAccuracy: number | null; // argmax 1X2 vs. skutečný výsledek
  over25Accuracy: number | null; // predikce >2.5 (≥50 %) vs. realita
  bttsAccuracy: number | null; // predikce oba skórují (≥50 %) vs. realita
}

function argmaxOutcome(r: PredictionRow): "home" | "draw" | "away" {
  if (r.homeWin >= r.draw && r.homeWin >= r.awayWin) return "home";
  if (r.awayWin >= r.draw && r.awayWin >= r.homeWin) return "away";
  return "draw";
}

function actualOutcome(hg: number, ag: number): "home" | "draw" | "away" {
  return hg > ag ? "home" : hg < ag ? "away" : "draw";
}

export function computeTrackRecord(rows: PredictionRow[]): TrackRecord {
  const settled = rows.filter(
    (r) => r.available && r.homeGoals != null && r.awayGoals != null
  );
  const n = settled.length;
  if (n === 0) {
    return { n: 0, outcomeAccuracy: null, over25Accuracy: null, bttsAccuracy: null };
  }
  let outcomeHits = 0;
  let over25Hits = 0;
  let bttsHits = 0;
  for (const r of settled) {
    const hg = r.homeGoals!;
    const ag = r.awayGoals!;
    if (argmaxOutcome(r) === actualOutcome(hg, ag)) outcomeHits++;
    if ((r.over25 >= 0.5) === (hg + ag >= 3)) over25Hits++;
    if ((r.bttsYes >= 0.5) === (hg > 0 && ag > 0)) bttsHits++;
  }
  return {
    n,
    outcomeAccuracy: outcomeHits / n,
    over25Accuracy: over25Hits / n,
    bttsAccuracy: bttsHits / n,
  };
}
