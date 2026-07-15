/**
 * `Cache-Control` pro veřejné GET routy s daty **shodnými pro všechny uživatele**
 * (tabulky, střelci, živé skóre). Vercel edge pak opakované dotazy odbaví bez zásahu
 * serverless funkce i Neonu. `s-maxage` = kolik sekund smí CDN držet čerstvou odpověď,
 * `stale-while-revalidate` = jak dlouho po expiraci ještě servírovat starou (a na pozadí
 * obnovit). `max-age=0` drží prohlížeč, ať vždy revaliduje (CDN nese sdílenou tíhu).
 */
export function publicCache(
  sMaxAge: number,
  swr: number = sMaxAge
): { "Cache-Control": string } {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
  };
}
