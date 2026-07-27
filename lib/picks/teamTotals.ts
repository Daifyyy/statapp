import type { PredictionRow } from "@/lib/types";
import {
  drawTau,
  poissonVector,
  sharpenLambdas,
  PREDICT_PARAMS,
  type PredictParams,
} from "@/lib/stats/predict";
import { binaryCalibration, type BinaryCalibration } from "./calibration";

/**
 * **Týmové totaly** (`Total - Home` / `Total - Away`): kolik gólů dá JEDEN tým.
 *
 * Proč je to levné: nepotřebuje žádný nový model. Naše mřížka skóre už rozdělení gólů
 * obou týmů obsahuje – týmový total je prostě její **marginála**. Model, λ ani data se
 * nemění, jen se z hotové mřížky přečte něco, co se dosud zahazovalo.
 *
 * **Marginály se počítají z celé mřížky, i když by stačil `poissonVector(λ)`** – a stojí
 * za to vědět proč, protože to není samozřejmé ani zbytečné:
 *
 * Dixon–Colesovo τ **marginály zachovává přesně**. Pro `i = 0` vyjde oprava jako
 * `ph₀·[1 + λₕ·ρ·(pa₁ − λₐ·pa₀)]`, a protože `pa₁ = λₐ·pa₀`, je závorka **nula**; totéž
 * pro `i = 1`. Je to vlastnost, na které je DC postavené: τ přerozděluje hmotu **uvnitř**
 * čtyř nejnižších skóre a řádkové ani sloupcové součty nemění. Týmový total je tedy
 * číselně Poisson (ověřeno testem, shoda na 6 desetinných míst; zbytek je useknutí
 * mřížky na 10 gólech).
 *
 * Počítat to z mřížky přesto dává smysl: je to **konstrukčně** tentýž objekt, ze kterého
 * pochází 1X2 a Over 2.5, takže se ty trhy nemůžou rozejít. Kdyby mřížka někdy dostala
 * korekci, která marginály NEzachovává (bivariační Poisson se společným šokem takový je),
 * týmové totaly se opraví samy – kdežto `poissonVector(λ)` by tiše dál vracel staré číslo.
 * `LAMBDA_SHARPEN` marginály naopak mění vždy (posouvá samotné λ), proto se aplikuje.
 *
 * Stejně jako u rohů: **měří se kvalita modelu, ne ziskovost.** Historické kurzy na
 * týmové totaly nemáme (football-data je nedává), takže tohle odpovídá jen na otázku
 * „umí to model?", ne „vydělá to?".
 *
 * Modul je čistý a **mimo produkční cestu** – `predictMatch` se nemění, nic se neukládá.
 */

/** Strana týmového totalu. */
export type TotalSide = "home" | "away";

/**
 * Marginální rozdělení gólů obou týmů z **opravené** mřížky (τ + zostření λ),
 * normalizované na součet 1. Index = počet gólů.
 */
export function goalMarginals(
  baseHome: number,
  baseAway: number,
  params: PredictParams = PREDICT_PARAMS
): { home: number[]; away: number[] } {
  const [lh, la] = sharpenLambdas(baseHome, baseAway, params.sharpen);
  const ph = poissonVector(lh);
  const pa = poissonVector(la);
  const home = new Array<number>(ph.length).fill(0);
  const away = new Array<number>(pa.length).fill(0);
  let total = 0;
  for (let i = 0; i < ph.length; i++) {
    for (let j = 0; j < pa.length; j++) {
      const p = ph[i] * pa[j] * drawTau(i, j, lh, la, params.rho);
      home[i] += p;
      away[j] += p;
      total += p;
    }
  }
  const norm = total || 1;
  return {
    home: home.map((x) => x / norm),
    away: away.map((x) => x / norm),
  };
}

/** `P(počet > line)` z marginálního rozdělení (line je půlková: 0.5, 1.5, 2.5). */
export function overProbOf(marginal: number[], line: number): number {
  const need = Math.floor(line) + 1;
  let cdf = 0;
  for (let k = 0; k < need && k < marginal.length; k++) cdf += marginal[k];
  return Math.min(Math.max(1 - cdf, 1e-6), 1 - 1e-6);
}

/** `P(tým dá víc než `line` gólů)` přímo z uloženého řádku predikce. */
export function teamTotalProb(
  row: Pick<PredictionRow, "lambdaHome" | "lambdaAway" | "rho" | "sharpen">,
  side: TotalSide,
  line: number
): number {
  const m = goalMarginals(row.lambdaHome, row.lambdaAway, {
    // Řádek nese, čím byl spočítaný – stejná zásada jako u `reprice`: nemíchat
    // uložená λ s aktuálními konstantami, jinak se měří dvě různé věci najednou.
    rho: row.rho ?? PREDICT_PARAMS.rho,
    sharpen: row.sharpen ?? PREDICT_PARAMS.sharpen,
    calibA: PREDICT_PARAMS.calibA,
    calibB: PREDICT_PARAMS.calibB,
  });
  return overProbOf(side === "home" ? m.home : m.away, line);
}

/**
 * Kalibrace týmového totalu na dané straně a lince nad odehranými řádky.
 * Řádky bez výsledku nebo bez dostupné predikce se přeskočí.
 */
export function teamTotalCalibration(
  rows: PredictionRow[],
  side: TotalSide,
  line: number
): BinaryCalibration {
  const points: { p: number; hit: boolean }[] = [];
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const actual = side === "home" ? r.homeGoals : r.awayGoals;
    points.push({ p: teamTotalProb(r, side, line), hit: actual > line });
  }
  return binaryCalibration(points);
}

/**
 * Kontrola úrovně: sedí λ jako průměr? Systematické vychýlení se přelije do všech
 * linií naráz, takže se musí ověřit dřív než tvar.
 */
export function teamTotalLevel(
  rows: PredictionRow[],
  side: TotalSide
): { lambda: number; actual: number; n: number } {
  let lambda = 0;
  let actual = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    lambda += side === "home" ? r.lambdaHome : r.lambdaAway;
    actual += side === "home" ? r.homeGoals : r.awayGoals;
    n++;
  }
  return n ? { lambda: lambda / n, actual: actual / n, n } : { lambda: 0, actual: 0, n: 0 };
}

/**
 * Pearsonova podmíněná disperze týmových gólů – týž test jako u rohů. Poisson tvrdí
 * `rozptyl = průměr` (poměr 1). U gólů by měl sedět líp než u rohů, protože gólů je
 * málo a Poisson je pro ně přirozenější model; kdyby ne, podstřelujeme chvosty.
 */
export function teamTotalDispersion(rows: PredictionRow[], side: TotalSide): number {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const lambda = side === "home" ? r.lambdaHome : r.lambdaAway;
    if (lambda <= 0) continue;
    const actual = side === "home" ? r.homeGoals : r.awayGoals;
    sum += (actual - lambda) ** 2 / lambda;
    n++;
  }
  return n ? sum / n : 0;
}
