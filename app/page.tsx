import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ZapasyApp } from "./_components/ZapasyApp";
import { getFixturesByDates, getRecentResults } from "@/lib/data/repository";
import { getCurrentUser } from "@/lib/authUser";
import { InstallLink } from "./_components/InstallLink";
import type { SessionUser } from "./_components/sessionUser";

export const metadata: Metadata = {
  title: "Fotbalové zápasy tento týden — Predictapp",
  description:
    "Nadcházející fotbalové zápasy na tento týden podle ligy. Klikni a získej rovnou statistické porovnání a predikci.",
};

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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  // Zpětná kompatibilita: starý sdílený odkaz na porovnání (`/?home=&away=`) přesměruj
  // na novou cestu /porovnani (zachová sdílení i OG kartu).
  if (sp.home != null && sp.away != null) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v == null) continue;
      qs.set(k, Array.isArray(v) ? (v[0] ?? "") : v);
    }
    redirect(`/porovnani?${qs.toString()}`);
  }

  const cu = await getCurrentUser();
  const user: SessionUser | null = cu
    ? {
        id: cu.id,
        name: cu.name,
        image: cu.image,
        tier: cu.tier,
        proTrialUsed: cu.proTrialUsed,
      }
    : null;

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
      <ZapasyApp days={days} results={results} user={user} />
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
