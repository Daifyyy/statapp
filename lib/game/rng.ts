// Deterministický PRNG (mulberry32) – stabilní generace ligy i výsledků pro daný
// seed. Sdílí algoritmus s mock/generate.ts, ale herní modul je samostatný (offline,
// bez závislosti na mock datech). Per-kolo seed drží reprodukovatelnost i po reloadu.

/** mulberry32 – rychlý deterministický generátor v [0,1). */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Náhodný seed (uint32) pro novou hru. */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

/** Fisher–Yates s daným RNG (deterministické). */
export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Seed odvozený z (base, index) – každé kolo dostane vlastní deterministický RNG,
 * takže výsledky nezávisí na tom, kolik kol se odehrálo v jedné session (odolné vůči
 * reloadu: RNG stav se neserializuje, odvozuje se z uloženého seedu + čísla kola).
 */
export function deriveSeed(base: number, index: number): number {
  return (Math.imul(base ^ (index + 1), 0x9e3779b1) >>> 0);
}
