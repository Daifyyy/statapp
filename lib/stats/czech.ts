/**
 * České skloňování počtu pro věty, do kterých se čísla dosazují z dat.
 *
 * Bez tohohle vznikají věty typu „3 karet" a „1 góly" – a protože čísla přicházejí
 * z metrik, nejde je napsat natvrdo. Modul je **sdílený** mezi živým přehledem
 * (`liveReport.ts`) a přehledem odehraného zápasu (`matchReview.ts`): dvě kopie téhle
 * tabulky se dřív nebo později rozejdou a rozdíl bude vidět jen v textu, kde si ho
 * nikdo nevšimne.
 *
 * Čisté funkce, žádný stav.
 */

/** Tvar podle počtu: 1 / 2–4 / 0 a 5+. */
export function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

export const shotsWord = (n: number) => `${n} ${plural(n, "střela", "střely", "střel")}`;
export const cardsWord = (n: number) => `${n} ${plural(n, "karta", "karty", "karet")}`;
export const goalsWord = (n: number) => `${n} ${plural(n, "gól", "góly", "gólů")}`;
export const cornersWord = (n: number) => `${n} ${plural(n, "roh", "rohy", "rohů")}`;
export const matchesWord = (n: number) =>
  `${n} ${plural(n, "zápas", "zápasy", "zápasů")}`;
