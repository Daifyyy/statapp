import type { BookOdds } from "@/lib/data/apiFootball";
import { bestPrice, overroundOf } from "./books";
import { devig } from "./market";

/**
 * **Časová řada kurzů** – jak se linie hýbala od otevření k výkopu.
 *
 * Proč vedle dvou snímků (otevírací + zavírací), které už máme: ty řeknou *kolik* se
 * linie hnula, ale ne *kdy*. A přitom „hnulo se to hned po otevření" a „hnulo se to
 * hodinu před výkopem" jsou dvě úplně jiné informace – to druhé je pohyb chytrých peněz
 * (steam), to první většinou jen dorovnání otevírací chyby.
 *
 * K čemu to je konkrétně:
 *  1. **Robustní CLV.** Náš zavírací snímek padne ~3 h před výkopem. Poslední bod řady je
 *     nejlepší dostupná aproximace skutečného zavření a nezávisí na tom, jestli cron
 *     stihl svoje okno.
 *  2. **Steam.** Prudký pohyb v posledních hodinách je signál sám o sobě – sledovat
 *     peníze je pro malého hráče historicky úspěšnější než předpovídat zápas.
 *  3. **Kontext k tipu.** „Náš kurz už není k mání, linie se mezitím posunula proti nám."
 *
 * ⚠ **UKLÁDÁ SE KOMPAKTNÍ BOD, NE CELÉ KNIHY** – a je to rozhodnutí o životaschopnosti,
 * ne o eleganci. Spočítáno: plný snímek 13 knih × všechny trhy (~5 kB) každou hodinu po
 * 72 h dá **2.8 GB/rok**, zatímco Neon free tier má **500 MB**. Kompaktní bod (~100 B)
 * se zužující se kadencí dá **12 MB/rok**. Plné knihy proto zůstávají jen u dvou snímků,
 * na kterých stojí EV a CLV (`oddsBooks`/`oddsCloseBooks`); řada je stopa pohybu.
 *
 * Ukládají se **syrové kurzy**, ne odmaržované pravděpodobnosti – aby šlo přepočítat
 * jinou de-vig metodou bez nového fetche (táž zásada jako u `oddsHome` & spol.).
 */

/** Jeden bod řady. Klíče jsou krátké schválně – jsou v JSON tisíckrát. */
export interface OddsSeriesPoint {
  /** Minut do výkopu v okamžiku snímku (kladné = před výkopem). */
  t: number;
  /** Kniha s nejnižší marží na 1X2 – jméno a její SYROVÉ kurzy. */
  b?: string;
  h?: number;
  d?: number;
  a?: number;
  /** Nejlepší cena napříč knihami (line shopping v čase). */
  xh?: number;
  xd?: number;
  xa?: number;
  /** Over/Under 2.5 z téže sharp knihy. */
  o?: number;
  u?: number;
  /** Kolik knih zápas v tu chvíli kotovalo (malé číslo = ber s rezervou). */
  n: number;
}

/**
 * Strop délky řady. Zužující se kadence dá ~16 bodů; 40 je pojistka proti tomu, aby
 * rozbitý cron (nebo ruční spouštění) nafoukl jeden řádek donekonečna.
 */
export const MAX_SERIES_POINTS = 40;

/**
 * **Kadence se zužuje směrem k výkopu**, protože tam je informace. Daleko od výkopu se
 * linie hýbe pomalu a hustý sběr by jen platil kvótou za šum; v posledních hodinách se
 * odehraje většina pohybu, který nás zajímá.
 *
 * Vrací minimální odstup mezi dvěma body v minutách.
 */
export function snapshotIntervalMinutes(hoursToKickoff: number): number {
  if (hoursToKickoff > 24) return 12 * 60;
  if (hoursToKickoff > 6) return 3 * 60;
  return 60;
}

/** Je čas na další bod řady? `lastAt = null` = ještě žádný bod není. */
export function seriesDue(
  hoursToKickoff: number,
  minutesSinceLast: number | null
): boolean {
  if (hoursToKickoff <= 0) return false; // po výkopu už jsou to živé kurzy, ne linie
  if (minutesSinceLast == null) return true;
  // Malá tolerance: cron je best-effort a běh o minutu dřív by jinak bod přeskočil
  // a čekal celý další interval.
  return minutesSinceLast >= snapshotIntervalMinutes(hoursToKickoff) - 5;
}

