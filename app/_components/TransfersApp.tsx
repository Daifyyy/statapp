"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClubTransferBalance, Transfer, TransferCategory } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { ProLock } from "./ProLock";
import type { SessionUser } from "./sessionUser";

/**
 * Režim záložky. "category" = aktuální (počty příchodů/odchodů po typech z API-Footballu;
 * zdroj je aktuálnější, ale nemá ceny). "money" = předchozí řešení (peněžní bilance z
 * Transfermarkt datasetu) – ponecháno jako mrtvý kód pro případný návrat (přepnout sem
 * a vrátit zdroj dat = cron import-transfers + MODE). Viz CLAUDE.md.
 */
const MODE: "money" | "category" = "category";

interface LeagueLite {
  id: number;
  name: string;
}

interface TransfersResponse {
  balances?: ClubTransferBalance[];
  transfers?: Transfer[];
  detailLocked?: boolean;
  error?: string;
}

const CATEGORY_LABELS: Record<TransferCategory, string> = {
  permanent: "Trvalý přestup",
  loan: "Hostování",
  loanReturn: "Návrat z hostování",
  free: "Volný hráč",
  other: "Ostatní",
};

/** Kompaktní částka v EUR: „20 mil. €", „500 tis. €". */
function fmtEur(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)} mil. €`;
  if (a >= 1e3) return `${Math.round(a / 1e3)} tis. €`;
  return `${a} €`;
}

/** Čistá bilance se znaménkem (− = víc utratil, + = víc vydělal). */
function fmtNet(n: number): string {
  if (n === 0) return "0 €";
  return `${n < 0 ? "−" : "+"}${fmtEur(n)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

/** Počty pro aktuální filtr: jen placené/trvalé (permanent) vs všechny typy. */
function scopeCounts(b: ClubTransferBalance, showAll: boolean) {
  return showAll
    ? { inN: b.inCount, outN: b.outCount }
    : { inN: b.inByCategory.permanent, outN: b.outByCategory.permanent };
}

interface TransfersSetters {
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setBalances: (v: ClubTransferBalance[] | null) => void;
  setTransfers: (v: Transfer[] | null) => void;
  setLocked: (v: boolean) => void;
}

// Mimo komponentu (vzor PicksApp): žádné synchronní setState přímo v těle efektu.
async function loadTransfers(
  selected: number[],
  isActive: () => boolean,
  s: TransfersSetters
): Promise<void> {
  s.setLoading(true);
  s.setError(null);
  try {
    const q = selected.length ? `?leagues=${selected.join(",")}` : "";
    const r = await fetch(`/api/transfers${q}`);
    const d = (await r.json()) as TransfersResponse;
    if (!r.ok || d.error) throw new Error(d.error ?? "Chyba přestupů");
    if (!isActive()) return;
    s.setBalances(d.balances ?? []);
    s.setTransfers(d.transfers ?? null);
    s.setLocked(Boolean(d.detailLocked));
  } catch (e) {
    if (isActive()) s.setError(e instanceof Error ? e.message : "Chyba přestupů");
  } finally {
    if (isActive()) s.setLoading(false);
  }
}

/** Sdílený stav + chrome (hlavička, filtr lig, přepínač, načítání). */
function useTransfersData(leagues: LeagueLite[]) {
  const allIds = useMemo(() => leagues.map((l) => l.id), [leagues]);
  const [selected, setSelected] = useState<number[]>(allIds);
  const [balances, setBalances] = useState<ClubTransferBalance[] | null>(null);
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadTransfers(selected, () => active, {
      setLoading,
      setError,
      setBalances,
      setTransfers,
      setLocked,
    });
    return () => {
      active = false;
    };
  }, [selected]);

  function toggleLeague(id: number) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return next.length ? next : prev; // nedovol prázdný výběr
    });
  }

  return { selected, toggleLeague, balances, transfers, locked, loading, error };
}

export function TransfersApp(props: { user: SessionUser | null; leagues: LeagueLite[] }) {
  return MODE === "money" ? <MoneyView {...props} /> : <CategoryView {...props} />;
}

// ───────────────────────── Money view (aktivní) ─────────────────────────

