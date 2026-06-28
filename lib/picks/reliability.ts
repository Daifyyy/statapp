import type { PredictionRow } from "@/lib/types";
import { actualOutcome } from "./trackRecord";

/**
 * Kalibrační (reliability) křivka modelu: když řekneme „60 %", padne to opravdu v ~60 %?
 * Predikce se rozbinují podle predikované pravděpodobnosti a v každém koši se porovná
 * průměrná predikce s pozorovanou četností. Dobře kalibrovaný model leží na diagonále
 * (predikováno ≈ pozorováno). Čistá funkce nad odehranými `PredictionRow` – žádná data.
 *
 * 1X2 je pooled one-vs-rest: každý zápas přispěje **třemi** body (homeWin/draw/awayWin
 * vs zda daný výsledek nastal) → standardní multiclass reliability. Over 2.5 a BTTS dají
 * jeden bod na zápas. Sdílí `actualOutcome` s track-recordem (jeden zdroj pravdy).
 */

export type ReliabilityMarket = "1x2" | "over25" | "btts";

export interface ReliabilityBin {
  /** Dolní/horní hranice koše predikované pravděpodobnosti (0–1). */
  lower: number;
  upper: number;
  /** Kolik predikcí padlo do koše. */
  count: number;
  /** Průměrná predikovaná pravděpodobnost v koši (null = prázdný). */
  avgPredicted: number | null;
  /** Pozorovaná četnost = podíl případů, kdy jev nastal (null = prázdný). */
  observed: number | null;
}

export interface ReliabilityCurve {
  market: ReliabilityMarket;
  /** Počet datových bodů (1X2 = 3× počet zápasů). */
  n: number;
  bins: ReliabilityBin[];
  /** Expected Calibration Error = vážený průměr |pozorováno − predikováno| (nižší = lepší). */
  ece: number | null;
}

export interface ReliabilityReport {
  outcome: ReliabilityCurve; // 1X2 pooled
  over25: ReliabilityCurve;
  btts: ReliabilityCurve;
}

/** Jeden bod kalibrace: predikovaná pravděpodobnost + zda jev nastal. */
interface Point {
  p: number;
  hit: boolean;
}

function buildCurve(
  market: ReliabilityMarket,
  points: Point[],
  binCount: number
): ReliabilityCurve {
  const sumP = new Array<number>(binCount).fill(0);
  const hits = new Array<number>(binCount).fill(0);
  const counts = new Array<number>(binCount).fill(0);

  for (const { p, hit } of points) {
    // Index koše; p === 1 spadne do posledního koše (ne mimo rozsah).
    const idx = Math.min(Math.floor(p * binCount), binCount - 1);
    sumP[idx] += p;
    if (hit) hits[idx] += 1;
    counts[idx] += 1;
  }

  const bins: ReliabilityBin[] = [];
  let eceSum = 0;
  for (let i = 0; i < binCount; i++) {
    const count = counts[i];
    const avgPredicted = count ? sumP[i] / count : null;
    const observed = count ? hits[i] / count : null;
    if (count && avgPredicted != null && observed != null) {
      eceSum += count * Math.abs(observed - avgPredicted);
    }
    bins.push({
      lower: i / binCount,
      upper: (i + 1) / binCount,
      count,
      avgPredicted,
      observed,
    });
  }

  const n = points.length;
  return { market, n, bins, ece: n ? eceSum / n : null };
}

/**
 * Kalibrační report pro tři trhy z odehraných predikcí. `binCount` = počet košů
 * (default 10 po 0.1). Bere jen řádky s dostupnou predikcí a známým výsledkem.
 */
export function computeReliability(
  rows: PredictionRow[],
  binCount = 10
): ReliabilityReport {
  const settled = rows.filter(
    (r) => r.available && r.homeGoals != null && r.awayGoals != null
  );

  const outcomePoints: Point[] = [];
  const overPoints: Point[] = [];
  const bttsPoints: Point[] = [];

  for (const r of settled) {
    const hg = r.homeGoals!;
    const ag = r.awayGoals!;
    const actual = actualOutcome(hg, ag);
    // 1X2 pooled one-vs-rest: tři body na zápas.
    outcomePoints.push({ p: r.homeWin, hit: actual === "home" });
    outcomePoints.push({ p: r.draw, hit: actual === "draw" });
    outcomePoints.push({ p: r.awayWin, hit: actual === "away" });
    overPoints.push({ p: r.over25, hit: hg + ag >= 3 });
    bttsPoints.push({ p: r.bttsYes, hit: hg > 0 && ag > 0 });
  }

  return {
    outcome: buildCurve("1x2", outcomePoints, binCount),
    over25: buildCurve("over25", overPoints, binCount),
    btts: buildCurve("btts", bttsPoints, binCount),
  };
}
