import type { BookOdds, LineOdds } from "@/lib/data/apiFootball";
import { devig } from "./market";

/**
 * Práce s **kurzy všech sázkovek** jednoho zápasu (sloupce `oddsBooks`/`oddsCloseBooks`).
 *
 * Proč to vůbec je: jedna odpověď `/odds` nese ~13 knih a dřív se z nich ukládala jediná
 * „preferovaná". Přitom **nejlepší cena napříč knihami byla jediná páka, která
 * v backtestu prokazatelně zabrala** – ROI ploché sázky −7.7 % (sharp linie) → **−5.2 %**
 * (nejlepší cena), a overround nejlepší ceny je **0.11 %** proti 2.99 % u jedné knihy.
 * Ze ztráty to zisk neudělá, ale je to nejlevnější zlepšení, jaké máme: **0 volání API**,
 * jen se nezahazuje to, co už dorazilo.
 *
 * Dvě různé věci, které z knih čteme (a nesmí se plést):
 *  - **`bestPrice`** = nejvyšší kurz = cena, kterou reálně dostaneš. Používá se na
 *    rozhodnutí „kam sázet" a do výnosu.
 *  - **`sharpFair`** = odmaržovaný konsenzus = nejlepší odhad pravděpodobnosti. Používá
 *    se jako **měřítko** (benchmark, CLV). Nejlepší cena je k tomuhle účelu vychýlená –
 *    je to maximum přes knihy, takže systematicky nadhodnocuje pravděpodobnost strany.
 *
 * Modul je čistý; JSON z DB do něj pouští `parseBooks`.
 */

/** Strana, pro kterou se cena hledá. */
export type BookSide = "home" | "draw" | "away" | "over25" | "under25" | "btts" | "bttsNo";

/** Nejlepší (nejvyšší) kurz strany napříč knihami + kdo ho nabízí. */
export interface BestPrice {
  odds: number;
  bookmaker: string;
  /** Kolik knih tu stranu vůbec kotovalo (malé číslo = ber s rezervou). */
  books: number;
}

/**
 * JSON z DB na typované knihy. Sloupec je `Json?`, takže sem může přijít cokoli –
 * proto se validuje tvar, ne jen typ. Neplatný/prázdný vstup → `[]` (volající pak
 * spadne zpět na referenční kurz, což je dosavadní chování).
 */
export function parseBooks(value: unknown): BookOdds[] {
  if (!Array.isArray(value)) return [];
  const out: BookOdds[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const b = raw as Record<string, unknown>;
    if (typeof b.name !== "string") continue;
    const num = (k: string) => (typeof b[k] === "number" && b[k] > 1 ? (b[k] as number) : null);
    const corners = parseLines(b.corners);
    const totalHome = parseLines(b.totalHome);
    const totalAway = parseLines(b.totalAway);
    out.push({
      id: typeof b.id === "number" ? b.id : 0,
      name: b.name,
      home: num("home"),
      draw: num("draw"),
      away: num("away"),
      over25: num("over25"),
      under25: num("under25"),
      btts: num("btts"),
      bttsNo: num("bttsNo"),
      ...(corners.length ? { corners } : {}),
      ...(totalHome.length ? { totalHome } : {}),
      ...(totalAway.length ? { totalAway } : {}),
    });
  }
  return out;
}

/** Linky trhu z JSON (stejná obranná logika jako `parseBooks`). */
function parseLines(value: unknown): LineOdds[] {
  if (!Array.isArray(value)) return [];
  const out: LineOdds[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.line !== "number" || !Number.isFinite(c.line)) continue;
    const num = (k: string) => (typeof c[k] === "number" && c[k] > 1 ? (c[k] as number) : null);
    out.push({ line: c.line, over: num("over"), under: num("under") });
  }
  return out;
}

/**
 * Nejlepší dostupná cena strany. `null`, když ji nekotuje ani jedna kniha.
 *
 * Tohle je ta „páka": rozdíl mezi průměrem trhu a maximem je u 1X2 typicky 2–5 %
 * výplaty, a protože se marže počítá z ceny, kterou dostaneš, jde ten rozdíl celý
 * do výnosu.
 */