function MoneyView({ user, leagues }: { user: SessionUser | null; leagues: LeagueLite[] }) {
  const { selected, toggleLeague, balances, transfers, locked, loading, error } =
    useTransfersData(leagues);
  const [paidOnly, setPaidOnly] = useState(true); // default: jen placené přestupy

  const clubs = useMemo(() => {
    return (balances ?? [])
      .map((b) => ({ b, ...scopeCounts(b, !paidOnly) }))
      .filter((x) => x.inN + x.outN > 0)
      .sort((a, b) => a.b.netEur - b.b.netEur); // největší investor (nejzápornější net) první
  }, [balances, paidOnly]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/", label: "Zápasy", emoji: "📅" },
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/tabulky", label: "Tabulky", emoji: "📊" },
          { href: "/predikce", label: "Predikce", emoji: "🎯" },
          { href: "/hra", label: "Hra", emoji: "🎮" },
          { href: "/tipovacka", label: "Tipovačka", emoji: "🎲" },
        ]}
      />
      <h1 className="mt-4 text-lg font-semibold text-foreground">Přestupy</h1>
      <p className="mt-1 text-sm text-muted">
        Bilance nákupů a prodejů klubů top-5 lig za aktuální přestupové období (ceny z Transfermarktu).
      </p>

      <LeagueChips leagues={leagues} selected={selected} onToggle={toggleLeague} />

      <div className="mt-3 inline-flex rounded-full border border-border bg-surface p-0.5 text-sm">
        <Pill active={paidOnly} onClick={() => setPaidOnly(true)}>
          Jen placené
        </Pill>
        <Pill active={!paidOnly} onClick={() => setPaidOnly(false)}>
          Vše
        </Pill>
      </div>

      {locked && (
        <div className="mt-4">
          <ProLock user={user} trialAvailable={false} onUnlockTrial={() => {}} unlocking={false} />
          <p className="mt-2 text-center text-[11px] text-muted">
            Přehled a bilance jsou zdarma; detail (kteří hráči a za kolik) je součástí PRO.
          </p>
        </div>
      )}

      {loading && !balances ? (
        <Skeleton />
      ) : error ? (
        <Empty>{error}</Empty>
      ) : clubs.length === 0 ? (
        <Empty>
          {paidOnly
            ? "Za aktuální období nejsou žádné placené přestupy našich klubů. Zkus „Vše“ nebo jinou ligu (zimní okno bývá chudé, hlavní dění je v létě)."
            : "Za aktuální přestupové období nemáme pro vybrané ligy přestupy."}
        </Empty>
      ) : (
        <ul className="mt-4 space-y-2">
          {clubs.map(({ b, inN, outN }) => (
            <MoneyClubRow
              key={b.teamId}
              balance={b}
              inN={inN}
              outN={outN}
              paidOnly={paidOnly}
              transfers={transfers}
              expandable={!locked}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function MoneyClubRow({
  balance: b,
  inN,
  outN,
  paidOnly,
  transfers,
  expandable,
}: {
  balance: ClubTransferBalance;
  inN: number;
  outN: number;
  paidOnly: boolean;
  transfers: Transfer[] | null;
  expandable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clubTransfers = useMemo(() => {
    if (!transfers) return [];
    return transfers.filter(
      (t) =>
        (t.inTeamId === b.teamId || t.outTeamId === b.teamId) &&
        (!paidOnly || (t.feeEur ?? 0) > 0)
    );
  }, [transfers, b.teamId, paidOnly]);

  const header = (
    <>
      <TeamLogo src={b.teamLogo ?? undefined} alt={b.teamName} size={22} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{b.teamName}</div>
        <div className="text-[11px] text-muted">
          nákupy {fmtEur(b.spendEur)} · prodeje {fmtEur(b.earnEur)} · ↓{inN}/↑{outN}
        </div>
      </div>
      <span
        className={`shrink-0 text-sm font-bold tabular-nums ${
          b.netEur < 0 ? "text-negative" : b.netEur > 0 ? "text-positive" : "text-muted"
        }`}
      >
        {fmtNet(b.netEur)}
      </span>
      {expandable && (
        <span aria-hidden className="shrink-0 text-muted">
          {open ? "▾" : "▸"}
        </span>
      )}
    </>
  );

  return (
    <li className="rounded-xl border border-border bg-surface shadow-sm">
      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        >
          {header}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 px-3 py-2.5">{header}</div>
      )}

      {expandable && open && (
        <div className="border-t border-border px-3 py-2">
          {clubTransfers.length === 0 ? (
            <p className="py-1 text-center text-xs text-muted">Žádné přestupy v tomto rozsahu.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {clubTransfers.map((t) => {
                const incoming = t.inTeamId === b.teamId;
                const counterpart = incoming ? t.outTeamName : t.inTeamName;
                return (
                  <li
                    key={`${t.playerId}:${t.date}:${t.inTeamId}:${t.outTeamId}`}
                    className="flex items-center gap-1.5"
                  >
                    <span
                      className={`w-7 shrink-0 text-center font-bold ${
                        incoming ? "text-positive" : "text-negative"
                      }`}
                    >
                      {incoming ? "IN" : "OUT"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{t.playerName}</span>
                    <span className="min-w-0 max-w-[30%] shrink-0 truncate text-right text-muted">
                      {incoming ? "← " : "→ "}
                      {counterpart ?? "—"}
                    </span>
                    <span className="w-16 shrink-0 text-right font-medium tabular-nums text-foreground">
                      {t.feeEur && t.feeEur > 0 ? fmtEur(t.feeEur) : "—"}
                    </span>
                    <span className="hidden w-10 shrink-0 text-right text-[10px] tabular-nums text-muted sm:inline">
                      {fmtDate(t.date)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ───────────────── Category view (mrtvý kód – předchozí řešení) ─────────────────

function CategoryView({ user, leagues }: { user: SessionUser | null; leagues: LeagueLite[] }) {
  const { selected, toggleLeague, balances, transfers, locked, loading, error } =
    useTransfersData(leagues);
  const [showAll, setShowAll] = useState(false);

  const clubs = useMemo(() => {
    return (balances ?? [])
      .map((b) => ({ b, ...scopeCounts(b, showAll) }))
      .filter((x) => x.inN + x.outN > 0)
      .sort((a, b) => b.inN + b.outN - (a.inN + a.outN));
  }, [balances, showAll]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/", label: "Zápasy", emoji: "📅" },
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/tabulky", label: "Tabulky", emoji: "📊" },
          { href: "/predikce", label: "Predikce", emoji: "🎯" },
          { href: "/hra", label: "Hra", emoji: "🎮" },
          { href: "/tipovacka", label: "Tipovačka", emoji: "🎲" },
        ]}
      />
      <h1 className="mt-4 text-lg font-semibold text-foreground">Přestupy</h1>
      <p className="mt-1 text-sm text-muted">
        Příchody a odchody klubů top-5 lig za aktuální přestupové období podle typu přestupu
        (trvalý / hostování / volný hráč).
      </p>
      <LeagueChips leagues={leagues} selected={selected} onToggle={toggleLeague} />
      <div className="mt-3 inline-flex rounded-full border border-border bg-surface p-0.5 text-sm">
        <Pill active={!showAll} onClick={() => setShowAll(false)}>
          Jen trvalé
        </Pill>
        <Pill active={showAll} onClick={() => setShowAll(true)}>
          Vše
        </Pill>
      </div>
      {locked && (
        <div className="mt-4">
          <ProLock user={user} trialAvailable={false} onUnlockTrial={() => {}} unlocking={false} />
          <p className="mt-2 text-center text-[11px] text-muted">
            Přehled počtů je zdarma; detail (kteří hráči) je součástí PRO.
          </p>
        </div>
      )}
      {loading && !balances ? (
        <Skeleton />
      ) : error ? (
        <Empty>{error}</Empty>
      ) : clubs.length === 0 ? (
        <Empty>Za aktuální období nemáme pro vybrané ligy přestupy.</Empty>
      ) : (
        <ul className="mt-4 space-y-2">
          {clubs.map(({ b, inN, outN }) => (
            <CategoryClubRow
              key={b.teamId}
              balance={b}
              inN={inN}
              outN={outN}
              showAll={showAll}
              transfers={transfers}
              expandable={!locked}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function CategoryClubRow({
  balance: b,
  inN,
  outN,
  showAll,
  transfers,
  expandable,
}: {
  balance: ClubTransferBalance;
  inN: number;
  outN: number;
  showAll: boolean;
  transfers: Transfer[] | null;
  expandable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clubTransfers = useMemo(() => {
    if (!transfers) return [];
    return transfers.filter(
      (t) =>
        (t.inTeamId === b.teamId || t.outTeamId === b.teamId) &&
        (showAll || t.category === "permanent")
    );
  }, [transfers, b.teamId, showAll]);

  return (
    <li className="rounded-xl border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <TeamLogo src={b.teamLogo ?? undefined} alt={b.teamName} size={22} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {b.teamName}
        </span>
        <span className="shrink-0 text-sm tabular-nums">
          <span className="font-bold text-positive">↓{inN}</span> /{" "}
          <span className="font-bold text-negative">↑{outN}</span>
        </span>
      </button>
      {expandable && open && (
        <div className="border-t border-border px-3 py-2">
          <ul className="space-y-1 text-xs">
            {clubTransfers.map((t) => {
              const incoming = t.inTeamId === b.teamId;
              return (
                <li
                  key={`${t.playerId}:${t.date}:${t.inTeamId}:${t.outTeamId}`}
                  className="flex items-center gap-1.5"
                >
                  <span className={incoming ? "text-positive" : "text-negative"}>
                    {incoming ? "IN" : "OUT"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{t.playerName}</span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {CATEGORY_LABELS[t.category]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

// ───────────────────────── sdílené prvky ─────────────────────────

function LeagueChips({
  leagues,
  selected,
  onToggle,
}: {
  leagues: LeagueLite[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {leagues.map((l) => {
        const active = selected.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onToggle(l.id)}
            aria-pressed={active}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 font-medium transition ${
        active ? "bg-foreground text-background" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-xl bg-border/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
