import { poissonVector } from "@/lib/stats/predict";

/**
 * ASIJSKÝ HENDIKEP JAKO MĚŘÍTKO (ne jako trh k sázení).
 *
 * Proč zrovna AH: dosud jsme se s trhem srovnávali přes 1X2 log-loss (`market.ts`) a
 * vyšlo „ztrácíme 0.048". To je pravda, ale **neříká to, čím** – jestli se mýlíme v tom,
 * kdo je lepší, nebo v tom, kolik padne gólů. Zavírací AH umí obojí rozplést:
 *
 *  1. **Marže ~2 %** (proti 5–7 % u 1X2 v rekreační knize) → nejmenší šum v ceně.
 *  2. **De-vig je tu PŘESNÝ, ne kompromis.** U 1X2 musíme volit metodu (proporcionální /
 *     Shin / power) a volba ovlivní výsledek. U dvoucestného trhu s push je poměr
 *     `1/o` obou stran přesně `p_výhra : p_prohra`, takže dělení overroundem vrátí
 *     pravděpodobnosti podmíněné „nebyl push" bez jediného volného parametru.
 *  3. **Spojitý výstup.** Z linky + ceny + totalu se dá zpětně dopočítat, jakou
 *     **převahu v gólech** (λ_dom − λ_host) trh zápasu přisuzuje. Tu pak jde porovnat
 *     s naší λ číslo proti číslu a hlavně **regresovat na skutečný rozdíl gólů**.
 *     Spojitý cíl má řádově větší statistickou sílu než diskrétní V/R/P – na stejný
 *     verdikt stačí stovky zápasů místo tisíců.
 *
 * Rozklad je na **dvě nezávislé osy**: `supremacy` (= λ_dom − λ_host, kdo je lepší)
 * a `total` (= λ_dom + λ_host, kolik padne gólů). Přesně tak je postavený i náš model
 * (`dampenTotal` hýbe součtem a rozdíl drží), takže se dá adresně říct, která polovina
 * λ je špatně.
 *
 * **Hlavní test tohohle modulu** je regrese
 *   `skutečný rozdíl gólů ~ tržní převaha + (naše převaha − tržní převaha)`.
 * Koeficient u druhého členu je odpověď na otázku, kvůli které to celé vzniklo:
 *   > β₂ > 0 (významně) = naše odchylka od trhu nese informaci, kterou trh nemá → hrana.
 *   > β₂ ≈ 0 = nepřidáváme nic, jsme jen šumnější kopie trhu.
 *   > β₂ < 0 = naše odchylka je systematicky ŠPATNÝM směrem (trh nás přeučuje).
 * Zároveň β₁ ≈ 1 je kontrola zdravého rozumu: trh by měl být nevychýlený.
 *
 * Modul je **čistý** (žádné IO, žádné API) a nesahá na produkční predikci.
 */

/** Kolik gólů maximálně uvažujeme na stranu – shodné s mřížkou v `predict.ts`. */
const MAX_GOALS = 10;
/** Rozsah rozdílu gólů D = domácí − hosté, tedy −MAX_GOALS … +MAX_GOALS. */
const MAX_DIFF = MAX_GOALS;

const MIN_TOTAL = 0.3;
const MAX_TOTAL = 8;

/**
 * Odmaržování **dvoucestného** trhu (asijský hendikep, Over/Under).
 *
 * Na rozdíl od 1X2, kde je proporcionální de-vig vědomý kompromis (viz `market.ts`),
 * je tady přesný. Fér cena strany s pushem splňuje `o = (p_v + p_p) / p_v`, takže
 * `1/o_dom = p_v/(p_v+p_p)` a `1/o_host = p_p/(p_v+p_p)`; ty dvě dávají součet přesně 1
 * a podíl overroundem vrátí právě **pravděpodobnosti podmíněné tím, že nedošlo k push**.
 *
 * Vrací dvojici ve stejném pořadí, v jakém přišly ceny (`null` u nesmyslných kurzů).
 */
export function devigTwoWay(first: number, second: number): [number, number] | null {
  if (!(first > 1) || !(second > 1)) return null;
  const sum = 1 / first + 1 / second;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return [1 / first / sum, 1 / second / sum];
}

/**
 * P(v zápase padnou ≥ 3 góly), když součet gólů ~ Poisson(`total`).
 *
 * Součet dvou nezávislých Poissonů je Poisson se součtem λ, takže tenhle krok
 * **nepřidává žádný předpoklad navíc** proti tomu, na čem stojí celá mřížka v `predict.ts`.
 * (Dixon–Colesovo τ rozloží hmotu mezi nejnižší skóre, takže P(total ≤ 2) posune o zlomek
 * procenta – to je jediná nepřesnost a je o řád menší než šum v cenách.)
 */
