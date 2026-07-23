"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { TeamLogo } from "./TeamLogo";
import { StandingsTable, ZoneLegend } from "./StandingsTable";
import { LeagueScorerList } from "./LeagueScorerList";
import { buildCompareHref } from "./compareHref";
import { CLUB_LEAGUES, leagueDisplayName } from "@/lib/data/catalog";
import type { LeagueRound, LeagueScorer, LeagueTable, RoundFixture } from "@/lib/types";
import { useCurrentUser } from "./useCurrentUser";

const DEFAULT_LEAGUE = 39; // Premier League
const STORAGE_KEY = "tabulky:league";

type Status = "loading" | "ok" | "error";

// Mimo komponentu (vzor DigestApp/PicksApp): žádné synchronní setState přímo v efektu.
async function loadTable(
  leagueId: number,
  isActive: () => boolean,
  setTable: (t: LeagueTable | null) => void,
  setStatus: (s: Status) => void
): Promise<void> {
  setStatus("loading");
  setTable(null);
  try {
    const r = await fetch(`/api/standings/table?league=${leagueId}`);
    if (!r.ok) throw new Error("http");
    const d: { table: LeagueTable | null } = await r.json();
    if (!isActive()) return;
    setTable(d.table);
    setStatus("ok");
  } catch {
    if (isActive()) setStatus("error");
  }
}

/**
 * Poslední odehrané + nejbližší nadcházející zápasy (odděleně od tabulky – jiné TTL, jiná
 * routa). Pozor: API nemá dotaz „celé kolo", jen skupinu zápasů dogroupovanou podle data
 * (`pickRound`) – u rozehraného kola (rozloženého např. pá–po) proto může „poslední" sekce
 * ukázat jen část zápasů, zbytek téhož kola padne do „nejbližší". Proto zobrazovací popisky
 * v UI mluví o „zápasech", ne o „kole" – neslibují úplnost.
 */
async function loadRound(
  leagueId: number,
  isActive: () => boolean,
  setRound: (r: LeagueRound | null) => void
): Promise<void> {
  setRound(null);
  try {
    const r = await fetch(`/api/standings/round?league=${leagueId}`);
    if (!r.ok) return;
    const d: { round: LeagueRound | null } = await r.json();
    if (isActive()) setRound(d.round);
  } catch {
    // tichý fail – sekce se prostě nevykreslí
  }
}

/** Nejlepší střelci + nahrávači ligy. */
async function loadScorers(
  leagueId: number,
  isActive: () => boolean,
  setScorers: (s: { scorers: LeagueScorer[]; assists: LeagueScorer[] }) => void
): Promise<void> {
  setScorers({ scorers: [], assists: [] });
  try {
    const r = await fetch(`/api/standings/scorers?league=${leagueId}`);
    if (!r.ok) return;
    const d: { scorers: LeagueScorer[]; assists: LeagueScorer[] } = await r.json();
    if (isActive()) setScorers(d);
  } catch {
    // tichý fail – sekce se prostě nevykreslí
  }
}

/** Obnoví poslední zvolenou ligu z localStorage (mimo tělo efektu → lint-clean). */
function restoreLeague(apply: (id: number) => void): void {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && CLUB_LEAGUES.some((l) => l.id === saved)) apply(saved);
  } catch {
    // localStorage nemusí být dostupný (privátní režim) – nevadí
  }
}

/**
 * Záložka Tabulky (FREE): celá aktuální ligová tabulka vybrané klubové ligy. Data se
 * tahají líně z `/api/standings/table` (sdílí `standings:` cache → levné) při přepnutí
 * ligy. Mobile-first: úzké obrazovky skryjí rozšířené sloupce (V-R-P, forma), nescrolluje
 * se vodorovně celá stránka. Poslední zvolená liga se pamatuje v `localStorage`.
 */