/** Co všechno má tenhle běh pro daný zápas udělat z JEDNOHO fetche. */
export interface SnapshotPlan {
  /** Sáhnout na API? (`false` = řádek se přeskočí bez volání) */
  fetch: boolean;
  /** Uložit jako **otevírací** snímek s plnými knihami. */
  open: boolean;
  /** Uložit jako **zavírací** snímek s plnými knihami. */
  close: boolean;
  /** Přidat bod do časové řady. */
  series: boolean;
}

export interface SnapshotState {
  kickoff: Date;
  oddsFetchedAt: Date | null;
  oddsCloseAt: Date | null;
  oddsSeriesAt: Date | null;
}

/**
 * Rozhodne, co se má pro zápas udělat – **jedním fetchem pro všechny tři účely**.
 *
 * Klíčová vlastnost: otevírací a zavírací snímek se chovají **přesně jako dřív**
 * (guard `oddsFetchedAt`/`oddsCloseAt` je drží na jednom za život), řada je navíc.
 * Když je potřeba jen řada, stejně se šáhne jen jednou – `/odds` vrací všechno naráz.
 */
export function snapshotPlan(
  state: SnapshotState,
  now: Date,
  closingHours: number
): SnapshotPlan {
  const hoursToKickoff = (state.kickoff.getTime() - now.getTime()) / 3_600_000;
  const none: SnapshotPlan = { fetch: false, open: false, close: false, series: false };
  if (hoursToKickoff <= 0) return none;

  const minutesSince = (d: Date | null) =>
    d == null ? null : (now.getTime() - d.getTime()) / 60_000;

  const open = state.oddsFetchedAt == null;
  const close = state.oddsCloseAt == null && hoursToKickoff <= closingHours;
  const series = seriesDue(hoursToKickoff, minutesSince(state.oddsSeriesAt));

  return { fetch: open || close || series, open, close, series };
}

/** Řada z JSON sloupce. Neplatný tvar → `[]` (stejná obranná logika jako `parseBooks`). */
export function parseSeries(value: unknown): OddsSeriesPoint[] {
  if (!Array.isArray(value)) return [];
  const out: OddsSeriesPoint[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.t !== "number" || !Number.isFinite(p.t)) continue;
    const num = (k: string) =>
      typeof p[k] === "number" && (p[k] as number) > 1 ? (p[k] as number) : undefined;
    out.push({
      t: p.t,
      ...(typeof p.b === "string" ? { b: p.b } : {}),
      h: num("h"),
      d: num("d"),
      a: num("a"),
      xh: num("xh"),
      xd: num("xd"),
      xa: num("xa"),
      o: num("o"),
      u: num("u"),
      n: typeof p.n === "number" ? p.n : 0,
    });
  }
  return out.sort((x, y) => y.t - x.t); // nejstarší (nejdál od výkopu) první
}

/**
 * Kompaktní bod z knih jedné odpovědi. „Sharp" kniha = **nejnižší marže na 1X2**
 * (tentýž výběr jako `sharpFair`, ale drží se syrové kurzy).
 */
export function seriesPointFrom(
  books: BookOdds[],
  minutesToKickoff: number
): OddsSeriesPoint | null {
  if (books.length === 0) return null;

  let sharp: { book: BookOdds; over: number } | null = null;
  for (const b of books) {
    const over = overroundOf(b);
    if (over == null) continue;
    if (!sharp || over < sharp.over) sharp = { book: b, over };
  }

  const bh = bestPrice(books, "home");
  const bd = bestPrice(books, "draw");
  const ba = bestPrice(books, "away");
  const point: OddsSeriesPoint = {
    t: Math.round(minutesToKickoff),
    n: books.length,
    ...(sharp
      ? {
          b: sharp.book.name,
          h: sharp.book.home ?? undefined,
          d: sharp.book.draw ?? undefined,
          a: sharp.book.away ?? undefined,
          ...(sharp.book.over25 != null ? { o: sharp.book.over25 } : {}),
          ...(sharp.book.under25 != null ? { u: sharp.book.under25 } : {}),
        }
      : {}),
    ...(bh ? { xh: bh.odds } : {}),
    ...(bd ? { xd: bd.odds } : {}),
    ...(ba ? { xa: ba.odds } : {}),
  };
  // Bod bez jediného kurzu je jen šum v DB.
  return point.h != null || point.xh != null ? point : null;
}

