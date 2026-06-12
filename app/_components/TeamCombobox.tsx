"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TeamLogo } from "./TeamLogo";

interface TeamLite {
  id: number;
  name: string;
  logoUrl: string;
}

/** Vyhledávací výběr týmu (combobox) – zvládá i ~54 reprezentací. */
export function TeamCombobox({
  teams,
  value,
  exclude,
  onChange,
  accent,
}: {
  teams: TeamLite[];
  value: number | null;
  exclude: number | null;
  onChange: (id: number) => void;
  accent: "home" | "away";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = teams.find((t) => t.id === value) ?? null;
  const ringFocus =
    accent === "home" ? "focus:border-home" : "focus:border-away";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = teams.filter((t) => t.id !== exclude);
    if (!q) return list;
    return list.filter((t) => t.name.toLowerCase().includes(q));
  }, [teams, exclude, query]);

  // Zavřít při kliknutí mimo.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function select(id: number) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-left text-base transition ${ringFocus}`}
      >
        <TeamLogo src={selected?.logoUrl} alt={selected?.name ?? ""} size={24} />
        <span className={`flex-1 truncate ${selected ? "" : "text-muted"}`}>
          {selected?.name ?? "Vyber tým…"}
        </span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat…"
            className="w-full border-b border-border bg-background px-3 py-2 text-base outline-none"
          />
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">Nic nenalezeno</li>
            )}
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => select(t.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-background ${
                    t.id === value ? "font-semibold" : ""
                  }`}
                >
                  <TeamLogo src={t.logoUrl} alt={t.name} size={20} />
                  <span className="truncate">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
