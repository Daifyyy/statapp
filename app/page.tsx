import type { Metadata } from "next";
import { ZapasyApp } from "./_components/ZapasyApp";
import { getFixturesByDates, getRecentResults } from "@/lib/data/repository";
import { InstallLink } from "./_components/InstallLink";

export const metadata: Metadata = {
  title: "Fotbalové zápasy tento týden — Predictapp",
  description:
    "Nadcházející fotbalové zápasy na tento týden podle ligy. Klikni a získej rovnou statistické porovnání a predikci.",
};

/**
 * Domovská stránka je **statická (ISR)**: nečte cookies ani `searchParams` (starý
 * sdílený odkaz `/?home=&away=` přesměruje `middleware.ts`), přihlášeného uživatele
 * načte `ZapasyApp` klientsky (`/api/me`). Rozpis + výsledky (shodné pro všechny) se tak
 * vygenerují 1× za `revalidate` a servírují z CDN → rychlé TTFB, žádný per-request SSR
 * ani session dotaz na kritické cestě. Živé skóre dorovná klientský poll (viz `ZapasyApp`).
 */
// Vynuceně statické: datová vrstva při cache-miss volá `fetch(no-store)` (API-Football),
// což by jinak stránku překlopilo do dynamic. `force-static` to potlačí – čerstvost drží
// naše vlastní `cachedJson` TTL (Neon) a ISR regenerace každých `revalidate` s.
export const dynamic = "force-static";
export const revalidate = 600; // 10 min – rozpis se přes den mění minimálně

/** Kolik dní dopředu načítat do rozpisu (dnes + dalších 6). */
const LOOKAHEAD_DAYS = 7;

// Den ve formátu YYYY-MM-DD v pražské zóně (správné hranice „dnes/zítra").
function pragueDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default async function Home() {
  const now = new Date();
  const dates = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) =>
    pragueDate(new Date(now.getTime() + i * 24 * 60 * 60 * 1000))
  );
  const [days, results] = await Promise.all([
    getFixturesByDates(dates),
    getRecentResults(),
  ]);

  return (
    <div className="flex-1">
      <ZapasyApp days={days} results={results} />
      <footer className="mx-auto max-w-3xl px-4 py-8 text-center text-xs text-muted">
        <p>
          Klikni na zápas a otevře se statistické porovnání obou týmů s predikcí —
          bez ručního vybírání týmů. Data: API-Football.
        </p>
        <p className="mt-2">
          <InstallLink />
        </p>
      </footer>
    </div>
  );
}
