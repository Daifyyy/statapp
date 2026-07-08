// Simulace zápasu na TÉMŽE predikčním jádru jako reálné predikce (Poisson +
// Dixon–Coles). Z ratingů dvou týmů + taktik spočítá λ, postaví normalizovanou
// mřížku skóre, z ní vysampluje výsledek a vrátí i 1X2 pravděpodobnosti (naučný
// display „co říká model" před odehráním).

import { poissonVector, drawTau } from "@/lib/stats/predict";
import {
  DC_RHO,
  HOME_ADV_SCALE,
  HOME_BOOST_CAP,
  HOME_DEFENSE_SHARE,
  MAX_LAMBDA,
  MIN_LAMBDA,
} from "./balance";
import type { GameTeam, MatchProbs } from "./types";

const MAX_GOALS = 10; // stejná mřížka 0..10 jako predict.ts

/**
 * Výsledná úprava λ jedné strany = plán × counter × morálka × eventy (sestaví engine).
 * `attack` násobí vstřelené, `concede` OBDRŽENÉ. AI soupeři jedou NEUTRAL_ADJUST.
 */
export interface SideAdjust {
  attack: number;
  concede: number;
}

export const NEUTRAL_ADJUST: SideAdjust = { attack: 1, concede: 1 };

interface Cell {
  home: number;
  away: number;
  p: number;
}

/**
 * Očekávané góly obou týmů z ratingů + úprav. Domácí výhoda (`homeBoost`) jde do λ dvěma
 * kanály: zvedá útok domácích a **snižuje, kolik domácí dostávají** (`HOME_DEFENSE_SHARE`).
 * `HOME_ADV_SCALE` kompenzuje `/2` níž – λ je průměr „co jeden dá" a „co druhý dostane",
 * takže násobič na jednom sčítanci se v λ projeví jen zhruba půlkou.
 * Hosté nemají žádný postih; celá výhoda je vyjádřená na straně domácích.
 */
export function matchLambdas(
  home: GameTeam,
  away: GameTeam,
  homeAdj: SideAdjust = NEUTRAL_ADJUST,
  awayAdj: SideAdjust = NEUTRAL_ADJUST
): [number, number] {
  const { attackMult, defenseMult } = homeAdvantage(home.homeBoost);
  const homeAtk = home.attack * attackMult * homeAdj.attack;
  const awayAtk = away.attack * awayAdj.attack;
  const homeConcede = (home.defense * homeAdj.concede) / defenseMult; // domácí dostávají míň
  const awayConcede = away.defense * awayAdj.concede; // kolik hosté dostávají
  const lh = clamp((homeAtk + awayConcede) / 2, MIN_LAMBDA, MAX_LAMBDA);
  const la = clamp((awayAtk + homeConcede) / 2, MIN_LAMBDA, MAX_LAMBDA);
  return [lh, la];
}

/**
 * Rozklad `homeBoost` na násobič útoku a obrany domácích. `homeBoost` je stropovaný
 * (`HOME_BOOST_CAP`) i tady – kdyby ho někdy nějaká cesta (investice do stadionu, migrace
 * starého save, ručně upravená data) vyhnala výš, model se nesmí utrhnout.
 */
export function homeAdvantage(homeBoost: number): {
  attackMult: number;
  defenseMult: number;
} {
  const hb = clamp(homeBoost, 1, HOME_BOOST_CAP);
  const edge = (hb - 1) * HOME_ADV_SCALE;
  return { attackMult: 1 + edge, defenseMult: 1 + edge * HOME_DEFENSE_SHARE };
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
  homeAdj: SideAdjust = NEUTRAL_ADJUST,
  awayAdj: SideAdjust = NEUTRAL_ADJUST
): MatchProbs {
  const [lh, la] = matchLambdas(home, away, homeAdj, awayAdj);
  return outcomes(grid(lh, la));
}

/** Odehraje zápas: vysampluje skóre a vrátí i predikci z téže mřížky. */
export function simulateMatch(
  home: GameTeam,
  away: GameTeam,
  homeAdj: SideAdjust,
  awayAdj: SideAdjust,
  rand: () => number
): { homeGoals: number; awayGoals: number; probs: MatchProbs } {
  const [lh, la] = matchLambdas(home, away, homeAdj, awayAdj);
  const cells = grid(lh, la);
  const probs = outcomes(cells);
  const s = sample(cells, rand());
  return { homeGoals: s.home, awayGoals: s.away, probs };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
