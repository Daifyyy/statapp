/**
 * Denní strop upstream volání **živých statistik** (`/fixtures/statistics` na běžící zápas).
 *
 * Proč zrovna tady vlastní počítadlo: tohle je jediná cesta v appce, kterou spouští
 * uživatel svým chováním (otevřený panel se pollí po minutě) a která se **nedá sdílet
 * mezi zápasy** — každý zápas je vlastní volání. Ostatní horké cesty mají přirozený
 * strop v tom, že jsou sdílené (živé skóre = 1 volání pro všechny ligy i uživatele).
 *
 * **Tvrdý strop dělá TTL**, ne tenhle čítač: při 120s TTL nemůže jeden zápas stát víc
 * než ~30 volání za hodinu, ať se dívá kdokoli. Čítač je **měkká pojistka a hlídač** —
 * na serverless běží per-instance a padá se studeným startem, takže reálná spotřeba může
 * být násobkem `LIVE_STATS_DAILY_MAX`. Nepředstírat, že je to garance; jeho hlavní cena
 * je v tom, že se překročení objeví v logu dřív, než se objeví na kvótě.
 *
 * Odhad, ze kterého číslo vychází (viz `docs/provoz.md`): jeden zápas s nepřetržitě
 * otevřeným panelem ≈ 47 volání. 600 pokrývá ~12 takových zápasů denně, což je nad
 * realistickým provozem a hluboko pod volnou rezervou kvóty (~6600/den).
 */

export const LIVE_STATS_DAILY_MAX = 600;

/** Hozeno místo fetche, když je strop vyčerpaný – volající to přeloží na `reason`. */
export class LiveBudgetError extends Error {
  constructor() {
    super("Denní strop živých statistik vyčerpán");
    this.name = "LiveBudgetError";
  }
}

let currentDay = "";
let used = 0;

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Zkusí odečíst jedno volání. Volat **až v fetcheru** (tedy jen při skutečném missu
 * cache), ne před ním – jinak by se počítaly i obsloužené trefy.
 */
export function tryConsumeLiveStats(): boolean {
  const day = today();
  if (day !== currentDay) {
    currentDay = day;
    used = 0;
  }
  if (used >= LIVE_STATS_DAILY_MAX) return false;
  used++;
  return true;
}

/** Stav pro diagnostiku (log, případně budoucí health endpoint). */
export function liveStatsUsage(): { used: number; max: number; day: string } {
  return { used, max: LIVE_STATS_DAILY_MAX, day: currentDay };
}

/** Jen pro testy – produkční kód čítač neresetuje. */
export function __resetLiveBudget(): void {
  currentDay = "";
  used = 0;
}
