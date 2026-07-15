"use client";

import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { TeamLogo } from "./TeamLogo";
import { CLUB_LEAGUES } from "@/lib/data/catalog";
import type { LeagueTable, LeagueTableRow, LeagueTableZone } from "@/lib/types";
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

function StandingsTable({ rows }: { rows: LeagueTableRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
            <Th className="pl-3 text-left">#</Th>
            <Th className="text-left">Tým</Th>
            <Th title="Odehráno">Z</Th>
            <Th className="hidden sm:table-cell" title="Výhry">V</Th>
            <Th className="hidden sm:table-cell" title="Remízy">R</Th>
            <Th className="hidden sm:table-cell" title="Prohry">P</Th>
            <Th title="Skóre">Skóre</Th>
            <Th title="Rozdíl skóre">+/-</Th>
            <Th className="pr-3" title="Body">B</Th>
            <Th className="hidden md:table-cell pr-3" title="Forma (posl. 5)">Forma</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.teamId}
              className="border-b border-border/60 last:border-0"
            >
              <td className="py-2 pl-3">
                <span className="flex items-center gap-1.5">
                  <ZoneBar zone={r.zone} />
                  <span className="w-5 text-right font-semibold tabular-nums text-foreground">
                    {r.rank}
                  </span>
                </span>
              </td>
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <TeamLogo src={r.logoUrl} alt={r.name} size={22} />
                  <span className="truncate font-medium text-foreground">{r.name}</span>
                </span>
              </td>
              <Td>{r.played}</Td>
              <Td className="hidden sm:table-cell">{r.win}</Td>
              <Td className="hidden sm:table-cell">{r.draw}</Td>
              <Td className="hidden sm:table-cell">{r.lose}</Td>
              <Td className="whitespace-nowrap">
                {r.goalsFor}:{r.goalsAgainst}
              </Td>
              <Td
                className={
                  r.goalsDiff > 0
                    ? "text-positive"
                    : r.goalsDiff < 0
                      ? "text-negative"
                      : ""
                }
              >
                {r.goalsDiff > 0 ? `+${r.goalsDiff}` : r.goalsDiff}
              </Td>
              <td className="py-2 pr-3 text-center font-bold tabular-nums text-foreground">
                {r.points}
              </td>
              <td className="hidden py-2 pr-3 md:table-cell">
                <FormBadges form={r.form} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`px-1.5 py-2 text-center font-medium ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-1.5 py-2 text-center tabular-nums text-muted ${className}`}>
      {children}
    </td>
  );
}

const ZONE_META: Record<
  LeagueTableZone,
  { bar: string; label: string }
> = {
  champions: { bar: "bg-home", label: "Liga mistrů" },
  europa: { bar: "bg-away", label: "Evropská liga" },
  conference: { bar: "bg-positive", label: "Konferenční liga" },
  promotion: { bar: "bg-positive", label: "Postup" },
  relegation: { bar: "bg-negative", label: "Sestup" },
};

function ZoneBar({ zone }: { zone: LeagueTableZone | null }) {
  return (
    <span
      aria-hidden
      className={`h-4 w-1 shrink-0 rounded-full ${zone ? ZONE_META[zone].bar : "bg-transparent"}`}
    />
  );
}

function ZoneLegend({ rows }: { rows: LeagueTableRow[] }) {
  // Deduplikace podle popisku (KL i postup sdílí barvu, ale jiný text).
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.zone) seen.set(ZONE_META[r.zone].label, ZONE_META[r.zone].bar);
  }
  if (seen.size === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {[...seen.entries()].map(([label, bar]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`h-3 w-1 rounded-full ${bar}`} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

function FormBadges({ form }: { form: string | null }) {
  if (!form) return <span className="text-xs text-muted">—</span>;
  // API vrací nejnovější vpravo; zobraz posledních 5.
  const letters = form.slice(-5).split("");
  return (
    <span className="flex items-center justify-end gap-0.5">
      {letters.map((c, i) => {
        const color =
          c === "W"
            ? "bg-positive/15 text-positive"
            : c === "L"
              ? "bg-negative/15 text-negative"
              : "bg-border text-muted";
        return (
          <span
            key={i}
            className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${color}`}
          >
            {c === "W" ? "V" : c === "L" ? "P" : "R"}
          </span>
        );
      })}
    </span>
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