export function bestPrice(books: BookOdds[], side: BookSide): BestPrice | null {
  let best: BestPrice | null = null;
  let count = 0;
  for (const b of books) {
    const o = b[side];
    if (o == null) continue;
    count++;
    if (!best || o > best.odds) best = { odds: o, bookmaker: b.name, books: 0 };
  }
  return best ? { ...best, books: count } : null;
}

/**
 * Overround (marže) jedné knihy na 1X2 = `Σ 1/kurz − 1`. `null`, když kniha nekotuje
 * všechny tři strany. Slouží k poznání, která kniha je sharp (Pinnacle ~2–3 %) a která
 * ne (10 %+) – a k doložení, jak moc nejlepší cena marži smaže.
 */
export function overroundOf(book: BookOdds): number | null {
  if (book.home == null || book.draw == null || book.away == null) return null;
  return 1 / book.home + 1 / book.draw + 1 / book.away - 1;
}

/**
 * Overround **syntetické knihy z nejlepších cen**. Bývá kolem nuly (změřeno 0.11 %)
 * a občas i záporný = arbitráž. Je to nejostřejší dostupná cena, ale POZOR: skládá se
 * z různých knih, takže jako odhad pravděpodobnosti je vychýlená (viz `sharpFair`).
 */
export function bestOverround(books: BookOdds[]): number | null {
  const h = bestPrice(books, "home");
  const d = bestPrice(books, "draw");
  const a = bestPrice(books, "away");
  if (!h || !d || !a) return null;
  return 1 / h.odds + 1 / d.odds + 1 / a.odds - 1;
}

/**
 * **Sharp konsenzus**: odmaržované 1X2 pravděpodobnosti z knihy s nejnižší marží.
 *
 * Proč nejnižší marže a ne průměr: nízká marže je nejlepší veřejný indikátor toho, že
 * kniha svým číslům věří a nechává se opravovat penězi (Pinnacle). Průměr přes knihy
 * míchá ostré ceny s líným kopírováním a marží 10 %.
 *
 * Používej to jako **měřítko** (CLV, benchmark), ne jako cenu k sázení. `null`, když
 * žádná kniha nekotuje celé 1X2.
 */
export function sharpFair(
  books: BookOdds[]
): { home: number; draw: number; away: number; bookmaker: string; overround: number } | null {
  let best: { book: BookOdds; over: number } | null = null;
  for (const b of books) {
    const over = overroundOf(b);
    if (over == null) continue;
    if (!best || over < best.over) best = { book: b, over };
  }
  if (!best) return null;
  // `overroundOf` vrátilo číslo → všechny tři strany jsou vyplněné.
  const fair = devig(best.book.home!, best.book.draw!, best.book.away!);
  if (!fair) return null;
  return { ...fair, bookmaker: best.book.name, overround: best.over };
}

// ── TRHY S LINKAMI (rohy, týmové totaly) ────────────────────────────────────────
// Tyhle trhy mají oproti 1X2 jednu komplikaci navíc: **každá kniha může nabízet jinou
// linii** (rohy 9.5 / 10.5 / 11.5, týmový total 0.5 / 1.5 / 2.5). Kurz na 10.5 a kurz
// na 11.5 jsou dvě různé sázky, takže „nejlepší cena" se smí hledat jen UVNITŘ jedné
// linie. Kdyby se porovnaly napříč linkami, vypadalo by to jako obrovská hrana a byl by
// to jen artefakt – přesně ta chyba, kterou na těchhle trzích uděláš nejsnáz.
//
// Rohy a týmové totaly sdílejí VŠECHNU logiku, liší se jen tím, ze kterého pole
// `BookOdds` čtou → jeden parametr `market`, ne dvě sady funkcí.

/** Trh s linkami. `totalHome`/`totalAway` = kolik gólů dá jeden tým. */
export type LineMarket = "corners" | "totalHome" | "totalAway";

const linesOf = (b: BookOdds, market: LineMarket): LineOdds[] => b[market] ?? [];

