import type { PredictionRow } from "@/lib/types";
import type { MatchOddsRecord, OddsTriple } from "./oddsDataset";
import { devig } from "./market";

/**
 * Peníze: co by strategie skutečně vydělala, kdyby se podle ní sázelo.
 *
 * Existující metriky (log-loss, Brier, ECE, hit-rate) říkají „jak dobrý je model",
 * ale ne „vydělá". Rozdíl je zásadní: model může být lepší než hádání a přesto
 * prodělávat, protože **nejdřív musí přebít marži sázkovky**. Tenhle modul je proto
 * jediné místo, kde se počítají výplaty.
 *
 * Vše čisté funkce nad `PredictionRow` + zavíracími kurzy z `oddsDataset` – 0 API volání.
 */

/** Na které ceně sázíme. Rozdíl mezi hladinami je přesně to, co přidá line-shopping. */
export type PriceLevel = "pinnacle" | "average" | "best";

/** Jedna odehraná sázka: co jsme vsadili, za jaký kurz a jak dopadla. */
export interface Bet {
  fixtureId: number;
  leagueId: number;
  /** Trh a strana – jen pro rozpad výsledků. */
  market: "home" | "draw" | "away" | "over25" | "under25";
  odds: number;
  /** Naše modelová pravděpodobnost (kvůli kontrole kalibrace vítězných sázek). */
  prob: number;
  won: boolean;
}

export interface PnlSummary {
  n: number;
  staked: number;
  profit: number;
  /** Zisk na vsazenou jednotku. 0.02 = +2 %. */
  roi: number;
  /** Nejhorší propad od dosavadního maxima (v jednotkách sázky). */
  maxDrawdown: number;
  /** 95% interval spolehlivosti ROI (bootstrap). Bez něj je ROI u pár set sázek šum. */
  roiLow: number;
  roiHigh: number;
  /** Průměrný kurz vsazených tipů – kontext k tomu, jak variabilní ROI je. */
  avgOdds: number;
}

/** Vyplacený kurz pro danou stranu z jednoho záznamu kurzů. */
function priceOf(
  odds: MatchOddsRecord | undefined,
  level: PriceLevel,
  market: Bet["market"]
): number | null {
  if (!odds) return null;
  if (market === "over25" || market === "under25") {
    const p = odds.ou25?.[level];
    if (!p) return null;
    return market === "over25" ? p.over : p.under;
  }
  const t: OddsTriple | undefined = odds[level];
  if (!t) return null;
  return t[market];
}

/** Skutečný výsledek zápasu z uloženého řádku. */
function outcomeOf(r: PredictionRow): {
  home: boolean;
  draw: boolean;
  away: boolean;
  over25: boolean;
  under25: boolean;
} | null {
  if (r.homeGoals == null || r.awayGoals == null) return null;
  const total = r.homeGoals + r.awayGoals;
  return {
    home: r.homeGoals > r.awayGoals,
    draw: r.homeGoals === r.awayGoals,
    away: r.homeGoals < r.awayGoals,
    over25: total > 2.5,
    under25: total < 2.5,
  };
}

/** Modelová pravděpodobnost dané strany. */
function probOf(r: PredictionRow, market: Bet["market"]): number | null {
  if (market === "home") return r.homeWin;
  if (market === "draw") return r.draw;
  if (market === "away") return r.awayWin;
  if (market === "over25") return r.over25;
  return r.over25 == null ? null : 1 - r.over25;
}

/**
 * Férová (odmaržovaná) pravděpodobnost trhu pro danou stranu. **Tohle je ta hodnota, se
 * kterou má smysl model porovnávat** – syrové `1/kurz` v sobě nese marži, takže „hrana"
 * proti němu je o velikost marže nafouknutá.
 */
export function fairProbOf(
  odds: MatchOddsRecord | undefined,
  level: PriceLevel,
  market: Bet["market"]
): number | null {
  if (!odds) return null;
  if (market === "over25" || market === "under25") {
    const p = odds.ou25?.[level];
    if (!p) return null;
    const sum = 1 / p.over + 1 / p.under;
    return market === "over25" ? 1 / p.over / sum : 1 / p.under / sum;
  }
  const t = odds[level];
  if (!t) return null;
  const fair = devig(t.home, t.draw, t.away);
  return fair ? fair[market] : null;
}