/**
 * Přidá bod do řady. Čistá funkce – **nemutuje** vstup. Body blíž výkopu než poslední
 * uložený se zahodí (přišly by po výkopu nebo mimo pořadí) a délka se ořízne na
 * `MAX_SERIES_POINTS` odzadu (nejnovější body jsou ty cennější).
 */
export function appendPoint(
  series: OddsSeriesPoint[],
  point: OddsSeriesPoint
): OddsSeriesPoint[] {
  const kept = series.filter((p) => p.t > point.t);
  const out = [...kept, point];
  return out.length > MAX_SERIES_POINTS ? out.slice(out.length - MAX_SERIES_POINTS) : out;
}

// ── Čtení řady ───────────────────────────────────────────────────────────────────────

export type OutcomeSide = "home" | "draw" | "away";

/** Odmaržované 1X2 pravděpodobnosti sharp knihy v daném bodě (`null` bez kompletního 1X2). */
export function pointProbs(
  p: OddsSeriesPoint
): { home: number; draw: number; away: number } | null {
  if (p.h == null || p.d == null || p.a == null) return null;
  return devig(p.h, p.d, p.a);
}

export interface SeriesDrift {
  /** Kolik bodů řady mělo použitelné 1X2. */
  points: number;
  /** Minut do výkopu u prvního a posledního použitelného bodu. */
  fromT: number;
  toT: number;
  /** Pravděpodobnost strany na začátku a na konci řady. */
  open: number;
  close: number;
  /** `close − open`. Kladné = trh se přiklonil k této straně. */
  drift: number;
  /**
   * Největší pohyb mezi dvěma **sousedními** body. Odliší plynulý posun od skoku –
   * skok je podpis peněz, plynulý drift spíš dorovnávání.
   */
  maxStep: number;
}

/** Jak se linie hýbala u jedné strany. `null`, když nejsou aspoň dva použitelné body. */
export function seriesDrift(
  series: OddsSeriesPoint[],
  side: OutcomeSide
): SeriesDrift | null {
  const usable = series
    .map((p) => ({ t: p.t, probs: pointProbs(p) }))
    .filter((x): x is { t: number; probs: NonNullable<ReturnType<typeof pointProbs>> } =>
      x.probs != null
    );
  if (usable.length < 2) return null;

  const first = usable[0];
  const last = usable[usable.length - 1];
  let maxStep = 0;
  for (let i = 1; i < usable.length; i++) {
    const step = usable[i].probs[side] - usable[i - 1].probs[side];
    if (Math.abs(step) > Math.abs(maxStep)) maxStep = step;
  }
  return {
    points: usable.length,
    fromT: first.t,
    toT: last.t,
    open: first.probs[side],
    close: last.probs[side],
    drift: last.probs[side] - first.probs[side],
    maxStep,
  };
}

/**
 * **Steam**: o kolik se strana pohnula v posledních `hours` hodinách před výkopem.
 *
 * Pozdní pohyb váží víc než stejně velký pohyb tři dny předem – blízko výkopu už je
 * v trhu informace (sestavy, počasí, peníze) a linie se hýbe proto, ne kvůli dorovnání.
 * `null`, když v tom okně nejsou aspoň dva body.
 */
export function lateMove(
  series: OddsSeriesPoint[],
  side: OutcomeSide,
  hours = 6
): number | null {
  const late = series.filter((p) => p.t <= hours * 60);
  const d = seriesDrift(late, side);
  return d ? d.drift : null;
}

/**
 * Poslední bod řady = **nejlepší dostupná aproximace zavírací linie**, nezávislá na tom,
 * jestli cron stihl svoje okno. `null` u prázdné řady.
 */
export function closingPoint(series: OddsSeriesPoint[]): OddsSeriesPoint | null {
  return series.length > 0 ? series[series.length - 1] : null;
}
