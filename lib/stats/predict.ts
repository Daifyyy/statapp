import type { MatchPrediction, TeamComparison } from "@/lib/types";
import { lowConfidenceOf, valueOrTotal } from "./metricLookup";

const MAX_GOALS = 10; // mřížka Poissonu (0..10 pro každý tým)
const MIN_LAMBDA = 0.2;
const MAX_LAMBDA = 5;

/**
 * Predikce zápasu z očekávaných gólů obou týmů (nezávislý Poisson model).
 * Domácí útok × hostující obrana (a naopak), venue-specific s fallbackem na TOTAL.
 * Vše z výstupu `compareTeams` – žádná nová data, čistá funkce.
 */
export function predictMatch(
  home: TeamComparison,
  away: TeamComparison
): MatchPrediction {
  const lambdaHome = expectedGoals(home, away, true);
  const lambdaAway = expectedGoals(away, home, false);

  const ph = poissonVector(lambdaHome);
  const pa = poissonVector(lambdaAway);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over25 = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j];
      if (i > j) homeWin += p;
      else if (i === j) draw += p;
      else awayWin += p;
      if (i + j >= 3) over25 += p;
    }
  }
  // Re-normalizace (uťatá mřížka ztratí nepatrný zbytek pravděpodobnosti).
  const total = homeWin + draw + awayWin || 1;
  homeWin /= total;
  draw /= total;
  awayWin /= total;

  const bttsYes = (1 - ph[0]) * (1 - pa[0]);

  const lowConfidence =
    lowConfidenceOf(home.values, "GOALS_FOR", "HOME") ||
    lowConfidenceOf(away.values, "GOALS_FOR", "AWAY");

  return {
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
): number {
  const attackVenue = isHome ? "HOME" : "AWAY";
  const defenseVenue = isHome ? "AWAY" : "HOME";

  const attack = valueOrTotal(team.values, "GOALS_FOR", attackVenue);
  const defense = valueOrTotal(opponent.values, "GOALS_AGAINST", defenseVenue);
  const goalsEstimate = mean([attack, defense]);

  const xgAttack = valueOrTotal(team.values, "XG", attackVenue);
  const xgEstimate =
    xgAttack != null ? mean([xgAttack, defense]) : null;

  const lambda =
    xgEstimate != null && goalsEstimate != null
      ? (goalsEstimate + xgEstimate) / 2
      : (goalsEstimate ?? xgEstimate ?? 1);

  return clamp(lambda, MIN_LAMBDA, MAX_LAMBDA);
}

/** Vektor Poissonových pravděpodobností p(k) pro k = 0..MAX_GOALS. */
function poissonVector(lambda: number): number[] {
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
