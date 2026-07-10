"use client";

import { useEffect } from "react";

/**
 * Scoped error boundary pro /hra. Bez tohohle by neošetřená výjimka v HraApp
 * (3600+ řádků klientské logiky, žádné komponentové testy) spadla na nejbližšího
 * rodiče a hráč by neviděl nic specifického pro tuto sekci ani cestu ven.
 */
export default function HraError({
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
        <p className="mt-2 text-sm font-medium text-foreground">Hra spadla na chybu</p>
        <p className="mt-1 text-sm text-muted">
          Rozehraná kariéra zůstává uložená na serveru (poslední úspěšné uložení). Zkus to
          znovu – pokud se to opakuje, zkus obnovit stránku.
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Zkusit znovu
        </button>
      </div>
    </div>
  );
}
