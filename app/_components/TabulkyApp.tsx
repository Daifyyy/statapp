"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { TeamLogo } from "./TeamLogo";
import { StandingsTable, ZoneLegend } from "./StandingsTable";
import { CLUB_LEAGUES } from "@/lib/data/catalog";
import type { LeagueTable } from "@/lib/types";
import type { SessionUser } from "./sessionUser";

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
export function TabulkyApp({ user }: { user: SessionUser | null }) {
  const [leagueId, setLeagueId] = useState(DEFAULT_LEAGUE);
  const [table, setTable] = useState<LeagueTable | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Po mountu obnov poslední zvolenou ligu (bez SSR hydration mismatchu).
  useEffect(() => {
    restoreLeague(setLeagueId);
  }, []);

  useEffect(() => {
    let active = true;
    void loadTable(leagueId, () => active, setTable, setStatus);
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
          { href: "/predikce", label: "Tipy", emoji: "📈" },
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
            {league?.name ?? "Tato liga"} zatím nemá odehrané zápasy (mezisezóna) nebo pro
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
    </main>
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
              <span className="whitespace-nowrap">{l.name}</span>
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
