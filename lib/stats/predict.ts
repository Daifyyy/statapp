import type { MatchPrediction, TeamComparison } from "@/lib/types";
import { lowConfidenceOf, valueOrTotal } from "./metricLookup";

const MAX_GOALS = 10; // mřížka Poissonu (0..10 pro každý tým)
const MIN_LAMBDA = 0.2;
const MAX_LAMBDA = 5;

/**
 * Dixon–Coles parametr závislosti ρ. Nezávislý Poisson podhodnocuje nízkoskórové
 * remízy (0:0, 1:1), protože ignoruje korelaci gólů obou týmů. ρ < 0 ji opravuje
 * (víc remíz 0:0/1:1, míň těsných výher 1:0/0:1); ρ = 0 = čistý Poisson.
 * −0.13 je publikovaný odhad pro fotbal (Dixon & Coles 1997) – dolaď backtestem.
 */
const DC_RHO = -0.13;

/**
 * Predikce zápasu z očekávaných gólů obou týmů (Poisson s Dixon–Coles korekcí
 * nízkých skóre). Domácí útok × hostující obrana (a naopak), venue-specific
 * s fallbackem na TOTAL. Vše z výstupu `compareTeams` – žádná nová data, čistá funkce.
 */
export function predictMatch(
  home: TeamComparison,
  away: TeamComparison
): MatchPrediction {
  const lambdaHome = expectedGoals(home, away, true);
  const lambdaAway = expectedGoals(away, home, false);

  // Bez gólových i xG dat na některé straně nelze predikovat – nevydávej
  // falešnou 50/50, ale označ predikci jako nedostupnou (UI ji nahradí hláškou).
  if (lambdaHome == null || lambdaAway == null) {
    return {
      available: false,
      lambdaHome: lambdaHome ?? 0,
      lambdaAway: lambdaAway ?? 0,
      homeWin: 0,
      draw: 0,
      awayWin: 0,
      bttsYes: 0,
      over25: 0,
      lowConfidence: true,
    };
  }

  const ph = poissonVector(lambdaHome);
  const pa = poissonVector(lambdaAway);

  // Jediná smyčka přes mřížku skóre: na nízká skóre se aplikuje Dixon–Coles
  // korekce a všechny agregáty (V/R/P, Over 2.5, BTTS) se počítají z téže
  // opravené mřížky → vzájemně konzistentní.
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over25 = 0;
  let bttsYes = 0;
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j] * drawTau(i, j, lambdaHome, lambdaAway);
      total += p;
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (i + j >= 3) over25 += p;
      if (i >= 1 && j >= 1) bttsYes += p;
    }
  }
  // Re-normalizace (uťatá mřížka + korekce nezachová přesně 1).
  const norm = total || 1;
  homeWin /= norm;
  draw /= norm;
  awayWin /= norm;
  over25 /= norm;
  bttsYes /= norm;

  const lowConfidence =
    lowConfidenceOf(home.values, "GOALS_FOR", "HOME") ||
    lowConfidenceOf(away.values, "GOALS_FOR", "AWAY");

  return {
    available: true,
    lambdaHome,
    lambdaAway,
    homeWin,
    draw,
    awayWin,
    bttsYes,
    over25,
    lowConfidence,
  };
}

/**
 * Očekávané góly týmu: průměr jeho útoku a soupeřovy obrany ve správné variantě.
 * Je-li u obou k dispozici xG, zprůměruje se gólový odhad s xG odhadem (zpevnění).
 */
function expectedGoals(
  team: TeamComparison,
  opponent: TeamComparison,
  isHome: boolean
): number | null {
  const attackVenue = isHome ? "HOME" : "AWAY";
  const defenseVenue = isHome ? "AWAY" : "HOME";

  const attack = valueOrTotal(team.values, "GOALS_FOR", attackVenue);
  const defense = valueOrTotal(opponent.values, "GOALS_AGAINST", defenseVenue);
  const goalsEstimate = mean([attack, defense]);

  const xgAttack = valueOrTotal(team.values, "XG", attackVenue);
  const xgEstimate =
    xgAttack != null ? mean([xgAttack, defense]) : null;

  // Žádný gólový ani xG podklad → nelze odhadnout (vrať null).
  if (goalsEstimate == null && xgEstimate == null) return null;

  const lambda =
    xgEstimate != null && goalsEstimate != null
      ? (goalsEstimate + xgEstimate) / 2
      : (goalsEstimate ?? xgEstimate)!;

  return clamp(lambda, MIN_LAMBDA, MAX_LAMBDA);
}

/**
 * Dixon–Coles korekční faktor τ pro čtyři nejnižší skóre (jinde vrací 1).
 * ρ < 0 zvýší 0:0 a 1:1 a o totéž sníží 1:0 a 0:1. Výsledek je clampnutý na ≥ 0
 * jako pojistka proti záporné pravděpodobnosti při extrémních λ. Exportováno pro testy.
 */
export function drawTau(
  i: number,
  j: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number = DC_RHO
): number {
  let t = 1;
  if (i === 0 && j === 0) t = 1 - lambdaHome * lambdaAway * rho;
  else if (i === 0 && j === 1) t = 1 + lambdaHome * rho;
  else if (i === 1 && j === 0) t = 1 + lambdaAway * rho;
  else if (i === 1 && j === 1) t = 1 - rho;
  return t < 0 ? 0 : t;
}

/** Vektor Poissonových pravděpodobností p(k) pro k = 0..MAX_GOALS. Exportováno pro testy. */
export function poissonVector(lambda: number): number[] {
  const out = new Array<number>(MAX_GOALS + 1);
  let p = Math.exp(-lambda); // p(0)
  out[0] = p;
  for (let k = 1; k <= MAX_GOALS; k++) {
    p = (p * lambda) / k; // p(k) = p(k-1) * λ / k
    out[k] = p;
  }
  return out;
}

function mean(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
