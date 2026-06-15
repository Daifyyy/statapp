"use client";

import { useState } from "react";
import type { MetricValue } from "@/lib/types";

/**
 * Řádek jedné metriky: hodnota domácích vlevo, host vpravo, mezi nimi dvojitý
 * bar. Po kliknutí rozbalí rozpad váženého průměru po oknech (Sezóna/L10/L5).
 */
export function MetricRow({
  label,
  hint,
  home,
  away,
  lowerIsBetter,
}: {
  label: string;
  hint?: string;
  home: MetricValue | null;
  away: MetricValue | null;
  lowerIsBetter: boolean;
}) {
  const [open, setOpen] = useState(false);
  const h = home?.value ?? null;
  const a = away?.value ?? null;
  const sum = (h ?? 0) + (a ?? 0);
  const homeShare = sum > 0 ? ((h ?? 0) / sum) * 100 : 50;
  const awayShare = 100 - homeShare;

  const better =
    h == null || a == null
      ? null
      : lowerIsBetter
        ? h < a
          ? "home"
          : a < h
            ? "away"
            : null
        : h > a
          ? "home"
          : a > h
            ? "away"
            : null;

  const breakdown = home?.breakdown ?? away?.breakdown ?? [];

  return (
    <div className="py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full"
        aria-expanded={open}
      >
        <div className="flex items-center justify-between text-sm tabular-nums">
          <Value value={h} low={home?.lowConfidence} highlight={better === "home"} accent="home" />
          <span className="flex items-center gap-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted">
            {label}
            {hint && (
              <span
                role="img"
                aria-label={hint}
                title={hint}
                className="cursor-help text-muted/70"
              >
                ⓘ
              </span>
            )}
            <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
          </span>
          <Value value={a} low={away?.lowConfidence} highlight={better === "away"} accent="away" alignRight />
        </div>
        <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-border/60">
          <div className="bar-fill bg-home/80" style={{ width: `${homeShare}%` }} />
          <div className="bar-fill bg-away/80" style={{ width: `${awayShare}%` }} />
        </div>
      </button>

      {open && breakdown.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg bg-background/60 p-2 text-xs tabular-nums">
          {breakdown.map((b, i) => (
            <div key={b.window} className="flex items-center justify-between">
              <span className="w-12 text-right font-semibold text-home">
                {fmt(home?.breakdown[i]?.value)}
              </span>
              <span className="flex-1 px-2 text-center text-muted">
                {b.label} · {Math.round(b.weight * 100)} %
              </span>
              <span className="w-12 font-semibold text-away">
                {fmt(away?.breakdown[i]?.value)}
              </span>
            </div>
          ))}
          <p className="pt-1 text-center text-[10px] text-muted">
            Chybějící okno se přepočítá mezi zbylá (vážený průměr).
          </p>
        </div>
      )}
    </div>
  );
}

function fmt(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(2);
}

function Value({
  value,
  low,
  highlight,
  accent,
  alignRight,
}: {
  value: number | null;
  low?: boolean;
  highlight?: boolean;
  accent: "home" | "away";
  alignRight?: boolean;
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  return (
    <span
      className={`w-14 ${alignRight ? "text-right" : "text-left"} font-bold ${
        highlight ? color : "text-foreground"
      } ${low ? "opacity-50" : ""}`}
      title={low ? "Nízká spolehlivost (malý vzorek zápasů)" : undefined}
    >
      {value == null ? "—" : value.toFixed(2)}
      {low && value != null ? "*" : ""}
    </span>
  );
}
