/**
 * Tenký wrapper pro logování serverových chyb. Dnes strukturovaný console.error;
 * připraveno na napojení externího trackeru (Sentry…) za env flagem `SENTRY_DSN`
 * bez zásahu do call-sites. Bez DSN je no-op nad rámec logu → nic se nerozbije.
 */
export function logError(scope: string, err: unknown, extra?: Record<string, unknown>) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[${scope}] ${message}`, { stack, ...extra });
  // TODO: je-li process.env.SENTRY_DSN nastaveno, předat sem (Sentry.captureException).
}
