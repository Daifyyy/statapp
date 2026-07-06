// Simulace zápasu na TÉMŽE predikčním jádru jako reálné predikce (Poisson +
// Dixon–Coles). Z ratingů dvou týmů + taktik spočítá λ, postaví normalizovanou
// mřížku skóre, z ní vysampluje výsledek a vrátí i 1X2 pravděpodobnosti (naučný
// display „co říká model" před odehráním).

import { poissonVector, drawTau } from "@/lib/stats/predict";
import { DC_RHO, MAX_LAMBDA, MIN_LAMBDA, TACTIC_MULT } from "./balance";
import type { GameTeam, MatchProbs, Tactic } from "./types";

const MAX_GOALS = 10; // stejná mřížka 0..10 jako predict.ts

interface Cell {
  home: number;
  away: number;
  p: number;
}

/** Očekávané góly obou týmů z ratingů + taktik (domácí výhoda = homeBoost na útoku). */
export function matchLambdas(
  home: GameTeam,
  away: GameTeam,
  homeTactic: Tactic,
  awayTactic: Tactic
): [number, number] {
  const ht = TACTIC_MULT[homeTactic];
  const at = TACTIC_MULT[awayTactic];
  const homeAtk = home.attack * home.homeBoost * ht.attack;
  const awayAtk = away.attack * at.attack;
  const homeConcede = home.defense * ht.defense; // kolik domácí dostávají
  const awayConcede = away.defense * at.defense; // kolik hosté dostávají
  const lh = clamp((homeAtk + awayConcede) / 2, MIN_LAMBDA, MAX_LAMBDA);
  const la = clamp((awayAtk + homeConcede) / 2, MIN_LAMBDA, MAX_LAMBDA);
  return [lh, la];
}

/** Normalizovaná mřížka skóre (Dixon–Coles korekce nízkých skóre). */
function grid(lh: number, la: number): Cell[] {
  const ph = poissonVector(lh);
  const pa = poissonVector(la);
  const cells: Cell[] = [];
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = ph[i] * pa[j] * drawTau(i, j, lh, la, DC_RHO);
      total += p;
      cells.push({ home: i, away: j, p });
    }
  }
  const norm = total || 1;
  for (const c of cells) c.p /= norm;
  return cells;
}

/** 1X2 pravděpodobnosti z mřížky. */
function outcomes(cells: Cell[]): MatchProbs {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (const c of cells) {
    if (c.home > c.away) homeWin += c.p;
    else if (c.home === c.away) draw += c.p;
    else awayWin += c.p;
  }
  return { homeWin, draw, awayWin };
}

/** Vybere skóre z mřížky podle uniformního čísla u ∈ [0,1). */
function sample(cells: Cell[], u: number): { home: number; away: number } {
  let acc = 0;
  for (const c of cells) {
    acc += c.p;
    if (u <= acc) return { home: c.home, away: c.away };
  }
  const last = cells[cells.length - 1];
  return { home: last.home, away: last.away };
}

/** Predikce zápasu (1X2) bez odehrání – pro naučný display před zápasem. */
export function predictProbs(
  home: GameTeam,
  away: GameTeam,
  homeTactic: Tactic = "balanced",
  awayTactic: Tactic = "balanced"
): MatchProbs {
  const [lh, la] = matchLambdas(home, away, homeTactic, awayTactic);
  return outcomes(grid(lh, la));
}

/** Odehraje zápas: vysampluje skóre a vrátí i predikci z téže mřížky. */
export function simulateMatch(
  home: GameTeam,
  away: GameTeam,
  homeTactic: Tactic,
  awayTactic: Tactic,
  rand: () => number
): { homeGoals: number; awayGoals: number; probs: MatchProbs } {
  const [lh, la] = matchLambdas(home, away, homeTactic, awayTactic);
  const cells = grid(lh, la);
  const probs = outcomes(cells);
  const s = sample(cells, rand());
  return { homeGoals: s.home, awayGoals: s.away, probs };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
