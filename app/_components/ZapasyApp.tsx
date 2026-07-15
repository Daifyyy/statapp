"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FixtureDay, SettledMatch, UpcomingFixture } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { RankBadge } from "./RankBadge";
import { buildCompareHref } from "./compareHref";
import type { SessionUser } from "./sessionUser";

type View = "program" | "results";

/**
 * Záložka „Zápasy" = domovská obrazovka pro rychlý přístup k predikci. Dvě části
 * (přepínač): **Program** = nadcházející zápasy seskupené podle ligy (klik = Porovnání
 * s předvyplněnými týmy + predikcí, bez ručního zadávání) a **Výsledky** = jak dopadly
 * naše nedávné predikce (skóre + ✓/✗). Seznamy jsou jen navigace – nic se nepočítá živě.
 */
export function ZapasyApp({
  days,
  results,
  user,
}: {
  days: FixtureDay[];
  results: SettledMatch[];
  user: SessionUser | null;
}) {
  const [view, setView] = useState<View>("program");
  const [dayIdx, setDayIdx] = useState(0);
  const active = days[dayIdx] ?? days[0];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/tabulky", label: "Tabulky", emoji: "📊" },
          { href: "/predikce", label: "Tipy", emoji: "📈" },
          { href: "/transfers", label: "Přestupy", emoji: "🔄" },
          { href: "/hra", label: "Hra", emoji: "🎮" },
          { href: "/tipovacka", label: "Tipovačka", emoji: "🎲" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Zápasy</h1>
      <p className="mt-1 text-sm text-muted">
        {view === "program"
          ? "Vyber zápas a rovnou se otevře porovnání týmů s predikcí."
          : "Jak dopadly naše nedávné predikce – skóre a zda jsme trefili výsledek."}
      </p>

      <ViewTabs view={view} onSelect={setView} resultCount={results.length} />

      {view === "program" ? (
        <>
          <DayTabs days={days} active={dayIdx} onSelect={setDayIdx} />
          {active && active.fixtures.length > 0 ? (
            <LeagueGroups fixtures={active.fixtures} />
          ) : (
            <Empty>
              Na tento den nemáme naplánované zápasy ve sledovaných ligách. Mimo sezónu
              (léto) top ligy nehrají – zkus jiný den nebo se vrať během sezóny.
            </Empty>
          )}
        </>
      ) : results.length > 0 ? (
        <ResultsList results={results} />
      ) : (
        <Empty>
          Zatím nemáme vyhodnocené predikce. Výsledky se naplní, jakmile se odehrají
          zápasy z našich sledovaných lig.
        </Empty>
      )}
    </main>
  );
}

function ViewTabs({
  view,
  onSelect,
  resultCount,
}: {
  view: View;
  onSelect: (v: View) => void;
  resultCount: number;
}) {
  const tabs: { value: View; label: string }[] = [
    { value: "program", label: "Program" },
    {
      value: "results",
      label: resultCount > 0 ? `Výsledky (${resultCount})` : "Výsledky",
    },
  ];
  return (
    <div className="mt-4 inline-flex w-full rounded-full border border-border bg-surface p-0.5">
      {tabs.map((t) => {
        const activeTab = t.value === view;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onSelect(t.value)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              activeTab
                ? "bg-foreground text-background"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// idx 0 → „Dnes", 1 → „Zítra", dál krátký den v týdnu + datum (So 28. 6.).
function dayLabel(date: string, idx: number): string {
  if (idx === 0) return "Dnes";
  if (idx === 1) return "Zítra";
  return new Date(`${date}T00:00:00`).toLocaleDateString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
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
  // Horizontálně scrollovatelný pásek (mobile-first) – týden dní se nevejde do řady.
  return (
    <div className="mt-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {days.map((d, i) => (
        <button
          key={d.date}
          type="button"
          onClick={() => onSelect(i)}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition ${
            i === active
              ? "border-foreground bg-foreground text-background"
              : `border-border bg-surface hover:text-foreground ${
                  isWeekend(d.date) ? "text-foreground/80" : "text-muted"
                }`
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
  const href = buildCompareHref(fixture);
  const clickable = href != null;
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] leading-tight text-muted">{time}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        <TeamLogo src={fixture.home.logoUrl} alt={fixture.home.name} size={20} />
        <span className="min-w-0 truncate font-medium text-home">{fixture.home.name}</span>
        <RankBadge rank={fixture.homeRank} />
        <span className="shrink-0 text-muted">–</span>
        <TeamLogo src={fixture.away.logoUrl} alt={fixture.away.name} size={20} />
        <span className="min-w-0 truncate font-medium text-away">{fixture.away.name}</span>
        <RankBadge rank={fixture.awayRank} />
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
      {href != null ? (
        <Link href={href} className={`${cardClass} transition hover:border-foreground/30`}>
          {inner}
        </Link>
      ) : (
        <div className={cardClass}>{inner}</div>
      )}
    </li>
  );
}

function ResultsList({ results }: { results: SettledMatch[] }) {
  const hits = results.filter((r) => r.outcomeHit).length;
  return (
    <div className="mt-4">
      <p className="px-1 text-xs text-muted">
        Výsledek 1X2 trefen u{" "}
        <span className="font-semibold text-foreground">
          {hits} z {results.length}
        </span>{" "}
        nedávných zápasů.
      </p>
      <ul className="mt-2 space-y-2">
        {results.map((r) => (
          <ResultRow key={r.fixtureId} result={r} />
        ))}
      </ul>
    </div>
  );
}

const SIDE_LABELS: Record<SettledMatch["predictedSide"], string> = {
  home: "Domácí",
  draw: "Remíza",
  away: "Hosté",
};

function ResultRow({ result }: { result: SettledMatch }) {
  const date = new Date(result.kickoff).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
  });
  const href = buildCompareHref(result);
  const tip = `Tip: ${SIDE_LABELS[result.predictedSide]} · ${Math.round(
    result.predictedProb * 100
  )} %`;
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className="w-9 shrink-0 text-[11px] leading-tight text-muted">{date}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <TeamLogo src={result.home.logoUrl} alt={result.home.name} size={20} />
          <span className="min-w-0 truncate font-medium text-home">{result.home.name}</span>
          <span
            className="shrink-0 font-bold tabular-nums text-foreground"
            title={
              result.afterExtraTime
                ? "Stav po 90 minutách (zápas se rozhodl až v prodloužení)"
                : undefined
            }
          >
            {result.homeGoals}:{result.awayGoals}
            {result.afterExtraTime && (
              <span className="ml-0.5 align-super text-[9px] font-normal text-muted">
                90′
              </span>
            )}
          </span>
          <span className="min-w-0 truncate font-medium text-away">{result.away.name}</span>
          <TeamLogo src={result.away.logoUrl} alt={result.away.name} size={20} />
        </div>
        <span
          className={`shrink-0 text-sm font-bold ${
            result.outcomeHit ? "text-positive" : "text-negative"
          }`}
          aria-label={result.outcomeHit ? "Predikce vyšla" : "Predikce nevyšla"}
        >
          {result.outcomeHit ? "✓" : "✗"}
        </span>
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">{tip}</div>
    </>
  );
  return (
    <li>
      {href != null ? (
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
