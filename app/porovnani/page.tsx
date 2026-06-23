import type { Metadata } from "next";
import { CompareApp, type InitialSelection } from "../_components/CompareApp";
import { getLeagues, getTeamsByLeague } from "@/lib/data/repository";
import type { EntityType } from "@/lib/types";
import { getCurrentUser } from "@/lib/authUser";
import { InstallLink } from "../_components/InstallLink";
import type { SessionUser } from "../_components/sessionUser";

function num(v: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : undefined;
}

/** Název týmu z ligy dle id (kešovaný katalogový read; null = nenalezeno/chyba). */
async function teamName(
  leagueId: number | undefined,
  teamId: number | undefined
): Promise<string | null> {
  if (leagueId == null || teamId == null) return null;
  try {
    const teams = await getTeamsByLeague(leagueId);
    return teams.find((t) => t.id === teamId)?.name ?? null;
  } catch {
    return null; // metadata nesmí shodit stránku
  }
}

// Dynamická metadata pro sdílení a SEO: u konkrétního porovnání „Tým A vs Tým B"
// + dynamický OG obrázek (/og) a kanonická URL. Bez týmů spadne na default z layoutu.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const homeLeague = num(sp.homeLeague);
  const awayLeague = num(sp.awayLeague);
  const home = num(sp.home);
  const away = num(sp.away);

  const [hn, an] = await Promise.all([
    teamName(homeLeague, home),
    teamName(awayLeague, away),
  ]);
  if (!hn || !an) return {}; // dědí statická metadata z layoutu

  const title = `${hn} vs ${an} — porovnání | Predictapp`;
  const description = `Statistické porovnání ${hn} a ${an}: forma, doma/venku, predikce zápasu a klíčové signály.`;
  const ogUrl = `/og?h=${encodeURIComponent(hn)}&a=${encodeURIComponent(an)}`;
  const modeRaw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const mode = modeRaw === "NATIONAL" ? "NATIONAL" : "CLUB";
  const canonical = `/porovnani?mode=${mode}&homeLeague=${homeLeague}&awayLeague=${awayLeague}&home=${home}&away=${away}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630, alt: `${hn} vs ${an}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function PorovnaniPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const leagues = getLeagues();
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
  const sp = await searchParams;
  const modeRaw = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const initial: InitialSelection = {
    mode:
      modeRaw === "NATIONAL" || modeRaw === "CLUB"
        ? (modeRaw as EntityType)
        : undefined,
    homeLeague: num(sp.homeLeague),
    awayLeague: num(sp.awayLeague),
    home: num(sp.home),
    away: num(sp.away),
  };

  return (
    <div className="flex-1">
      <CompareApp leagues={leagues} initial={initial} user={user} />
      <footer className="mx-auto max-w-3xl px-4 py-8 text-center text-xs text-muted">
        <p>
          Hodnoty jsou vážený průměr tří oken — novější zápasy mají větší váhu:
          minulá sezóna 15 % · posl. 10 zápasů 30 % · posl. 5 zápasů 55 %.
          Klikni na metriku pro rozpad po oknech. Data: API-Football.
        </p>
        <p className="mt-2">
          <InstallLink />
        </p>
      </footer>
    </div>
  );
}