export function overTwoFiveProb(total: number): number {
  return 1 - Math.exp(-total) * (1 + total + (total * total) / 2);
}

/**
 * Inverze `overTwoFiveProb`: z odmaržované P(Over 2.5) zpět na **očekávaný počet gólů**.
 * Funkce je v `total` ostře rostoucí → bisekce je spolehlivá a bez volných parametrů.
 */
export function impliedTotal(pOver: number): number | null {
  if (!(pOver > 0) || !(pOver < 1)) return null;
  if (overTwoFiveProb(MIN_TOTAL) > pOver || overTwoFiveProb(MAX_TOTAL) < pOver) return null;
  let lo = MIN_TOTAL;
  let hi = MAX_TOTAL;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (overTwoFiveProb(mid) < pOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Rozdělení rozdílu gólů `D = domácí − hosté` pro dvojici λ (Skellam, spočítaný z mřížky).
 * Index `k + MAX_DIFF` = P(D = k). Poissonův vektor je useknutý na 10 gólech, takže se
 * na konci normalizuje – jinak by uříznutý chvost tiše ubral hmotu.
 */
export function goalDiffDist(lambdaHome: number, lambdaAway: number): number[] {
  const h = poissonVector(lambdaHome);
  const a = poissonVector(lambdaAway);
  const out = new Array<number>(2 * MAX_DIFF + 1).fill(0);
  let sum = 0;
  for (let i = 0; i < h.length; i++) {
    for (let j = 0; j < a.length; j++) {
      const p = h[i] * a[j];
      out[i - j + MAX_DIFF] += p;
      sum += p;
    }
  }
  if (sum > 0) for (let k = 0; k < out.length; k++) out[k] /= sum;
  return out;
}

/** Je linka čtvrtinová (−0.25, −0.75, …)? Ty se dělí na dvě poloviční sázky. */
export function isQuarterLine(line: number): boolean {
  return Math.abs(line * 2 - Math.round(line * 2)) > 1e-9;
}

/**
 * P(domácí pokryjí hendikep `line`) **podmíněně tím, že nedošlo k push** – tedy přesně ta
 * veličina, kterou vrací `devigTwoWay`. `line` je hendikep DOMÁCÍCH: záporný = favorit
 * (−1 znamená „musí vyhrát o dva, o jeden = push").
 *
 * Čtvrtinová linka (−0.75) je půl sázky na −0.5 a půl na −1; počítá se proto jako průměr
 * obou půlek. Porovnávat kurz na −0.75 s modelem pro −0.5 by byla přesně ta chyba, kterou
 * u rohů hlídá párování po lince.
 */
export function coverProb(line: number, lambdaHome: number, lambdaAway: number): number | null {
  if (!(lambdaHome > 0) || !(lambdaAway > 0)) return null;
  const dist = goalDiffDist(lambdaHome, lambdaAway);
  const parts = isQuarterLine(line) ? [line - 0.25, line + 0.25] : [line];
  let win = 0;
  let lose = 0;
  for (const l of parts) {
    for (let k = -MAX_DIFF; k <= MAX_DIFF; k++) {
      const p = dist[k + MAX_DIFF];
      const margin = k + l;
      if (margin > 1e-9) win += p;
      else if (margin < -1e-9) lose += p;
      // margin === 0 → push: do poměru nevstupuje (sázka se vrací)
    }
  }
  const denom = win + lose;
  return denom > 0 ? win / denom : null;
}

/**
 * Inverze `coverProb`: jakou **převahu v gólech** (λ_dom − λ_host) musí mít domácí, aby
 * při daném totalu vycházela zrovna tahle pravděpodobnost pokrytí linky?
 *
 * `coverProb` je v převaze ostře rostoucí (při pevném totalu), takže zase bisekce.
 * Citlivost na chybu v totalu je druhého řádu – linka určuje polohu, total jen šířku
 * rozdělení kolem ní.
 */
export function impliedSupremacy(
  line: number,
  pHomeCover: number,
  total: number
): number | null {
  if (!(total > 0) || !(pHomeCover > 0) || !(pHomeCover < 1)) return null;
  const at = (s: number) => coverProb(line, (total + s) / 2, (total - s) / 2);
  let lo = -total * 0.95;
  let hi = total * 0.95;
  const pLo = at(lo);
  const pHi = at(hi);
  // Mimo dosažitelný rozsah (extrémní cena při nízkém totalu) → radši nic než clamp,
  // který by se v regresi tvářil jako platné pozorování.
  if (pLo == null || pHi == null || pHomeCover <= pLo || pHomeCover >= pHi) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    if (p == null) return null;
    if (p < pHomeCover) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Jak trh vidí zápas, přeložené do řeči našeho modelu (λ obou stran). */
export interface MarketView {
  /** λ_dom + λ_host – kolik gólů trh čeká. */
  total: number;
  /** λ_dom − λ_host – o kolik gólů jsou domácí lepší. */
  supremacy: number;
  lambdaHome: number;
  lambdaAway: number;
}

/**
 * Zavírací AH (linka + dvoucestná cena) **plus** zavírací Over/Under 2.5 → tržní λ.
 * Obojí je potřeba: O/U dá úroveň (total), AH dá rozdělení té úrovně mezi strany.
 */
export function marketView(
  line: number,
  ahHome: number,
  ahAway: number,
  ouOver: number,
  ouUnder: number
): MarketView | null {
  const ah = devigTwoWay(ahHome, ahAway);
  const ou = devigTwoWay(ouOver, ouUnder);
  if (!ah || !ou) return null;
  const total = impliedTotal(ou[0]);
  if (total == null) return null;
  const supremacy = impliedSupremacy(line, ah[0], total);
  if (supremacy == null) return null;
  return {
    total,
    supremacy,
    lambdaHome: (total + supremacy) / 2,
    lambdaAway: (total - supremacy) / 2,
  };
}

// ── Regrese (OLS) ────────────────────────────────────────────────────────────────────

export interface OlsFit {
  n: number;
  intercept: number;
  /** Koeficienty v pořadí sloupců `X` (bez interceptu). */
  coef: number[];
  /** Směrodatné chyby koeficientů. */
  se: number[];
  /** t = coef / se. |t| > 2 ≈ významné na 5% hladině. */
  t: number[];
  r2: number;
}

/** Inverze malé čtvercové matice (Gauss–Jordan s pivotací). `null` u singulární. */
function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

/**
 * Obyčejná lineární regrese `y ~ 1 + X` přes normální rovnice.
 *
 * Malý rozměr (2–3 regresory) → normální rovnice bohatě stačí a nepotřebujeme závislost
 * navíc. Směrodatné chyby jsou klasické (homoskedastické); u fotbalových dat je rozptyl
 * rozdílu gólů napříč zápasy dost stejnorodý, takže to na verdikt „je β₂ nula?" stačí.
 */
export function ols(y: number[], X: number[][]): OlsFit | null {
  const n = y.length;
  const k = X[0]?.length ?? 0;
  if (k === 0 || n <= k + 1) return null;
  const p = k + 1;
  const Z = X.map((row) => [1, ...row]);

  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < p; r++) {
      b[r] += Z[i][r] * y[i];
      for (let c = 0; c < p; c++) A[r][c] += Z[i][r] * Z[i][c];
    }
  }
  const Ainv = invert(A);
  if (!Ainv) return null;
  const beta = Ainv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));

  const ybar = y.reduce((s, v) => s + v, 0) / n;
  let rss = 0;
  let tss = 0;
  for (let i = 0; i < n; i++) {
    const fit = Z[i].reduce((s, v, j) => s + v * beta[j], 0);
    rss += (y[i] - fit) ** 2;
    tss += (y[i] - ybar) ** 2;
  }
  const s2 = rss / (n - p);
  const se = beta.map((_, j) => Math.sqrt(Math.max(s2 * Ainv[j][j], 0)));

  return {
    n,
    intercept: beta[0],
    coef: beta.slice(1),
    se: se.slice(1),
    t: beta.slice(1).map((c, i) => (se[i + 1] > 0 ? c / se[i + 1] : 0)),
    r2: tss > 0 ? 1 - rss / tss : 0,
  };
}

