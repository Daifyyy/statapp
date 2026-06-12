/**
 * Globální serializátor volání API-Football.
 *
 * Reálné omezení api-sports není jen 300/min, ale i burst/souběžnostní ochrana
 * na edge (vrací 429 bez rate-headerů, když přijde víc requestů naráz). Proto
 * pouštíme volání POSTUPNĚ (souběžnost 1) s minimálním rozestupem mezi starty.
 * Jeden request v letu = žádný burst → žádné falešné rate-limity.
 */
const MIN_INTERVAL_MS = 300; // ~200/min, bezpečně pod limitem i burst ochranou

let queue: Promise<unknown> = Promise.resolve();
let lastStart = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Zařadí volání do globální fronty (poběží sekvenčně s rozestupem). */
export function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastStart + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    return fn();
  });
  // Fronta pokračuje až po dokončení (i při chybě) – drží souběžnost 1.
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run as Promise<T>;
}
