import type { PickMarket, PredictionRow } from "@/lib/types";
import { devig } from "./market";
import { mainCornerLine, parseBooks, sharpCornerFair, sharpFair, sharpFairTotal } from "./books";

/**
 * CLV (closing line value) = o kolik se linie pohnula od našeho snímku k zavření.
 *
 * Proč to chceme měřit: výsledek jednoho zápasu o kvalitě tipu neřekne skoro nic (fotbal
 * je z valné části náhoda), takže na verdikt „má tip hranu?" jsou potřeba stovky sázek.
 * Zavírací linie je naopak nejlepší veřejně dostupný odhad pravděpodobnosti – když se
 * po našem tipu **posune směrem k nám**, je to důkaz hrany viditelný **hned**, ne za
 * půl sezóny. Kladné CLV je nutná podmínka dlouhodobě ziskového sázení; kdo ho nemá,
 * ale vydělává, má zatím jen štěstí.
 *
 * Počítá se z **odmaržovaných** pravděpodobností obou snímků – jinak by se do CLV
 * promítly změny marže sázkovky místo změn názoru trhu.
 *
 * Čisté funkce nad uloženým řádkem, 0 API volání.
 */

/** Strana, které se CLV týká. Remíza se netipuje, takže tu není. */
export type ClvSide =
  | "home"
  | "away"
  | "over25"
  | "under25"
  | "cornersOver"
  | "cornersUnder";

/** Trh + strana pravidla → strana pro CLV (`null` = trh, kde CLV nesledujeme). */
export function clvSideOf(
  market: PickMarket,
  side: "home" | "away" | null
): ClvSide | null {
  if (market === "over25") return "over25";
  if (market === "btts") return null; // zavírací linii BTTS neukládáme (model tam nemá signál)
  return side;
}

/**
 * Odmaržovaná pravděpodobnost strany ze **sharp konsenzu** (kniha s nejnižší marží
 * napříč všemi uloženými sázkovkami), nebo `null`, když knihy nemáme.
 *
 * Proč to je lepší než referenční sloupce: ty nesou **jednu vybranou knihu**
 * (`PREFERRED_BOOKMAKERS`, typicky Bet365 s marží 5–7 %). CLV z ní měří „jak se pohnul
 * Bet365", což je zašuměnější a pomalejší než sharp linie. Pohyb sharp knihy je ta
 * informace, o kterou u CLV jde.
 *
 * **Rohy jdou JEN touhle cestou** – pro ně žádné referenční sloupce neexistují,
 * kurzy žijí výhradně v JSON snímku, a to včetně toho, na jaké lince jsou.
 */
function sharpProbOf(booksJson: unknown, side: ClvSide, cornerLine: number | null): number | null {
  const books = parseBooks(booksJson);
  if (books.length === 0) return null;
  if (side === "cornersOver" || side === "cornersUnder") {
    if (cornerLine == null) return null;
    const f = sharpCornerFair(books, cornerLine);
    if (!f) return null;
    return side === "cornersOver" ? f.over : f.under;
  }
  if (side === "over25" || side === "under25") {
    const f = sharpFairTotal(books);
    if (!f) return null;
    return side === "over25" ? f.over25 : f.under25;
  }
  const f = sharpFair(books);
  return f ? f[side] : null;
}

/** Odmaržovaná pravděpodobnost strany z jednoho snímku (`null` = snímek není úplný). */
function fairOf(
  side: ClvSide,
  odds: {
    home: number | null;
    draw: number | null;
    away: number | null;
    over25: number | null;
    under25: number | null;
  }
): number | null {
  if (side === "cornersOver" || side === "cornersUnder") return null; // jen ze sharp knih
  if (side === "over25" || side === "under25") {
    if (odds.over25 == null || odds.under25 == null) return null;
    if (odds.over25 <= 1 || odds.under25 <= 1) return null;
    const sum = 1 / odds.over25 + 1 / odds.under25;
    return side === "over25" ? 1 / odds.over25 / sum : 1 / odds.under25 / sum;
  }
  if (odds.home == null || odds.draw == null || odds.away == null) return null;
  const fair = devig(odds.home, odds.draw, odds.away);
  return fair ? fair[side] : null;
}