export interface FlatBetOptions {
  /** Na jakou cenu se sází. */
  level: PriceLevel;
  /**
   * Minimální kritérium pro vsazení. Podle `criterion`:
   *  - `"ev"` (default): očekávaný zisk na jednotku, `p_model × kurz − 1`. **Tohle je
   *    otázka „vydělá ta sázka?"** – marže je v něm už zahrnutá, protože se počítá proti
   *    kurzu, který sázkovka skutečně vyplácí.
   *  - `"disagreement"`: o kolik se lišíme od **férové** (odmaržované) ceny,
   *    `p_model − p_fair`. Tohle je otázka „myslíme si něco jiného než trh?" – je to
   *    volnější podmínka než EV (férová cena je nižší než 1/kurz o marži).
   */
  minEdge: number;
  criterion?: "ev" | "disagreement";
  /** Které trhy zvažovat. Remíza je defaultně mimo (model na ni nikdy netipuje). */
  markets?: Bet["market"][];
}

const DEFAULT_MARKETS: Bet["market"][] = ["home", "away", "over25", "under25"];

/**
 * Vybere sázky ploché strategie a rovnou je vyhodnotí. Jedna jednotka na sázku (flat) –
 * Kelly ani progresi vědomě neřešíme, dokud není prokázaná kladná hrana.
 */
export function flatBets(
  rows: PredictionRow[],
  oddsById: Map<number, MatchOddsRecord>,
  opts: FlatBetOptions
): Bet[] {
  const markets = opts.markets ?? DEFAULT_MARKETS;
  const criterion = opts.criterion ?? "ev";
  const bets: Bet[] = [];
  for (const r of rows) {
    if (!r.available) continue;
    const outcome = outcomeOf(r);
    if (!outcome) continue;
    const odds = oddsById.get(r.fixtureId);
    if (!odds) continue;
    for (const market of markets) {
      const prob = probOf(r, market);
      const price = priceOf(odds, opts.level, market);
      const fair = fairProbOf(odds, opts.level, market);
      if (prob == null || price == null) continue;
      if (criterion === "disagreement" && fair == null) continue;
      const score = criterion === "ev" ? prob * price - 1 : prob - fair!;
      if (score < opts.minEdge) continue;
      bets.push({
        fixtureId: r.fixtureId,
        leagueId: r.leagueId,
        market,
        odds: price,
        prob,
        won: outcome[market],
      });
    }
  }
  return bets;
}

/** Deterministický generátor pro bootstrap (aby byl výsledek reprodukovatelný). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOTSTRAP_SAMPLES = 2000;

/**
 * Souhrn P&L včetně **95% intervalu spolehlivosti ROI** (bootstrap přes sázky).
 * Interval je tu podstatnější než samotné ROI: rozdělení výnosů je hodně šikmé
 * (většina sázek −1, občas +několik), takže pár set sázek dá ROI ±10 % jen šumem.
 * Bez intervalu se dá „prokázat" zisk i tam, kde není.
 */
export function summarizePnl(bets: Bet[]): PnlSummary {
  const n = bets.length;
  if (n === 0) {
    return {
      n: 0,
      staked: 0,
      profit: 0,
      roi: 0,
      maxDrawdown: 0,
      roiLow: 0,
      roiHigh: 0,
      avgOdds: 0,
    };
  }
  const returns = bets.map((b) => (b.won ? b.odds - 1 : -1));
  const profit = returns.reduce((s, x) => s + x, 0);

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const x of returns) {
    equity += x;
    if (equity > peak) peak = equity;
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const rng = mulberry32(n * 7919 + 13);
  const rois: number[] = [];
  for (let s = 0; s < BOOTSTRAP_SAMPLES; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += returns[(rng() * n) | 0];
    rois.push(sum / n);
  }
  rois.sort((a, b) => a - b);

  return {
    n,
    staked: n,
    profit,
    roi: profit / n,
    maxDrawdown,
    roiLow: rois[Math.floor(0.025 * BOOTSTRAP_SAMPLES)],
    roiHigh: rois[Math.floor(0.975 * BOOTSTRAP_SAMPLES)],
    avgOdds: bets.reduce((s, b) => s + b.odds, 0) / n,
  };
}
