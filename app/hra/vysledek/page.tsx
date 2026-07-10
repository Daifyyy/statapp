import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

/**
 * Veřejná sdílecí stránka pro výsledek Manažera (sezóna/turnaj). Čistě z query
 * stringu (žádný DB/save lookup — appka nemá veřejné API pro cizí save), stejný
 * princip jako `/porovnani`'s `generateMetadata`, jen bez katalogového čtení,
 * protože tady všechna data dodá klient (`SeasonDone`/`TournamentDone`) přímo v URL.
 */

function str(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

type SearchParams = { [key: string]: string | string[] | undefined };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const club = str(sp.club);
  const headline = str(sp.headline) || "Sezóna dohraná";
  const context = str(sp.context);
  const titles = str(sp.titles);

  const title = club ? `${club} — ${headline} | Predictapp Manažer` : `${headline} | Predictapp Manažer`;
  const description = context
    ? `${headline} · ${context} — hraj Manažera na Predictapp, klubový simulátor postavený na reálném predikčním modelu.`
    : "Hraj Manažera na Predictapp, klubový simulátor postavený na reálném predikčním modelu.";
  const params = new URLSearchParams();
  if (club) params.set("club", club);
  if (headline) params.set("headline", headline);
  if (context) params.set("context", context);
  if (titles) params.set("titles", titles);
  const ogUrl = `/og/hra?${params.toString()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630, alt: headline }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function VysledekPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const club = str(sp.club);
  const headline = str(sp.headline) || "Sezóna dohraná";
  const context = str(sp.context);
  const titles = str(sp.titles);

  return (
    <div className="flex-1">
      <main className="mx-auto w-full max-w-md px-4 py-10 text-center">
        <Image
          src="/logoapp.png"
          alt="Predictapp"
          width={48}
          height={48}
          className="mx-auto rounded-xl"
        />
        <div className="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-sm">
          {club && <p className="text-sm text-muted">{club}</p>}
          <p className="mt-1 text-2xl font-bold text-positive">{headline}</p>
          {context && <p className="mt-2 text-sm text-muted">{context}</p>}
          {titles && <p className="mt-3 text-xs text-muted">🏆 {titles}× titul v kariéře</p>}
        </div>
        <p className="mt-6 text-sm text-muted">
          Manažer je klubový simulátor postavený na stejném predikčním modelu, který na
          Predictapp jinak tipuje reálné zápasy.
        </p>
        <Link
          href="/hra"
          className="mt-4 inline-block rounded-full bg-positive px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Vyzkoušet Manažera
        </Link>
      </main>
    </div>
  );
}
