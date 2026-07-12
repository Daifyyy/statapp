import type { PredictionRow } from "@/lib/types";
import { isNationalTournamentLeague } from "@/lib/data/catalog";
import {
  ourProbs,
  scoreProbs,
  type ModelScore,
  type ProbPick,
  type ProbTriple,
} from "./trackRecord";

/**
 * Benchmark proti **trhu** (kurzy sázkovky) – jediné měřítko, na kterém u predikčního
 * modelu doopravdy záleží. Zavírací kurz je konsenzus všech, kdo mají v zápase peníze;
 * kdo ho nepřekonává, nemá kladnou hodnotu ani ve value tipech (`lib/picks/value.ts`) –
 * „kladná hrana" je pak spíš chyba modelu než díra na trhu.
 *
 * Rozsah: **jen 1X2 a jen klubové zápasy.** Over 2.5 / BTTS neumíme odmaržovat (ukládáme
 * jen kurz na „ano", protistrana chybí), reprezentace nemají kurzy ani benchmark (pipeline
 * je tahá jen pro klubové ligy) a jejich forma je navíc nesrovnatelná napříč konfederacemi.
 * Čisté funkce nad uloženými řádky – 0 API volání.
 */

/** Součet implikovaných pravděpodobností (1/kurz). > 1 = marže sázkovky (overround). */
export function overround(home: number, draw: number, away: number): number {
  return 1 / home + 1 / draw + 1 / away;
}

/**
 * Odmaržování kurzů (de-vig) **proporcionální metodou**: implikované pravděpodobnosti
 * se podělí overroundem, takže dají součet 1.
 *
 * Vědomé zjednodušení: proporcionální de-vig rozpouští marži rovnoměrně, ale reálně bývá
 * vyšší na outsiderech (favorite–longshot bias) → outsiderům lehce nadhodnotí šance.
 * Přesnější jsou Shinova / power metoda; na měření „překonáváme trh?" je proporcionální
 * de-vig dost dobrý a nemá volné parametry. Vrací null u nesmyslných kurzů (≤ 1).
 */
export function devig(
  home: number,
  draw: number,
  away: number
): ProbTriple | null {
  if (home <= 1 || draw <= 1 || away <= 1) return null;
  const sum = overround(home, draw, away);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return {
    home: 1 / home / sum,
    draw: 1 / draw / sum,
    away: 1 / away / sum,
  };
}

/** 1X2 pravděpodobnosti trhu z uložených kurzů řádku (null = kurzy nemáme). */
export const marketProbs: ProbPick = (r) =>
  r.oddsHome != null && r.oddsDraw != null && r.oddsAway != null
    ? devig(r.oddsHome, r.oddsDraw, r.oddsAway)
    : null;

/** Je řádek klubový? (Reprezentace do měření proti trhu nepatří – viz komentář nahoře.) */
export function isClubRow(r: PredictionRow): boolean {
  return !isNationalTournamentLeague(r.leagueId);
}

export interface MarketBenchmark {
  /** Velikost společné podmnožiny: klubový, odehraný, s naší predikcí i s kurzy. */
  n: number;
  our: ModelScore | null;
  market: ModelScore | null;
  /** Průměrná marže sázkovky na podmnožině (1.05 = 5 %) – kontext k rozdílu skóre. */
  avgOverround: number | null;
}

/**
 * Side-by-side: náš model vs. odmaržované kurzy na **stejné** podmnožině zápasů.
 * Verdikt čti podle **log-loss** (Brier i přesnost jsou hrubší); rozdíl menší než
 * marže sázkovky znamená „trh je pořád lepší, jen o kus dražší".
 */
export function computeMarketBenchmark(rows: PredictionRow[]): MarketBenchmark {
  const both = rows.filter(
    (r) =>
      isClubRow(r) &&
      r.homeGoals != null &&
      r.awayGoals != null &&
      ourProbs(r) != null &&
      marketProbs(r) != null
  );
  if (both.length === 0) return { n: 0, our: null, market: null, avgOverround: null };

  const sum = both.reduce(
    (acc, r) => acc + overround(r.oddsHome!, r.oddsDraw!, r.oddsAway!),
    0
  );
  return {
    n: both.length,
    our: scoreProbs(both, ourProbs),
    market: scoreProbs(both, marketProbs),
    avgOverround: sum / both.length,
  };
}
