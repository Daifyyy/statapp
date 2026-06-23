"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FixtureDay, UpcomingFixture } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import type { SessionUser } from "./sessionUser";

/**
 * Záložka „Zápasy" = domovská obrazovka pro rychlý přístup k predikci. Ukáže
 * nadcházející zápasy (dnes/zítra) seskupené podle ligy; klik na klubový zápas
 * otevře Porovnání s předvyplněnými týmy, které se samo přepočítá včetně predikce
 * (žádné ruční zadávání). Reprezentační zápasy jsou neklikací (cross-konfederační
 * deep-link by nesedl). Seznam je jen navigace – nic se nepočítá živě tady.
 */
export function ZapasyApp({
  days,
  user,
}: {
  days: FixtureDay[];
  user: SessionUser | null;
}) {
  const [dayIdx, setDayIdx] = useState(0);
  const active = days[dayIdx] ?? days[0];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/predikce", label: "Tipy", emoji: "📈" },
          { href: "/transfers", label: "Přestupy", emoji: "🔄" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Zápasy</h1>
      <p className="mt-1 text-sm text-muted">
        Vyber zápas a rovnou se otevře porovnání týmů s predikcí.
      </p>

      <DayTabs days={days} active={dayIdx} onSelect={setDayIdx} />

      {active && active.fixtures.length > 0 ? (
        <LeagueGroups fixtures={active.fixtures} />
      ) : (
        <Empty>
          Na tento den nemáme naplánované zápasy ve sledovaných ligách. Mimo sezónu
          (léto) top ligy nehrají – zkus druhý den nebo se vrať během sezóny.
        </Empty>
      )}
    </main>
  );
}

const DAY_LABELS = ["Dnes", "Zítra"];

function dayLabel(date: string, idx: number): string {
  const base = DAY_LABELS[idx] ?? "";
  const d = new Date(`${date}T00:00:00`).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
  });
  return base ? `${base} · ${d}` : d;
}

function DayTabs({
  days,
  active,
  onSelect,
}: {
  days: FixtureDay[];
  active: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="mt-4 flex gap-2">
      {days.map((d, i) => (
        <button
          key={d.date}
          type="button"
          onClick={() => onSelect(i)}
          className={`flex-1 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
            i === active
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-surface text-muted hover:text-foreground"
          }`}
        >
          {dayLabel(d.date, i)}
          <span className="ml-1.5 text-xs opacity-70">({d.fixtures.length})</span>
        </button>
      ))}
    </div>
  );
}

interface LeagueGroup {
  leagueId: number;
  name: string;
  logoUrl: string;
  fixtures: UpcomingFixture[];
}

function LeagueGroups({ fixtures }: { fixtures: UpcomingFixture[] }) {
  // Seskup dle ligy; pořadí lig dle nejbližšího výkopu (fixtures jsou už dle času).
  const groups = useMemo<LeagueGroup[]>(() => {
    const map = new Map<number, LeagueGroup>();
    for (const f of fixtures) {
      let g = map.get(f.leagueId);
      if (!g) {
        g = {
          leagueId: f.leagueId,
          name: f.leagueName,
          logoUrl: f.leagueLogoUrl,
          fixtures: [],
        };
        map.set(f.leagueId, g);
      }
      g.fixtures.push(f);
    }
    return [...map.values()];
  }, [fixtures]);

  return (
    <div className="mt-4 space-y-5">
      {groups.map((g) => (
        <section key={g.leagueId}>
          <div className="flex items-center gap-2 px-1">
            <TeamLogo src={g.logoUrl} alt={g.name} size={18} />
            <h2 className="text-sm font-semibold text-foreground">{g.name}</h2>
          </div>
          <ul className="mt-2 space-y-2">
            {g.fixtures.map((f) => (
              <FixtureRow key={f.fixtureId} fixture={f} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FixtureRow({ fixture }: { fixture: UpcomingFixture }) {
  const time = new Date(fixture.kickoff).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Klikatelné, když známe „ligu" obou stran pro deep-link (klub vždy; reprezentace
  // jen když se dohledala konfederace každého týmu). Jinak neklikací karta.
  const { compareMode, homeCompareLeagueId, awayCompareLeagueId } = fixture;
  const clickable = homeCompareLeagueId != null && awayCompareLeagueId != null;
  const href = `/porovnani?mode=${compareMode}&homeLeague=${homeCompareLeagueId}&awayLeague=${awayCompareLeagueId}&home=${fixture.home.id}&away=${fixture.away.id}`;
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] leading-tight text-muted">{time}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        <TeamLogo src={fixture.home.logoUrl} alt={fixture.home.name} size={20} />
        <span className="min-w-0 truncate font-medium text-home">{fixture.home.name}</span>
        <span className="shrink-0 text-muted">–</span>
        <TeamLogo src={fixture.away.logoUrl} alt={fixture.away.name} size={20} />
        <span className="min-w-0 truncate font-medium text-away">{fixture.away.name}</span>
      </div>
      {clickable && (
        <span className="shrink-0 text-muted" aria-hidden>
          ›
        </span>
      )}
    </div>
  );
  return (
    <li>
      {clickable ? (
        <Link href={href} className={`${cardClass} transition hover:border-foreground/30`}>
          {inner}
        </Link>
      ) : (
        <div className={cardClass}>{inner}</div>
      )}
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}
