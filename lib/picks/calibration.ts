/**
 * Kalibrace binárního trhu: rozbinuje predikce podle pravděpodobnosti a proti každému
 * koši postaví skutečnost. Sdílené jádro pro trhy, které měříme **mimo produkční
 * pipeline** (rohy, týmové totaly) – `computeReliability` je vázaná na `PredictionRow`
 * a na tři pevné trhy, tohle bere jen dvojice „pravděpodobnost + nastalo".
 *
 * **Laťkou je vždy konstanta „vždy základní míra"**, ne nula: model, který ji nepřekoná,
 * nepřidává nic, i kdyby měl log-loss opticky nízký (u vzácného jevu je nízký sám od sebe).
 */

/** Jeden kalibrační koš. */
export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  avgPredicted: number | null;
  observed: number | null;
}

export interface BinaryCalibration {
  bins: CalibrationBin[];
  /** Expected Calibration Error – vážený průměr |predikce − skutečnost| přes koše. */
  ece: number | null;
  n: number;
  logloss: number;
  /** Log-loss konstanty „vždy základní míra" – laťka, kterou model musí překonat. */
  baseLogloss: number;
  /** Jak často jev v datech nastal. */
  baseRate: number;
}

const BIN_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** Log-loss jednoho pozorování. */
const ll = (p: number, hit: boolean) => -Math.log(Math.max(hit ? p : 1 - p, 1e-9));

export function binaryCalibration(
  points: { p: number; hit: boolean }[]
): BinaryCalibration {
  const n = points.length;
  if (n === 0) {
    return { bins: [], ece: null, n: 0, logloss: 0, baseLogloss: 0, baseRate: 0 };
  }

  const baseRate = points.filter((x) => x.hit).length / n;
  const logloss = points.reduce((a, x) => a + ll(x.p, x.hit), 0) / n;
  const baseLogloss = points.reduce((a, x) => a + ll(baseRate, x.hit), 0) / n;

  const bins: CalibrationBin[] = [];
  let eceSum = 0;
  for (let i = 0; i < BIN_EDGES.length - 1; i++) {
    const lower = BIN_EDGES[i];
    const upper = BIN_EDGES[i + 1];
    // Poslední koš je uzavřený zprava, ať se p = 1 neztratí.
    const inBin = points.filter(
      (x) => x.p >= lower && (i === BIN_EDGES.length - 2 ? x.p <= upper : x.p < upper)
    );
    if (inBin.length === 0) {
      bins.push({ lower, upper, count: 0, avgPredicted: null, observed: null });
      continue;
    }
    const avgPredicted = inBin.reduce((a, x) => a + x.p, 0) / inBin.length;
    const observed = inBin.filter((x) => x.hit).length / inBin.length;
    eceSum += (inBin.length / n) * Math.abs(observed - avgPredicted);
    bins.push({ lower, upper, count: inBin.length, avgPredicted, observed });
  }

  return { bins, ece: eceSum, n, logloss, baseLogloss, baseRate };
}
