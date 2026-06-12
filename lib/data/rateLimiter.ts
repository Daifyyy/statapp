/**
 * Globální limiter volání API-Football.
 *
 * Kombinuje:
 *  - SOUBĚŽNOST (semafor) – víc volání naráz → rychlejší cold-load,
 *  - klouzavý MINUTOVÝ STROP – ochrana proti překročení 300/min (multi-user,
 *    porovnání za sebou),
 * Přechodné burst-odmítnutí edge (429 bez headerů) řeší krátký retry v apiGet.
 */
const MAX_CONCURRENT = 3;
const MAX_PER_MIN = 280;
const WINDOW_MS = 60_000;

let active = 0;
const waiters: Array<() => void> = [];
const recent: number[] = []; // časy posledních startů (klouzavé okno)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function acquire(): Promise<void> {
  // 1) Semafor souběžnosti.
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;

  // 2) Klouzavý minutový strop.
  for (;;) {
    const now = Date.now();
    while (recent.length && recent[0] <= now - WINDOW_MS) recent.shift();
    if (recent.length < MAX_PER_MIN) {
      recent.push(now);
      return;
    }
    await sleep(recent[0] + WINDOW_MS - now);
  }
}

function release(): void {
  active--;
  waiters.shift()?.();
}

/** Spustí volání v rámci limitů (souběžnost + minutový strop). */
export async function schedule<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
