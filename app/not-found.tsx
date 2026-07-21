import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stránka nenalezena — Predictapp",
  // Neindexovat 404 – ať se prázdné cesty nedostanou do vyhledávače.
  robots: { index: false, follow: false },
};

/**
 * Globální 404. Dřív aplikace neměla žádnou vlastní not-found stránku → neexistující
 * cesta vracela holý Next default bez navigace zpět do appky.
 */
export default function NotFound() {
  return (
    <div className="flex-1 p-4">
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center">
        <p className="text-3xl">🔍</p>
        <p className="mt-2 text-sm font-medium text-foreground">Stránka nenalezena</p>
        <p className="mt-1 text-sm text-muted">
          Tahle adresa neexistuje nebo už není dostupná.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Zpět na úvod
        </Link>
      </div>
    </div>
  );
}
