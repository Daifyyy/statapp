"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

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

  // Udrž zvýrazněnou položku ve viditelné části seznamu.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function select(id: number) {
    onChange(id);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function close() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = filtered[activeIndex];
      if (t) select(t.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const activeId =
    open && filtered[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setActiveIndex(0);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-left text-base transition ${ringFocus}`}
      >
        <TeamLogo src={selected?.logoUrl} alt={selected?.name ?? ""} size={24} />
        <span className={`flex-1 truncate ${selected ? "" : "text-muted"}`}>
          {selected?.name ?? "Vyber tým…"}
        </span>
        <span className="text-muted" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Hledat…"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            className="w-full border-b border-border bg-background px-3 py-2 text-base outline-none"
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-60 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted">Nic nenalezeno</li>
            )}
            {filtered.map((t, idx) => {
              const active = idx === activeIndex;
              return (
                <li
                  key={t.id}
                  id={`${listId}-opt-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={t.id === value}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => select(t.id)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      active ? "bg-background" : "hover:bg-background"
                    } ${t.id === value ? "font-semibold" : ""}`}
                  >
                    <TeamLogo src={t.logoUrl} alt={t.name} size={20} />
                    <span className="truncate">{t.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
