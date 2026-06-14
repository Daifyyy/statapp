"use client";

import { useCallback, useEffect, useState } from "react";
import type { CompareResult, EntityType } from "@/lib/types";

/** Oblíbené porovnání tak, jak ho vrací API (řádek SavedComparison). */
export interface SavedFavorite {
  id: string;
  mode: EntityType;
  homeTeamId: number;
  homeLeagueId: number;
  awayTeamId: number;
  awayLeagueId: number;
  label: string | null;
  snapshot: CompareResult;
  savedAt: string;
}

/** Aktuální výběr k uložení. */
export interface Selection {
  mode: EntityType;
  homeTeamId: number;
  homeLeagueId: number;
  awayTeamId: number;
  awayLeagueId: number;
}

/** Sekce oblíbených (PRO): uložit aktuální porovnání + seznam s načtením ze snapshotu. */
export function FavoritesSection({
  selection,
  result,
  onApply,
}: {
  selection: Selection | null;
  result: CompareResult | null;
  onApply: (fav: SavedFavorite) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SavedFavorite[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/favorites");
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.favorites ?? []);
    } catch {
      /* ticho – sekce jen nezobrazí položky */
    }
  }, []);

  // Načtení v efektu přes promise callback (setState až async → stejný vzor jako useTeams).
  useEffect(() => {
    let active = true;
    fetch("/api/favorites")
      .then((r) => (r.ok ? r.json() : { favorites: [] }))
      .then((d) => {
        if (active) setItems(d.favorites ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const canSave = selection != null && result != null && !result.locked;

  async function save() {
    if (!canSave || !selection || !result) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...selection,
          label: `${result.home.team.name} – ${result.away.team.name}`,
          snapshot: result,
        }),
      });
      if (!r.ok) throw new Error();
      setNote("Uloženo do oblíbených ✓");
      await load();
      setOpen(true);
    } catch {
      setNote("Uložení se nezdařilo");
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 2000);
    }
  }

  async function remove(id: string) {
    setItems((xs) => xs.filter((x) => x.id !== id)); // optimisticky
    try {
      await fetch(`/api/favorites/${id}`, { method: "DELETE" });
    } catch {
      void load(); // při chybě obnov pravdu ze serveru
    }
  }

  return (
    <section className="mt-3 rounded-2xl border border-border bg-surface p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm font-semibold text-foreground"
          aria-expanded={open}
        >
          ⭐ Oblíbená porovnání{" "}
          <span className="text-muted">({items.length})</span>
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave || busy}
          className="rounded-full bg-positive px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          title={canSave ? "Uložit aktuální porovnání" : "Nejdřív porovnej dva týmy"}
        >
          {busy ? "Ukládám…" : "Uložit toto porovnání"}
        </button>
      </div>

      {note && <p className="mt-2 text-xs text-muted">{note}</p>}

      {open && (
        <ul className="mt-3 space-y-1.5">
          {items.length === 0 && (
            <li className="text-sm text-muted">Zatím nic uloženého.</li>
          )}
          {items.map((fav) => (
            <li
              key={fav.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-background px-3 py-2"
            >
              <button
                type="button"
                onClick={() => onApply(fav)}
                className="min-w-0 flex-1 text-left text-sm text-foreground hover:underline"
                title="Zobrazit uloženou verzi"
              >
                <span className="truncate">
                  {fav.label ??
                    `${fav.snapshot.home.team.name} – ${fav.snapshot.away.team.name}`}
                </span>
                <span className="ml-2 text-xs text-muted">
                  {new Date(fav.savedAt).toLocaleDateString("cs-CZ")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(fav.id)}
                aria-label="Smazat"
                className="shrink-0 rounded-full px-2 py-1 text-muted transition hover:text-foreground"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