// ── Diagnostika ──────────────────────────────────────────────────────────────────────

/** Jeden zápas připravený k porovnání: naše λ, tržní λ a skutečnost. */
export interface SupremacyRow {
  ourSupremacy: number;
  ourTotal: number;
  marketSupremacy: number;
  marketTotal: number;
  actualDiff: number;
  actualTotal: number;
}

/**
 * Neparametrická kontrola vedle regrese: zápasy se seřadí podle naší odchylky od trhu
 * a rozdělí na stejně velké koše. Nese-li odchylka informaci, musí `residual` růst
 * spolu s `deviation` – a to je vidět i bez předpokladu linearity.
 */
export interface DeviationBucket {
  n: number;
  /** Průměrná naše odchylka od trhu (naše převaha − tržní převaha). */
  deviation: number;
  /** Průměrný zbytek trhu: skutečný rozdíl gólů − tržní převaha. */
  residual: number;
}

export interface SupremacyDiagnostic {
  n: number;
  mean: {
    ourSupremacy: number;
    marketSupremacy: number;
    actualDiff: number;
    ourTotal: number;
    marketTotal: number;
    actualTotal: number;
  };
  /** Odmocnina střední kvadratické chyby proti skutečnosti (nižší = blíž pravdě). */
  rmse: {
    ourSupremacy: number;
    marketSupremacy: number;
    ourTotal: number;
    marketTotal: number;
  };
  /** `skutečný rozdíl gólů ~ tržní převaha + naše odchylka`. Koeficient [1] je verdikt. */
  supremacyFit: OlsFit | null;
  /** Totéž na ose součtu gólů. */
  totalFit: OlsFit | null;
  buckets: DeviationBucket[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const rmse = (a: number[], b: number[]) =>
  a.length ? Math.sqrt(mean(a.map((v, i) => (v - b[i]) ** 2))) : 0;

/**
 * Hlavní výstup modulu. Vrací `n: 0`, když není co počítat – prázdný vstup je legitimní
 * stav (liga bez AH ve zdroji), ne chyba.
 */
export function computeSupremacyDiagnostic(
  rows: SupremacyRow[],
  bucketCount = 5
): SupremacyDiagnostic {
  const empty: SupremacyDiagnostic = {
    n: 0,
    mean: {
      ourSupremacy: 0,
      marketSupremacy: 0,
      actualDiff: 0,
      ourTotal: 0,
      marketTotal: 0,
      actualTotal: 0,
    },
    rmse: { ourSupremacy: 0, marketSupremacy: 0, ourTotal: 0, marketTotal: 0 },
    supremacyFit: null,
    totalFit: null,
    buckets: [],
  };
  if (rows.length === 0) return empty;

  const ourSup = rows.map((r) => r.ourSupremacy);
  const mktSup = rows.map((r) => r.marketSupremacy);
  const actDiff = rows.map((r) => r.actualDiff);
  const ourTot = rows.map((r) => r.ourTotal);
  const mktTot = rows.map((r) => r.marketTotal);
  const actTot = rows.map((r) => r.actualTotal);

  // Regresory: tržní pohled + NAŠE ODCHYLKA od něj. Rozklad na tyhle dva (místo
  // „tržní + naše") je schválně: koeficienty pak nejsou zaměnitelné a ten druhý
  // odpovídá přímo na otázku „přidáváme něco k trhu?".
  const supremacyFit = ols(
    actDiff,
    rows.map((r) => [r.marketSupremacy, r.ourSupremacy - r.marketSupremacy])
  );
  const totalFit = ols(
    actTot,
    rows.map((r) => [r.marketTotal, r.ourTotal - r.marketTotal])
  );

  const sorted = [...rows].sort(
    (a, b) => a.ourSupremacy - a.marketSupremacy - (b.ourSupremacy - b.marketSupremacy)
  );
  const buckets: DeviationBucket[] = [];
  const size = Math.floor(sorted.length / bucketCount);
  if (size > 0) {
    for (let i = 0; i < bucketCount; i++) {
      const from = i * size;
      const to = i === bucketCount - 1 ? sorted.length : from + size;
      const slice = sorted.slice(from, to);
      buckets.push({
        n: slice.length,
        deviation: mean(slice.map((r) => r.ourSupremacy - r.marketSupremacy)),
        residual: mean(slice.map((r) => r.actualDiff - r.marketSupremacy)),
      });
    }
  }

  return {
    n: rows.length,
    mean: {
      ourSupremacy: mean(ourSup),
      marketSupremacy: mean(mktSup),
      actualDiff: mean(actDiff),
      ourTotal: mean(ourTot),
      marketTotal: mean(mktTot),
      actualTotal: mean(actTot),
    },
    rmse: {
      ourSupremacy: rmse(ourSup, actDiff),
      marketSupremacy: rmse(mktSup, actDiff),
      ourTotal: rmse(ourTot, actTot),
      marketTotal: rmse(mktTot, actTot),
    },
    supremacyFit,
    totalFit,
    buckets,
  };
}
