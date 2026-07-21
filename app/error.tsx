"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Kořenový error boundary (mimo /hra, které má vlastní). Bez něj dostane uživatel při
 * neošetřené výjimce v jakékoli server komponentě (/porovnani, /predikce, /tabulky,
 * /transfers, /tipovacka) holou default Next chybovou stránku bez cesty ven ani značky.
 * Kryje výpadky Neonu/API při SSR i chyby v klientských komponentách záložek.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex-1 p-4">
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center">
        <p className="text-3xl">⚠️</p>
        <p className="mt-2 text-sm font-medium text-foreground">Něco se pokazilo</p>
        <p className="mt-1 text-sm text-muted">
          Stránku se nepodařilo načíst. Zkus to znovu – pokud problém přetrvává, obnov
          stránku nebo se vrať na úvod.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Zkusit znovu
          </button>
          <Link
            href="/"
            className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:text-foreground"
          >
            Na úvod
          </Link>
        </div>
      </div>
    </div>
  );
}
