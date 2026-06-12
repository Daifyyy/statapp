"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

const ORDER: Theme[] = ["light", "dark", "system"];
const ICON: Record<Theme, string> = {
  light: "☀️",
  dark: "🌙",
  system: "🖥️",
};
const LABEL: Record<Theme, string> = {
  light: "Světlé téma",
  dark: "Tmavé téma",
  system: "Automatické (dle systému)",
};

const prefersDark = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Aplikuje téma třídou `dark` na <html> (system → dle OS). */
function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme !== "light" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

// Jednoduchý externí store nad localStorage + systémovým nastavením.
const subscribers = new Set<() => void>();
function emit() {
  subscribers.forEach((cb) => cb());
}
function subscribe(cb: () => void) {
  subscribers.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    applyTheme(getTheme()); // system režim → přebarvit dle OS
    cb();
  };
  mq.addEventListener("change", onChange);
  window.addEventListener("storage", cb);
  return () => {
    subscribers.delete(cb);
    mq.removeEventListener("change", onChange);
    window.removeEventListener("storage", cb);
  };
}
function getTheme(): Theme {
  return (localStorage.getItem("theme") as Theme) || "system";
}
function getServerTheme(): Theme {
  return "system";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    localStorage.setItem("theme", next);
    applyTheme(next);
    emit();
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={LABEL[theme]}
      title={LABEL[theme]}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-base transition hover:border-foreground/30"
    >
      <span suppressHydrationWarning aria-hidden>
        {ICON[theme]}
      </span>
    </button>
  );
}
