"use client";

import { useCallback, useEffect, useState } from "react";
import type { MatchPick } from "@/lib/types";
import { AppHeader } from "./AppHeader";
import { ProLock } from "./ProLock";
import { PickRow } from "./PickRow";
import type { SessionUser } from "./sessionUser";

interface DigestSetters {
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setLocked: (v: boolean) => void;
  setPicks: (v: MatchPick[] | null) => void;
}

// Mimo komponentu (vzor CompareApp/PicksApp): žádné synchronní setState přímo v efektu.
async function loadDigest(
  isActive: () => boolean,
  { setLoading, setError, setLocked, setPicks }: DigestSetters
): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const r = await fetch("/api/digest");
    const d = await r.json();
    if (!isActive()) return;
    if (d.locked) {
      setLocked(true);
      setPicks(null);
    } else if (!r.ok || d.error) {
      throw new Error(d.error ?? "Chyba digestu");
    } else {
      setLocked(false);
      setPicks(d.picks ?? []);
    }
  } catch (e) {
    if (isActive()) setError(e instanceof Error ? e.message : "Chyba digestu");
  } finally {
    if (isActive()) setLoading(false);
  }
}

/**
 * Týdenní digest = top value tipy nejbližších dní (PRO). Čte předpočítané predikce
 * z DB přes `/api/digest` (nejvyšší edge napříč trhy). Sdílí `PickRow` s tipovací
 * záložkou; FREE/anonym → `ProLock` místo seznamu. Mobile-first.
 */
export function DigestApp({ user }: { user: SessionUser | null }) {
  const [picks, setPicks] = useState<MatchPick[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(() => {
    void loadDigest(() => true, { setLoading, setError, setLocked, setPicks });
  }, []);

  useEffect(() => {
    let active = true;
    void loadDigest(() => active, { setLoading, setError, setLocked, setPicks });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/", label: "Zápasy", emoji: "📅" },
          { href: "/predikce", label: "Tipy", emoji: "🎯" },
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/tabulky", label: "Tabulky", emoji: "📊" },
          { href: "/hra", label: "Hra", emoji: "🎮" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Value tipy týdne</h1>
      <p className="mt-1 text-sm text-muted">
        Nejvýhodnější tipy nejbližších 7 dní – zápasy, kde má náš model největší hranu
        nad kurzem sázkovky (edge). Seřazeno od největší hrany.
      </p>

      {locked ? (
        <div className="mt-4">
          <ProLock user={user} trialAvailable={false} onUnlockTrial={() => {}} unlocking={false} />
        </div>
      ) : loading && !picks ? (
        <DigestSkeleton />
      ) : error ? (
        <Empty>
          <p>{error}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-3 rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground transition hover:bg-background"
          >
            ↻ Zkusit znovu
          </button>
        </Empty>
      ) : picks && picks.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {picks.map((p) => (
            <PickRow key={p.fixtureId} pick={p} />
          ))}
        </ul>
      ) : (
        <Empty>
          Tento týden nemáme žádný value tip (kurz výhodnější než náš odhad). Kurzy se plní
          klubovým ligám blízko výkopu – mimo sezónu nebo daleko před zápasy je tu prázdno.
        </Empty>
      )}
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function DigestSkeleton() {
  return (
    <div className="mt-4 space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-xl bg-border/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
