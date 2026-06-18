"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClubTransferBalance, Transfer } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { ProLock } from "./ProLock";
import type { SessionUser } from "./sessionUser";

interface LeagueLite {
  id: number;
  name: string;
}

type Tab = "transfers" | "balance";

interface TransfersResponse {
  transfers?: Transfer[];
  balances?: ClubTransferBalance[];
  balancesLocked?: boolean;
  error?: string;
}

/** Kompaktní částka v EUR po česku: „20 mil. €", „500 tis. €". */
function fmtEur(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)} mil. €`;
  if (a >= 1e3) return `${Math.round(a / 1e3)} tis. €`;
  return `${a} €`;
}

/** Bilance se znaménkem (− = čistá investice, + = čistý výdělek). */
function fmtNet(n: number): string {
  if (n === 0) return "0 €";
  return `${n < 0 ? "−" : "+"}${fmtEur(n)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}

interface TransfersSetters {
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setTransfers: (v: Transfer[] | null) => void;
  setBalances: (v: ClubTransferBalance[] | null) => void;
  setBalancesLocked: (v: boolean) => void;
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
    s.setTransfers(d.transfers ?? []);
    s.setBalances(d.balances ?? null);
    s.setBalancesLocked(Boolean(d.balancesLocked));
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
  const [tab, setTab] = useState<Tab>("transfers");

  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [balances, setBalances] = useState<ClubTransferBalance[] | null>(null);
  const [balancesLocked, setBalancesLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadTransfers(selected, () => active, {
      setLoading,
      setError,
      setTransfers,
      setBalances,
      setBalancesLocked,
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
        Aktuální přestupy top-5 evropských lig a bilance nákupů a prodejů klubů.
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

      {/* Přepínač sekcí */}
      <div className="mt-4 inline-flex rounded-full border border-border bg-surface p-0.5 text-sm">
        <TabButton active={tab === "transfers"} onClick={() => setTab("transfers")}>
          Přestupy
        </TabButton>
        <TabButton active={tab === "balance"} onClick={() => setTab("balance")}>
          Bilance klubů
        </TabButton>
      </div>

      {loading && !transfers ? (
        <Skeleton />
      ) : error ? (
        <Empty>{error}</Empty>
      ) : tab === "transfers" ? (
        <TransferList transfers={transfers ?? []} />
      ) : balancesLocked ? (
        <div className="mt-4">
          <ProLock user={user} trialAvailable={false} onUnlockTrial={() => {}} unlocking={false} />
        </div>
      ) : (
        <BalanceTable balances={balances ?? []} transfers={transfers ?? []} />
      )}
    </main>
  );
}

function TabButton({
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

function TransferList({ transfers }: { transfers: Transfer[] }) {
  if (transfers.length === 0) {
    return (
      <Empty>
        Žádné aktuální přestupy. Mimo přestupní okno (typicky mimo leden a léto) bývá
        seznam prázdný – zkus jinou ligu nebo se vrať během okna.
      </Empty>
    );
  }
  return (
    <ul className="mt-4 space-y-2">
      {transfers.map((t) => (
        <li
          key={`${t.playerId}:${t.date}:${t.inTeamId}:${t.outTeamId}`}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {t.playerName}
            </span>
            <span className="shrink-0 text-[11px] text-muted">{fmtDate(t.date)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <TeamLogo src={t.outTeamLogo ?? undefined} alt={t.outTeamName ?? "?"} size={16} />
            <span className="min-w-0 truncate">{t.outTeamName ?? "—"}</span>
            <span aria-hidden className="shrink-0">→</span>
            <TeamLogo src={t.inTeamLogo ?? undefined} alt={t.inTeamName ?? "?"} size={16} />
            <span className="min-w-0 truncate">{t.inTeamName ?? "—"}</span>
            <span className="ml-auto shrink-0 font-semibold text-foreground">
              {t.feeEur != null ? fmtEur(t.feeEur) : (t.type ?? "—")}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BalanceTable({
  balances,
  transfers,
}: {
  balances: ClubTransferBalance[];
  transfers: Transfer[];
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (balances.length === 0) {
    return <Empty>Pro vybrané ligy zatím nemáme data o přestupech.</Empty>;
  }
  return (
    <>
      <p className="mt-4 text-[11px] text-muted">
        Bilance dle dostupných částek (zdroj často neuvádí přesnou cenu – počty jsou úplné,
        částky orientační). Klikni na klub pro detail.
      </p>
      <div className="mt-2 space-y-2">
        {balances.map((b) => {
          const open = expanded === b.teamId;
          const clubTransfers = transfers.filter(
            (t) => t.inTeamId === b.teamId || t.outTeamId === b.teamId
          );
          return (
            <div key={b.teamId} className="rounded-xl border border-border bg-surface shadow-sm">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : b.teamId)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                <TeamLogo src={b.teamLogo ?? undefined} alt={b.teamName} size={22} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {b.teamName}
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  ↓{b.inCount} ↑{b.outCount}
                </span>
                <span
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    b.netEur < 0 ? "text-negative" : b.netEur > 0 ? "text-positive" : "text-muted"
                  }`}
                >
                  {fmtNet(b.netEur)}
                </span>
                <span aria-hidden className="shrink-0 text-muted">
                  {open ? "▾" : "▸"}
                </span>
              </button>
              {open && (
                <div className="border-t border-border px-3 py-2">
                  <div className="mb-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                    <MiniStat label="Příchody" value={String(b.inCount)} />
                    <MiniStat label="Odchody" value={String(b.outCount)} />
                    <MiniStat
                      label="Výdaje / příjmy"
                      value={`${fmtEur(b.spendEur)} / ${fmtEur(b.earnEur)}`}
                    />
                  </div>
                  <ul className="space-y-1 text-xs">
                    {clubTransfers.map((t) => {
                      const incoming = t.inTeamId === b.teamId;
                      return (
                        <li
                          key={`${t.playerId}:${t.date}:${t.inTeamId}:${t.outTeamId}`}
                          className="flex items-center gap-1.5"
                        >
                          <span
                            className={`shrink-0 font-bold ${
                              incoming ? "text-positive" : "text-negative"
                            }`}
                          >
                            {incoming ? "IN" : "OUT"}
                          </span>
                          <span className="min-w-0 truncate text-foreground">{t.playerName}</span>
                          <span className="min-w-0 truncate text-muted">
                            {incoming ? `← ${t.outTeamName ?? "—"}` : `→ ${t.inTeamName ?? "—"}`}
                          </span>
                          <span className="ml-auto shrink-0 text-muted">
                            {t.feeEur != null ? fmtEur(t.feeEur) : (t.type ?? "—")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background p-1.5">
      <div className="font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
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
          className="h-14 animate-pulse rounded-xl bg-border/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
