/**
 * Tenký wrapper pro logování serverových chyb. Dnes strukturovaný console.error;
 * připraveno na napojení externího trackeru (Sentry…) za env flagem `SENTRY_DSN`
 * bez zásahu do call-sites. Bez DSN je no-op nad rámec logu → nic se nerozbije.
 */
/**
 * Je to **řídicí tok Next.js**, ne chyba? (`redirect()`, `notFound()`, bailout ze
 * statického renderu při použití `headers()`/`cookies()`.)
 *
 * Next je signalizuje vyhozením výjimky s řetězcovým polem `digest`
 * (`DYNAMIC_SERVER_USAGE`, `NEXT_REDIRECT`, `BAILOUT_TO_CLIENT_SIDE_RENDERING`, …).
 * Takovou výjimku **nesmí `catch` spolknout ani zalogovat** – spolknutím se rozbije
 * mechanismus, který ji vyhodil, a zalogováním se do logu nasype stack z každého
 * dynamického renderu, takže v něm zanikne skutečná chyba.
 *
 * Detekuje se **tvarem, ne importem** z `next/dist/client/components/hooks-server-context`
 * – ta cesta není veřejné API a mezi verzemi se stěhuje.
 */
export function isFrameworkSignal(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string"
  );
}

export function logError(scope: string, err: unknown, extra?: Record<string, unknown>) {
  // Pojistka pro všechna volací místa: řídicí tok frameworku do logu nepatří.
  if (isFrameworkSignal(err)) return;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[${scope}] ${message}`, { stack, ...extra });
  // TODO: je-li process.env.SENTRY_DSN nastaveno, předat sem (Sentry.captureException).
}
