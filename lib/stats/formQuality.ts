import type {
  FormMatchQuality,
  FormQuality,
  MatchResult,
  MatchStat,
  Venue,
} from "@/lib/types";
import { FORM_SIZE, orderedMatches } from "./summary";
import { PREDICT_PARAMS, gridProbs } from "./predict";

/**
 * **Kvalita formy**: sedí posledních pět výsledků s výkony? `TeamSummary` říká jen
 * W/D/L; tenhle modul k tomu doplní, jestli za tou sérií stojí i hra – tedy přesně ten
 * rozpor, kvůli kterému vznikl `matchReport.ts`, jen agregovaný přes okno formy.
 *
 * **Proč to není `matchReport.ts` per zápas:** ten je konstruovaný jako *podíl dvou stran
 * jednoho zápasu* (součet pruhů je vždy 10) a potřebuje k tomu obě poloviny odpovědi
 * `/fixtures/statistics`. Tady je soupeř pokaždé jiný a v `MatchStat` máme jen **vlastní**
 * metriky + `GOALS_AGAINST`/`XG_AGAINST` – soupeřovo držení, střely ani fauly v tom řádku
 * nejsou. Podíl 0–10 by tu tedy ani nešel spočítat, ani by nic neznamenal.
 *
 * **Očekávané body (xP)** se počítají **stejnou mřížkou jako predikce** (`gridProbs`):
 * λ = xG týmu a xG soupeře v tom zápase → P(V/R/P) → `3·V + R`. Reuse jádra, ne druhá
 * implementace Poissona, takže se to nemůže rozejít.
 *
 * Modul je **čistý** a stojí na už cachovaných datech (`MatchStatCache`) → **0 volání API**,
 * žádný bump cache verze. Degraduje po částech jako `matchReport.ts`: bez xG se rozhodnutí
 * nedopočítává odhadem, jen chybí (`null`) – u reprezentací to bude běžný stav (xG má
 * 30,9 % zápasů se statistikami, přáteláky 2,0 %).
 */

/** Prahy na jednom místě (zásada z `lib/insights/`). */
const T = {
  /**
   * `body − xP` na **jednom** zápase, od kterého mluvíme o štěstí/smůle. Těsná výhra
   * 1:0 při xG 0.4 : 1.6 dá xP ~0.8 → edge 2.2 (štěstí); vydřená 0:0 při xG 2.5 : 0.5
   * dá xP ~2.2 → edge −1.2 (smůla). Běžná zasloužená výhra se pod práh vejde.
   */
  matchEdge: 1.0,
  /** ⌀ `body − xP` na zápas přes celé okno → verdikt nad formou. */
  windowEdge: 0.5,
  /**
   * Kolik zápasů **s xG** musí okno mít, aby verdikt vůbec vznikl. xP z pěti zápasů má
   * obrovský interval; pod čtyřmi by to bylo hádání. Jednotlivé zápasy se hodnotí i tak
   * (badge má vždy vlastní čísla vedle sebe), agreguje se až od prahu.
   */
  minXgSample: 4,
} as const;

/**
 * xP je **retrodikce** odehraného zápasu, ne predikce. Zostření λ (`sharpen`) i Platt
 * kalibrace (`calibA/B`) jsou post-parametry fitnuté na *predikční* λ – na hotové xG
 * nemají co opravovat. Dnes jsou obojí přesný no-op, ale vypínáme je **explicitně**, aby
 * jejich případné zapnutí v `predict.ts` tiše nepokřivilo očekávané body.
 * ρ naopak zůstává: Dixon–Colesova korekce nízkých skóre je vlastnost gólového
 * rozdělení, ne prediktivní post-param.
 */
const XP_PARAMS = { ...PREDICT_PARAMS, sharpen: 1, calibA: 1, calibB: 0 };

