import type { PickMarket, PredictionRow } from "@/lib/types";
import { devig } from "./market";
import { bestPrice, parseBooks, type BestPrice, type BookSide } from "./books";

/**
 * Rozdíl naší modelové pravděpodobnosti proti trhu. Čisté funkce nad uloženými
 * hodnotami – žádná data ani síť. Sdílí je výběr tipů (`evaluateRule`) i UI.
 *
 * **Dvě různá čísla, odpovídají na dvě různé otázky – nezaměňovat:**
 *  - `edge = p × kurz − 1` = **„vydělá ta sázka?"** Očekávaný zisk na jednotku proti kurzu,
 *    který sázkovka skutečně vyplácí. Marže je v něm už zahrnutá (je zabalená v ceně),
 *    takže `edge > 0` je správné kritérium pro sázení.
 *  - `edgeFair = p − p_trh` = **„myslíme si něco jiného než trh?"** Rozdíl proti
 *    **odmaržované** ceně. Pozor: `p_trh` je o marži NIŽŠÍ než `1/kurz`, takže tahle
 *    podmínka je **volnější** než EV – kladná neshoda ještě neznamená ziskovou sázku.
 * Pro analýzu „kde se lišíme od trhu" se řadí podle `edgeFair`; kdo chce vydělat, kouká
 * na `edge`. (Backtest 26. 7. 2026: model trh neporazí, takže ani jedno není příslib
 * zisku – viz sekce o měřítkách v CLAUDE.md.)
 */

/** EV jedné nabídky: hrana nad trhem + implikovaná pravděpodobnost sázkovky. */
export interface ValueEstimate {
  /** Naše modelová pravděpodobnost (0–1). */
  prob: number;
  /** Decimal kurz sázkovky (> 1). */
  odds: number;
  /** Implikovaná pravděpodobnost sázkovky = 1/kurz (s marží – nesčítá se na 1). */
  impliedProb: number;
  /** Očekávaná hodnota na 1 jednotku sázky = prob × kurz − 1 (> 0 = value). */
  edge: number;
  /**
   * Odmaržovaná pravděpodobnost trhu. `null`, když protistrany trhu neznáme
   * (u 1X2 potřebujeme všechny tři kurzy, u Over/BTTS obě strany).
   */
  fairProb: number | null;
  /** Rozdíl proti férové ceně (`prob − fairProb`). `null`, když nelze odmaržovat. */
  edgeFair: number | null;
  /**
   * **Nejlepší cena napříč všemi sázkovkami** (`oddsBooks`) – tedy cena, kterou bys
   * reálně dostal, kdyby sis vybral knihu. Line-shopping je jediná páka, která
   * v backtestu prokazatelně zabrala (ROI −7.7 % → −5.2 %).
   *
   * `edge` výše zůstává schválně počítaný z **referenčního** kurzu: je to jeden stabilní
   * zdroj napříč historií, takže se čísla dají porovnávat v čase. Nejlepší cena je
   * navíc, ne místo něj — jinak by se hrana samovolně nafoukla jen tím, že přibyla kniha.
   *
   * `null` u řádků bez `oddsBooks` (vše do 27. 7. 2026, backtest, mock).
   */
  best: {
    odds: number;
    bookmaker: string;
    /** Kolik knih tu stranu kotovalo (1–2 = ber s rezervou). */
    books: number;
    /** EV proti nejlepší ceně (`prob × odds − 1`) – vyšší než `edge` o line-shopping. */
    edge: number;
  } | null;
}

/** Implikovaná pravděpodobnost z desetinného kurzu. */
export function impliedProb(odds: number): number {
  return 1 / odds;
}

/** Edge (EV na jednotku) = p × kurz − 1. Kladný = sázka má kladnou očekávanou hodnotu. */
export function edge(prob: number, odds: number): number {
  return prob * odds - 1;
}

/**
 * Odmaržovaná pravděpodobnost dvoustranného trhu (Over/Under, BTTS ano/ne).
 * `null`, když protistranu neznáme – bez ní marži oddělit nejde.
 */
function fairTwoWay(odds: number, opposite: number | null | undefined): number | null {
  if (opposite == null || !Number.isFinite(opposite) || opposite <= 1) return null;
  const sum = 1 / odds + 1 / opposite;
  return sum > 0 ? 1 / odds / sum : null;
}

/**
 * Hodnotový odhad z pravděpodobnosti a kurzu. `null`, když kurz chybí nebo je nesmyslný
 * (≤ 1) či pravděpodobnost není kladná → value nelze posoudit.
 * `fairProb` je volitelná – bez znalosti protistrany zůstane `null` (a s ní i `edgeFair`).
 */
export function valueOf(
  prob: number,
  odds: number | null | undefined,
  fairProb: number | null = null,
  best: BestPrice | null = null
): ValueEstimate | null {
  if (odds == null || !Number.isFinite(odds) || odds <= 1) return null;
  if (!Number.isFinite(prob) || prob <= 0) return null;
  return {
    prob,
    odds,
    impliedProb: impliedProb(odds),
    edge: edge(prob, odds),
    fairProb,
    edgeFair: fairProb == null ? null : prob - fairProb,
    best: best ? { ...best, edge: edge(prob, best.odds) } : null,
  };
}

/**
 * Hodnotový odhad pro daný trh/stranu z uloženého predikčního řádku (spáruje naši
 * pravděpodobnost se správným kurzem). `side` je relevantní jen pro market "win".
 *
 * Férová cena se dopočítá, když má řádek celý trh: u 1X2 všechny tři kurzy, u Over/BTTS
 * i protistranu (`oddsUnder25`/`oddsBttsNo` – ty se ukládají teprve od 26. 7. 2026, takže
 * starší řádky mají `fairProb: null` a hodnotí se jen podle `minProb`).
 */
export function rowValue(
  row: PredictionRow,
  market: PickMarket,
  side: "home" | "away" | null
): ValueEstimate | null {
  // Nejlepší cena napříč knihami z uloženého JSON snímku (0 volání API; prázdné
  // u starších řádků → `null` a chování jako dřív).
  const books = parseBooks(row.oddsBooks);
  const best = (s: BookSide) => (books.length ? bestPrice(books, s) : null);

  if (market === "over25") {
    return valueOf(
      row.over25,
      row.oddsOver25,
      row.oddsOver25 != null ? fairTwoWay(row.oddsOver25, row.oddsUnder25) : null,
      best("over25")
    );
  }
  if (market === "btts") {
    return valueOf(
      row.bttsYes,
      row.oddsBtts,
      row.oddsBtts != null ? fairTwoWay(row.oddsBtts, row.oddsBttsNo) : null,
      best("btts")
    );
  }
  // market === "win"
  const fair =
    row.oddsHome != null && row.oddsDraw != null && row.oddsAway != null
      ? devig(row.oddsHome, row.oddsDraw, row.oddsAway)
      : null;
  if (side === "home")
    return valueOf(row.homeWin, row.oddsHome, fair?.home ?? null, best("home"));
  if (side === "away")
    return valueOf(row.awayWin, row.oddsAway, fair?.away ?? null, best("away"));
  return null;
}
