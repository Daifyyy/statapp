"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClubTransferBalance, Transfer, TransferCategory } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { ProLock } from "./ProLock";
import type { SessionUser } from "./sessionUser";

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

/** Počty pro aktuální filtr: jen trvalé vs. všechny typy. */
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

export function TransfersApp({
  user,
  leagues,
}: {
  user: SessionUser | null;
  leagues: LeagueLite[];
}) {
  const allIds = useMemo(() => leagues.map((l) => l.id), [leagues]);
  const [selected, setSelected] = useState<number[]>(allIds);
  const [showAll, setShowAll] = useState(false); // default: jen trvalé přestupy

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

  // Kluby s aktivitou v aktuálním filtru, řazené dle počtu přestupů.
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
          { href: "/", label: "Porovnání", emoji: "⇄" },
          { href: "/predikce", label: "Tipy", emoji: "📈" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Přestupy</h1>
      <p className="mt-1 text-sm text-muted">
        Přehled podle klubů top-5 lig za aktuální přestupové období. Klikni na klub pro detail.
      </p>

      {/* Filtr lig – chips (mobile-first, žádný nativní multiselect → bez zoomu/shiftu) */}
      <div className="mt-4 flex flex-wrap gap-2">
        {leagues.map((l) => {
          const active = selected.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggleLeague(l.id)}
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

      {/* Přepínač rozsahu: jen trvalé vs. vše */}
      <div className="mt-3 inline-flex rounded-full border border-border bg-surface p-0.5 text-sm">
        <Pill active={!showAll} onClick={() => setShowAll(false)}>
          Jen trvalé
        </Pill>
        <Pill active={showAll} onClick={() => setShowAll(true)}>
          Vše (i hostování)
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
        <Empty>
          {showAll
            ? "Za aktuální přestupové období nemáme pro vybrané ligy žádné přestupy. Mimo přestupní okno (typicky mimo leden a léto) bývá prázdno."
            : "Žádné trvalé přestupy v aktuálním období. Zkus přepnout na „Vše“ (hostování) nebo jinou ligu."}
        </Empty>
      ) : (
        <ul className="mt-4 space-y-2">
          {clubs.map(({ b, inN, outN }) => (
            <ClubRow
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

function ClubRow({
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

  const header = (
    <>
      <TeamLogo src={b.teamLogo ?? undefined} alt={b.teamName} size={22} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {b.teamName}
      </span>
      <span className="shrink-0 text-sm tabular-nums">
        <span className="font-bold text-positive">↓{inN}</span>{" "}
        <span className="text-muted">/</span>{" "}
        <span className="font-bold text-negative">↑{outN}</span>
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
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {t.playerName}
                    </span>
                    <span className="min-w-0 max-w-[40%] shrink-0 truncate text-right text-muted">
                      {incoming ? "← " : "→ "}
                      {counterpart ?? "—"}
                    </span>
                    <span className="hidden shrink-0 text-[10px] text-muted sm:inline">
                      {CATEGORY_LABELS[t.category]}
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
