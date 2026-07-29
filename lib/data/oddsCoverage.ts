import type { BookOdds } from "./apiFootball";

/**
 * **Detekce toho, že se z `/odds` nechytá nějaký trh vůbec.**
 *
 * Parsování rohů, karet a týmových totalů vzniklo v MEZISEZÓNĚ, kdy `/odds` nevrací nic.
 * Hledá trhy podle **názvu** (`/corner/i`, …), a když se název v živém API liší, `bookOddsOf`
 * prostě to pole vynechá – `...(corners.length ? { corners } : {})`. Sběr pak celý podzim
 * mlčky ukládá kurzy bez rohů a zjistí se to až v listopadu, kdy má padnout verdikt z CLV.
 *
 * Jednotlivá kniha bez trhu je **normální** (ne každá sázkovka kótuje karty). Co normální
 * není, je **nula napříč všemi knihami a všemi zápasy běhu**. Tenhle rozdíl jde poznat jen
 * v agregátu, proto se počítá tady a ne v matcherech.
 *
 * Čistá funkce nad už staženými daty → **0 volání API navíc**.
 */

/** Trhy, jejichž pokrytí sledujeme. Klíče odpovídají polím `BookOdds`. */
export type CoveredMarket =
  | "main"
  | "over25"
  | "btts"
  | "corners"
  | "cards"
  | "totalHome"
  | "totalAway";

export type MarketCoverage = Record<CoveredMarket, number>;

export function emptyCoverage(): MarketCoverage {
  return {
    main: 0,
    over25: 0,
    btts: 0,
    corners: 0,
    cards: 0,
    totalHome: 0,
    totalAway: 0,
  };
}

/**
 * Připočte JEDEN zápas: trh se počítá jednou, má-li ho **aspoň jedna** kniha.
 * (Ne kolik knih ho má – nás zajímá „šlo to vůbec vytáhnout", ne šířka nabídky.)
 */
export function addFixtureCoverage(
  into: MarketCoverage,
  books: BookOdds[]
): MarketCoverage {
  const any = (fn: (b: BookOdds) => boolean) => books.some(fn);
  if (any((b) => b.home !== null && b.draw !== null && b.away !== null)) into.main++;
  if (any((b) => b.over25 !== null)) into.over25++;
  if (any((b) => b.btts !== null)) into.btts++;
  if (any((b) => (b.corners?.length ?? 0) > 0)) into.corners++;
  if (any((b) => (b.cards?.length ?? 0) > 0)) into.cards++;
  if (any((b) => (b.totalHome?.length ?? 0) > 0)) into.totalHome++;
  if (any((b) => (b.totalAway?.length ?? 0) > 0)) into.totalAway++;
  return into;
}

/**
 * Kolik zápasů s knihami musí běh vidět, než má smysl mlčení interpretovat.
 *
 * Dvě různá čísla schválně: **1X2 nabízí každá kniha**, takže pět zápasů bez něj je
 * jistě chyba parsování. Rohy/karty/týmové totaly nabízí jen část knih a daleko před
 * výkopem někdy nikdo – tam se musí počkat na větší vzorek, jinak by hlášení křičelo
 * každé ráno v úterý.
 */
const MIN_SAMPLE_MAIN = 5;
const MIN_SAMPLE_SECONDARY = 15;

/**
 * Trhy, které v tomhle běhu vypadají na rozbité parsování (nula napříč vzorkem).
 * Prázdné pole = buď je vše v pořádku, nebo je vzorek zatím malý.
 *
 * Vrací **podezření, ne verdikt** – i legitimní důvod existuje (mezisezóna, liga bez
 * kotace). Proto to nezhasíná cron; jen to musí být vidět.
 */
export function coverageWarnings(
  coverage: MarketCoverage,
  /** Kolik zápasů běhu vrátilo aspoň jednu knihu. */
  withBooks: number
): CoveredMarket[] {
  const out: CoveredMarket[] = [];
  if (withBooks >= MIN_SAMPLE_MAIN && coverage.main === 0) out.push("main");
  if (withBooks < MIN_SAMPLE_SECONDARY) return out;
  for (const m of ["over25", "btts", "corners", "cards", "totalHome", "totalAway"] as const) {
    if (coverage[m] === 0) out.push(m);
  }
  return out;
}