const num = (v: number | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

function resultOf(goalsFor: number, goalsAgainst: number): MatchResult {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

const pointsOf = (r: MatchResult): number => (r === "W" ? 3 : r === "D" ? 1 : 0);

/**
 * Očekávané body z xG obou stran. `gridProbs` bere λ jako „první/druhá strana" – žádná
 * domácí výhoda se tu nepřidává (ta žije ve stavbě λ v `expectedGoals`, ne v mřížce),
 * takže je jedno, jestli tým hrál doma nebo venku.
 */
export function expectedPointsFromXg(xgFor: number, xgAgainst: number): number {
  const g = gridProbs(xgFor, xgAgainst, XP_PARAMS);
  return 3 * g.homeWin + g.draw;
}

function qualityOf(m: MatchStat): FormMatchQuality {
  const goalsFor = num(m.metrics.GOALS_FOR) ?? 0;
  const goalsAgainst = num(m.metrics.GOALS_AGAINST) ?? 0;
  const result = resultOf(goalsFor, goalsAgainst);
  const points = pointsOf(result);

  const xgFor = num(m.metrics.XG);
  const xgAgainst = num(m.metrics.XG_AGAINST);

  // Obě strany, nebo nic. Jednostranné xG by dalo xP, ve kterém soupeř nemá šance vůbec.
  if (xgFor == null || xgAgainst == null) {
    return {
      fixtureId: m.fixtureId,
      date: m.date,
      result,
      goalsFor,
      goalsAgainst,
      xgFor: null,
      xgAgainst: null,
      points,
      expectedPoints: null,
      edge: null,
      verdict: null,
    };
  }

  const expectedPoints = expectedPointsFromXg(xgFor, xgAgainst);
  const edge = points - expectedPoints;

  return {
    fixtureId: m.fixtureId,
    date: m.date,
    result,
    goalsFor,
    goalsAgainst,
    xgFor: round2(xgFor),
    xgAgainst: round2(xgAgainst),
    points,
    expectedPoints: round2(expectedPoints),
    edge: round2(edge),
    verdict: edge >= T.matchEdge ? "lucky" : edge <= -T.matchEdge ? "unlucky" : "matched",
  };
}

/**
 * Věta je **popisná, ne hodnotící**: říká, co čísla jsou, a nechává na uživateli, co
 * si o tom myslí. Jmenovatel (kolik zápasů má xG) je v ní schválně vidět – stejná
 * zásada jako u `sampleSize` u čistých kont.
 */
function noteOf(
  level: NonNullable<FormQuality["level"]>,
  points: number,
  expectedPoints: number,
  n: number
): string {
  const xp = round1(expectedPoints).toFixed(1);
  const tail = `${points} b., podle xG ~${xp} b. z ${n} zápasů`;
  if (level === "overperforming") return `Výsledky jsou nad výkony: ${tail}.`;
  if (level === "underperforming") return `Výkony jsou nad výsledky: ${tail}.`;
  return `Výsledky odpovídají výkonům: ${tail}.`;
}

/** Kvalita formy pro jednu variantu (Doma/Venku/Celkově). */
export function computeFormQuality(
  matches: MatchStat[],
  venue: Venue
): FormQuality {
  const selected = orderedMatches(matches, venue).slice(0, FORM_SIZE);
  const quality = selected.map(qualityOf);

  const withXg = quality.filter((q) => q.expectedPoints != null);
  const xgSampleSize = withXg.length;

  if (xgSampleSize === 0) {
    return {
      venue,
      matches: quality,
      xgSampleSize: 0,
      points: null,
      expectedPoints: null,
      xgDiffPerMatch: null,
      level: null,
      note: "",
    };
  }

  let points = 0;
  let expectedPoints = 0;
  let xgDiff = 0;
  for (const q of withXg) {
    points += q.points;
    expectedPoints += q.expectedPoints!;
    xgDiff += q.xgFor! - q.xgAgainst!;
  }

  const perMatchEdge = (points - expectedPoints) / xgSampleSize;
  const level: FormQuality["level"] =
    xgSampleSize < T.minXgSample
      ? null
      : perMatchEdge >= T.windowEdge
        ? "overperforming"
        : perMatchEdge <= -T.windowEdge
          ? "underperforming"
          : "inline";

  return {
    venue,
    matches: quality,
    xgSampleSize,
    points,
    expectedPoints: round2(expectedPoints),
    xgDiffPerMatch: round2(xgDiff / xgSampleSize),
    level,
    note: level ? noteOf(level, points, expectedPoints, xgSampleSize) : "",
  };
}

/** Kvalita formy pro všechny varianty (HOME/AWAY/TOTAL) – jako `computeAllSummaries`. */
export function computeAllFormQuality(matches: MatchStat[]): FormQuality[] {
  return (["HOME", "AWAY", "TOTAL"] as Venue[]).map((v) =>
    computeFormQuality(matches, v)
  );
}
