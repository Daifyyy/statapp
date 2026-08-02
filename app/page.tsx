import type { Metadata } from "next";
import { ZapasyApp } from "./_components/ZapasyApp";
import { getFixturesByDates, getRecentResults } from "@/lib/data/repository";
import { pragueDay } from "@/lib/data/fixtures";
import { mergeTips } from "@/lib/picks/results";
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

/**
 * Kolik dní **zpět** načítat kvůli Výsledkům (dnes + 3 dozadu pokryje celé kolo).
 * Minulé dny jsou v cache s dlouhým TTL (den, který skončil, se už nezmění), takže
 * po prvním naplnění stojí prakticky nic. `ZapasyApp` z nich staví pásek dní dozadu –
 * **pořadí `dates` (nejstarší první) je součást kontraktu**, viz `RESULT_DAYS` tam.
 */
const RESULT_DAYS = 3;

export default async function Home() {
  const now = new Date();
  const dates = Array.from(
    { length: RESULT_DAYS + LOOKAHEAD_DAYS },
    (_, i) =>
      pragueDay(new Date(now.getTime() + (i - RESULT_DAYS) * 24 * 60 * 60 * 1000))
  );
  const [rawDays, results] = await Promise.all([
    getFixturesByDates(dates),
    // Okno tipů musí pokrýt celý pásek dozadu (+1 den rezerva na posun půlnoci).
    getRecentResults(RESULT_DAYS + 1),
  ]);
  // Náš tip je **překryv** nad odehraným zápasem, ne podmínka jeho zobrazení.
  const days = mergeTips(rawDays, results);

  return (
    <div className="flex-1">
      <ZapasyApp days={days} resultDays={RESULT_DAYS} />
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
