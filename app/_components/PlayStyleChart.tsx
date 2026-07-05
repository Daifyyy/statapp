"use client";

import type { EntityType, PlayStyleDimension } from "@/lib/types";
import { TeamHeading } from "./TeamHeading";

/**
 * Vizualizace 4 stylových dimenzí (Kontrola míče, Styl útoku, Pressing, Efektivita).
 * Každá dimenze je zobrazena jako dva bary (domácí / host) na sdílené ose 0–10,
 * s popisem krajních hodnot (levý = 0, pravý = 10).
 */
export function PlayStyleChart({
  dimensions,
  homeName,
  awayName,
  homeLogo,
  awayLogo,
  mode,
}: {
  dimensions: PlayStyleDimension[];
  homeName: string;
  awayName: string;
  homeLogo: string;
  awayLogo: string;
  mode: EntityType;
}) {
  const hasUnavailable = dimensions.some((d) => !d.available);

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <TeamHeading name={homeName} logo={homeLogo} accent="home" />
        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Styl hry
        </span>
        <TeamHeading name={awayName} logo={awayLogo} accent="away" alignRight />
      </div>

      {/* Legenda */}
      <div className="mb-3 flex items-center gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-home/80" />
          {homeName}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded-sm bg-away/80" />
          {awayName}
        </span>
      </div>

      <div className="space-y-4">
        {dimensions.map((dim) => (
          <StyleDimRow key={dim.key} dim={dim} />
        ))}
      </div>

      {hasUnavailable && mode === "NATIONAL" && (
        <p className="mt-3 text-[10px] text-muted">
          * Omezená data pro reprezentace (POSSESSION, střely z vápna).
        </p>
      )}
    </section>
  );
}

function StyleDimRow({ dim }: { dim: PlayStyleDimension }) {
  const homeWidth = (dim.homeScore / 10) * 100;
  const awayWidth = (dim.awayScore / 10) * 100;

  return (
    <div>
      {/* Nadpis dimenze + krajní popisky */}
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
        <span>{dim.leftLabel}</span>
        <span className="font-medium uppercase tracking-wide text-foreground">
          {dim.label}
          {!dim.available && <span className="ml-1 text-muted/60">*</span>}
        </span>
        <span>{dim.rightLabel}</span>
      </div>

      {/* Bar domácích */}
      <div className="mb-1 flex items-center gap-2">
        <span className="w-7 shrink-0 text-right text-xs font-bold tabular-nums text-home">
          {dim.available ? dim.homeScore.toFixed(1) : "—"}
        </span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-border/60">
          {dim.available && (
            <div
              className="bar-fill h-full bg-home/80"
              style={{ width: `${homeWidth}%` }}
            />
          )}
        </div>
      </div>

      {/* Bar hostů */}
      <div className="flex items-center gap-2">
        <span className="w-7 shrink-0 text-right text-xs font-bold tabular-nums text-away">
          {dim.available ? dim.awayScore.toFixed(1) : "—"}
        </span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-border/60">
          {dim.available && (
            <div
              className="bar-fill h-full bg-away/80"
              style={{ width: `${awayWidth}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