export interface ClvResult {
  /** Férová pravděpodobnost v okamžiku našeho snímku. */
  openProb: number;
  /** Férová pravděpodobnost při zavření. */
  closeProb: number;
  /**
   * Posun v procentních bodech. **Kladné = trh se pohnul k nám** (naše strana zlevnila,
   * tj. stala se pravděpodobnější), což je signál hrany.
   */
  clv: number;
  /** Odkud pravděpodobnosti pocházejí – sharp konsenzus je přesnější měřítko. */
  source: "sharp" | "reference";
  /** U rohů linie, na které se to počítalo (jinde `null`). */
  line: number | null;
}

/**
 * CLV jedné strany z uloženého řádku. `null`, když chybí kterýkoli ze snímků – tedy
 * i u všech řádků z doby před zavedením druhého snímku (26. 7. 2026).
 *
 * **Preferuje se sharp konsenzus** z uložených knih (`oddsBooks`/`oddsCloseBooks`);
 * teprve když knihy chybí (řádky do 27. 7. 2026), spadne se na referenční sloupce.
 * Obě strany snímku musí přijít ze **stejného zdroje** – míchat sharp „open" s
 * referenčním „close" by měřilo rozdíl mezi sázkovkami, ne pohyb trhu.
 */
export function rowClv(row: PredictionRow, side: ClvSide): ClvResult | null {
  // Rohy: linie se určí z OTEVÍRACÍHO snímku a stejná se pak hledá v zavíracím.
  // Kdyby se u každého snímku vzala „jeho" nejčastější linie, mohly by to být dvě
  // různé sázky a rozdíl by neměl význam.
  const line =
    side === "cornersOver" || side === "cornersUnder"
      ? mainCornerLine(parseBooks(row.oddsBooks))
      : null;

  const sharpOpen = sharpProbOf(row.oddsBooks, side, line);
  const sharpClose = sharpProbOf(row.oddsCloseBooks, side, line);
  if (sharpOpen != null && sharpClose != null) {
    return {
      openProb: sharpOpen,
      closeProb: sharpClose,
      clv: sharpClose - sharpOpen,
      source: "sharp",
      line,
    };
  }

  const openProb = fairOf(side, {
    home: row.oddsHome,
    draw: row.oddsDraw,
    away: row.oddsAway,
    over25: row.oddsOver25,
    under25: row.oddsUnder25,
  });
  const closeProb = fairOf(side, {
    home: row.oddsCloseHome,
    draw: row.oddsCloseDraw,
    away: row.oddsCloseAway,
    over25: row.oddsCloseOver25,
    under25: row.oddsCloseUnder25,
  });
  if (openProb == null || closeProb == null) return null;
  return {
    openProb,
    closeProb,
    clv: closeProb - openProb,
    source: "reference",
    line: null,
  };
}

export interface ClvSummary {
  /** Kolik tipů mělo oba snímky (jen z nich se dá CLV počítat). */
  n: number;
  /** Průměrné CLV v procentních bodech. */
  avgClv: number;
  /** Podíl tipů s kladným CLV (0–1). Náhodný výběr dá kolem 0.5. */
  beatRate: number;
  /**
   * Podíl tipů měřených proti **sharp konsenzu** (zbytek jede na referenční knize).
   * Diagnostika, ne cíl: nízké číslo znamená, že se koukáš hlavně na pohyb jedné
   * sázkovky, což je zašuměnější měřítko.
   */
  sharpShare: number;
}

/**
 * Souhrn CLV přes tipy. Verdikt: `avgClv > 0` **a** `beatRate` znatelně nad 0.5 znamená,
 * že tipy trh předbíhají. Samotné `avgClv` může vytáhnout pár extrémů, samotný `beatRate`
 * zase nerozliší velký a mikroskopický posun – proto obojí.
 */
export function summarizeClv(
  picks: { row: PredictionRow; side: ClvSide }[]
): ClvSummary {
  let sum = 0;
  let beat = 0;
  let n = 0;
  let sharp = 0;
  for (const p of picks) {
    const r = rowClv(p.row, p.side);
    if (!r) continue;
    n++;
    sum += r.clv;
    if (r.clv > 0) beat++;
    if (r.source === "sharp") sharp++;
  }
  return n === 0
    ? { n: 0, avgClv: 0, beatRate: 0, sharpShare: 0 }
    : { n, avgClv: sum / n, beatRate: beat / n, sharpShare: sharp / n };
}
