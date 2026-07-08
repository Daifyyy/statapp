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
 * Očekávané góly obou týmů z ratingů + úprav.
 *
 * **Domácí výhoda je ADITIVNÍ posun λ v gólech**, ne násobič ratingů. Přičte se domácím
 * (`homeBonus`) a odečte hostům (`awayPenalty`); hosté jinak žádný postih nemají.
 * Odpovídá to i tomu, jak se domácí výhoda reálně měří (~+0,35 gólu), místo tvrzení, že
 * domácím zesílí útočníci o 30 %.
 *
 * Proč aditivně: v multiplikativní verzi se útok domácích NÁSOBIL a jejich obrana DĚLILA,
 * takže `∂λ/∂útok` bylo doma zesílené a `∂λ/∂obrana` tlumené → investice do útoku byla
 * strukturálně výnosnější než do obrany (+1.16 vs +0.84 bodu za sezónu) a žádná volba
 * `DEV_DEFENSE_STEP` to nespravila. Aditivně je `∂λ/∂rating = 1/2` pro obě strany a pro
 * oba typy zápasů → **parita** (+1.02 vs +0.95; zbytek je nelinearita Poissona).
 */
export function matchLambdas(
  home: GameTeam,
  away: GameTeam,
  homeAdj: SideAdjust = NEUTRAL_ADJUST,
  awayAdj: SideAdjust = NEUTRAL_ADJUST,
  /**
   * Zkrácení hrací doby: λ se násobí podílem odehraných minut. Prodloužení 2×15 min
   * = `30/90`. Škáluje se **celá** λ včetně domácího bonusu, ne jen ratingy – v kratším
   * úseku se domácí výhoda realizuje úměrně méně.
   */
  lambdaScale = 1
): [number, number] {
  const { homeBonus, awayPenalty } = homeAdvantage(home.homeBoost);
  const homeAtk = home.attack * homeAdj.attack;
  const awayAtk = away.attack * awayAdj.attack;
  const homeConcede = home.defense * homeAdj.concede; // kolik domácí dostávají
  const awayConcede = away.defense * awayAdj.concede; // kolik hosté dostávají
  const lh = clamp(((homeAtk + awayConcede) / 2 + homeBonus) * lambdaScale, MIN_LAMBDA, MAX_LAMBDA);
  const la = clamp(((awayAtk + homeConcede) / 2 - awayPenalty) * lambdaScale, MIN_LAMBDA, MAX_LAMBDA);
  return [lh, la];
}

/**
 * Domácí výhoda v GÓLECH: kolik se přičte λ domácích a kolik se odečte λ hostů.
 * `homeBoost` je poměr „domácí góly na zápas / celkové góly na zápas" (reálná data), takže
 * `hb − 1` je relativní domácí přírůstek; `HOME_ADV_SCALE` ho převede na góly.
 *
 * Bonus **záměrně nezávisí na ratingu týmu** – kdyby se násobil útokem, vrátila by se
 * asymetrie `∂λ/∂útok > ∂λ/∂obrana`. Stropováno `HOME_BOOST_CAP` i tady, kdyby ho nějaká
 * cesta (investice do stadionu, starý save, ručně upravená data) vyhnala výš.
 */
export function homeAdvantage(homeBoost: number): {
  homeBonus: number;
  awayPenalty: number;
} {
  const hb = clamp(homeBoost, 1, HOME_BOOST_CAP);
  const edge = (hb - 1) * HOME_ADV_SCALE;
  return { homeBonus: edge, awayPenalty: edge * HOME_DEFENSE_SHARE };
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
  rand: () => number,
  /** `30/90` pro prodloužení; 1 = plný zápas. Viz `matchLambdas`. */
  lambdaScale = 1
): { homeGoals: number; awayGoals: number; probs: MatchProbs } {
  const [lh, la] = matchLambdas(home, away, homeAdj, awayAdj, lambdaScale);
  const cells = grid(lh, la);
  const probs = outcomes(cells);
  const s = sample(cells, rand());
  return { homeGoals: s.home, awayGoals: s.away, probs };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