export function TabulkyApp() {
  const user = useCurrentUser();
  const [leagueId, setLeagueId] = useState(DEFAULT_LEAGUE);
  const [table, setTable] = useState<LeagueTable | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [round, setRound] = useState<LeagueRound | null>(null);
  const [scorers, setScorers] = useState<{ scorers: LeagueScorer[]; assists: LeagueScorer[] }>({
    scorers: [],
    assists: [],
  });

  // Po mountu obnov poslední zvolenou ligu (bez SSR hydration mismatchu).
  useEffect(() => {
    restoreLeague(setLeagueId);
  }, []);

  useEffect(() => {
    let active = true;
    void loadTable(leagueId, () => active, setTable, setStatus);
    void loadRound(leagueId, () => active, setRound);
    void loadScorers(leagueId, () => active, setScorers);
    return () => {
      active = false;
    };
  }, [leagueId]);

  function select(id: number) {
    setLeagueId(id);
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // localStorage nemusí být dostupný (privátní režim) – nevadí
    }
  }

  const league = CLUB_LEAGUES.find((l) => l.id === leagueId);
  const rows = table?.rows ?? [];
  // Předsezóna: API vrací týmy, ale všechny s 0 odehranými (tabulka samých nul) →
  // ber to jako prázdný stav (informativní hláška místo bezcenné tabulky).
  const hasPlayed = rows.some((r) => r.played > 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/", label: "Zápasy", emoji: "📅" },
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/predikce", label: "Predikce", emoji: "🎯" },
          { href: "/hra", label: "Hra", emoji: "🎮" },
          { href: "/tipovacka", label: "Tipovačka", emoji: "🎲" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Ligové tabulky</h1>
      <p className="mt-1 text-sm text-muted">
        Aktuální pořadí vybrané ligy – pozice, body, skóre a forma.
      </p>

      <LeaguePicker selected={leagueId} onSelect={select} />

      <section className="mt-4">
        {status === "loading" ? (
          <TableSkeleton />
        ) : status === "error" ? (
          <Note>Tabulku se nepodařilo načíst. Zkus to prosím za chvíli znovu.</Note>
        ) : !hasPlayed ? (
          <Note>
            {league ? leagueDisplayName(league) : "Tato liga"} zatím nemá odehrané zápasy (mezisezóna) nebo pro
            ni nejsou dostupná data. Zkus jinou ligu.
          </Note>
        ) : (
          <>
            <StandingsTable rows={rows} />
            {table?.leagueAvg && (
              <p className="mt-2 text-xs text-muted">
                ⌀ liga {table.leagueAvg.goalsFor.toFixed(2)} gólů vstřelených / zápas
              </p>
            )}
            <ZoneLegend rows={rows} />
          </>
        )}
      </section>

      {hasPlayed && (round || scorers.scorers.length > 0 || scorers.assists.length > 0) && (
        <section className="mt-6 space-y-4">
          {round && (round.last.length > 0 || round.next.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {round.last.length > 0 && (
                <RoundList
                  title="Poslední odehrané zápasy"
                  leagueId={leagueId}
                  fixtures={round.last}
                />
              )}
              {round.next.length > 0 && (
                <RoundList
                  title="Nejbližší zápasy"
                  leagueId={leagueId}
                  fixtures={round.next}
                />
              )}
            </div>
          )}
          {(scorers.scorers.length > 0 || scorers.assists.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <LeagueScorerList title="Nejlepší střelci" unit="gólů" players={scorers.scorers} />
              <LeagueScorerList
                title="Nejlepší nahrávky"
                unit="asistencí"
                players={scorers.assists}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function RoundList({
  title,
  leagueId,
  fixtures,
}: {
  title: string;
  leagueId: number;
  fixtures: RoundFixture[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <ul className="space-y-1.5 text-xs">
        {fixtures.map((f) => {
          const href = buildCompareHref({
            compareMode: "CLUB",
            home: { id: f.home.id },
            away: { id: f.away.id },
            homeCompareLeagueId: leagueId,
            awayCompareLeagueId: leagueId,
          });
          const played = f.homeGoals != null && f.awayGoals != null;
          const inner = (
            <div className="flex items-center gap-1.5">
              <TeamLogo src={f.home.logoUrl} alt={f.home.name} size={16} />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {f.home.name}
              </span>
              {played ? (
                <span className="shrink-0 font-bold tabular-nums text-foreground">
                  {f.homeGoals}:{f.awayGoals}
                </span>
              ) : (
                <span className="shrink-0 text-muted">
                  {new Date(f.kickoff).toLocaleDateString("cs-CZ", {
                    day: "numeric",
                    month: "numeric",
                  })}
                </span>
              )}
              <TeamLogo src={f.away.logoUrl} alt={f.away.name} size={16} />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {f.away.name}
              </span>
            </div>
          );
          return (
            <li key={f.fixtureId}>
              {href ? (
                <Link href={href} className="block rounded transition hover:bg-background">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LeaguePicker({
  selected,
  onSelect,
}: {
  selected: number;
  onSelect: (id: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Zajisti, že aktivní liga je vidět v horizontálním pásku (po obnově z localStorage).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selected]);

  return (
    <div className="mt-4 -mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-2 pb-1">
        {CLUB_LEAGUES.map((l) => {
          const active = l.id === selected;
          return (
            <button
              key={l.id}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(l.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-home bg-home/10 text-foreground"
                  : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              <TeamLogo src={l.logoUrl} alt={l.name} size={18} />
              <span className="whitespace-nowrap">{leagueDisplayName(l)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface p-3 shadow-sm">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-4 w-4 animate-pulse rounded bg-border" />
          <div className="h-5 w-5 animate-pulse rounded-full bg-border" />
          <div className="h-4 flex-1 animate-pulse rounded bg-border" />
          <div className="h-4 w-8 animate-pulse rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted shadow-sm">
      {children}
    </div>
  );
}
