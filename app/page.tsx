import { CompareApp, type InitialSelection } from "./_components/CompareApp";
import { getLeagues } from "@/lib/data/repository";
import type { EntityType } from "@/lib/types";
import { getCurrentUser } from "@/lib/authUser";
import { InstallLink } from "./_components/InstallLink";
import type { SessionUser } from "./_components/sessionUser";

function num(v: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : undefined;
}

export default async function Home({
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