/** Které linie jsou v nabídce a kolik knih je kotuje (sestupně dle pokrytí). */
export function marketLines(
  books: BookOdds[],
  market: LineMarket
): { line: number; books: number }[] {
  const count = new Map<number, number>();
  for (const b of books) {
    for (const c of linesOf(b, market)) {
      if (c.over == null && c.under == null) continue;
      count.set(c.line, (count.get(c.line) ?? 0) + 1);
    }
  }
  return [...count.entries()]
    .map(([line, n]) => ({ line, books: n }))
    .sort((a, b) => b.books - a.books || a.line - b.line);
}

/** Nejčastěji kotovaná linie = ta, kterou má smysl vyhodnocovat. `null` bez dat. */
export function mainLine(books: BookOdds[], market: LineMarket): number | null {
  return marketLines(books, market)[0]?.line ?? null;
}

/**
 * Nejlepší cena **na konkrétní lince**. Linie je povinný parametr schválně – nejde ji
 * uhodnout a míchat linky by dalo nesmysl (viz komentář výše).
 */
export function bestLinePrice(
  books: BookOdds[],
  market: LineMarket,
  line: number,
  side: "over" | "under"
): BestPrice | null {
  let best: BestPrice | null = null;
  let count = 0;
  for (const b of books) {
    const o = linesOf(b, market).find((x) => x.line === line)?.[side];
    if (o == null) continue;
    count++;
    if (!best || o > best.odds) best = { odds: o, bookmaker: b.name, books: 0 };
  }
  return best ? { ...best, books: count } : null;
}

/**
 * Sharp férová pravděpodobnost na dané lince (kniha s nejnižší marží, obě strany).
 * Měřítko pro CLV a pro porovnání s modelem, **ne cena k sázení** (na to `bestLinePrice`).
 */
export function sharpLineFair(
  books: BookOdds[],
  market: LineMarket,
  line: number
): { over: number; under: number; bookmaker: string; overround: number } | null {
  let best: { book: BookOdds; c: LineOdds; over: number } | null = null;
  for (const b of books) {
    const c = linesOf(b, market).find((x) => x.line === line);
    if (!c || c.over == null || c.under == null) continue;
    const over = 1 / c.over + 1 / c.under - 1;
    if (!best || over < best.over) best = { book: b, c, over };
  }
  if (!best) return null;
  const sum = 1 / best.c.over! + 1 / best.c.under!;
  return {
    over: 1 / best.c.over! / sum,
    under: 1 / best.c.under! / sum,
    bookmaker: best.book.name,
    overround: best.over,
  };
}

// Pojmenované zkratky pro rohy (čitelnost na volajících místech; žádná vlastní logika).
export const cornerLines = (books: BookOdds[]) => marketLines(books, "corners");
export const mainCornerLine = (books: BookOdds[]) => mainLine(books, "corners");
export const bestCornerPrice = (books: BookOdds[], line: number, side: "over" | "under") =>
  bestLinePrice(books, "corners", line, side);
export const sharpCornerFair = (books: BookOdds[], line: number) =>
  sharpLineFair(books, "corners", line);

/**
 * Sharp férová pravděpodobnost **totalu 2.5** (obě strany → jde odmaržovat). Stejná
 * úvaha jako `sharpFair`, jen nad dvoustranným trhem. `null`, když žádná kniha nemá obě.
 */
export function sharpFairTotal(
  books: BookOdds[]
): { over25: number; under25: number; bookmaker: string; overround: number } | null {
  let best: { book: BookOdds; over: number } | null = null;
  for (const b of books) {
    if (b.over25 == null || b.under25 == null) continue;
    const over = 1 / b.over25 + 1 / b.under25 - 1;
    if (!best || over < best.over) best = { book: b, over };
  }
  if (!best) return null;
  const sum = 1 / best.book.over25! + 1 / best.book.under25!;
  return {
    over25: 1 / best.book.over25! / sum,
    under25: 1 / best.book.under25! / sum,
    bookmaker: best.book.name,
    overround: best.over,
  };
}
