"use client";

import type { CategoryScore, LeagueGoalsAvg } from "@/lib/types";
import { TeamHeading } from "./TeamHeading";

/**
 * Agregovaná pohled na 5 kategorií (Útok, Obrana, Hra s míčem, Tvorba šancí, Disciplína).
 * Každá kategorie je zobrazena jako duální bar (0–10) s volitelnou referenční čárou
 * ligového průměru u kategorií Útok a Obrana.
 */
export function CategoryScores({
  scores,
  homeName,
  awayName,
  homeLogo,
  awayLogo,
  leagueAvg,
}: {
  scores: CategoryScore[];
  homeName: string;
  awayName: string;
  homeLogo: string;
  awayLogo: string;
  leagueAvg?: LeagueGoalsAvg | null;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <TeamHeading name={homeName} logo={homeLogo} accent="home" />
        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Kategorie
        </span>
        <TeamHeading name={awayName} logo={awayLogo} accent="away" alignRight />
      </div>

      <div className="divide-y divide-border">
        {scores.map((cat) => (
          <CategoryRow
            key={cat.key}
            cat={cat}
            leagueAvg={
              cat.key === "attack"
                ? leagueAvg?.goalsFor ?? null
                : cat.key === "defense"
                  ? leagueAvg?.goalsAgainst ?? null
                  : null
            }
          />
        ))}
      </div>

    </section>
  );
}

function CategoryRow({
  cat,
  leagueAvg,
}: {
  cat: CategoryScore;
  leagueAvg: number | null;
}) {
  const { homeScore, awayScore, available, lowConfidence } = cat;
  const total = homeScore + awayScore;
  const homeShare = total > 0 ? (homeScore / total) * 100 : 50;
  const awayShare = 100 - homeShare;

  const better =
    !available || homeScore === awayScore
      ? null
      : homeScore > awayScore
        ? "home"
        : "away";

  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between text-sm tabular-nums">
        <Score value={available ? homeScore : null} low={lowConfidence} highlight={better === "home"} accent="home" />
        <span className="flex min-w-0 flex-1 items-center justify-center px-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          <span className="truncate">{cat.label}</span>
          {!available && (
            <span className="ml-1 shrink-0 text-muted/60" title="Nedostatek dat pro tento mód">
              —
            </span>
          )}
        </span>
        <Score value={available ? awayScore : null} low={lowConfidence} highlight={better === "away"} accent="away" alignRight />
      </div>

      <div className="relative mt-1.5 flex h-2 overflow-hidden rounded-full bg-border/60">
        {available ? (
          <>
            <div className="bar-fill bg-home/80" style={{ width: `${homeShare}%` }} />
            <div className="bar-fill bg-away/80" style={{ width: `${awayShare}%` }} />
          </>
        ) : (
          <div className="w-full opacity-30" />
        )}
      </div>

      {leagueAvg !== null && available && (
        <p className="mt-1 text-right text-[10px] text-muted">
          ⌀ liga {leagueAvg.toFixed(2)} gólů/zápas
        </p>
      )}
    </div>
  );
}

function Score({
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
      className={`w-10 ${alignRight ? "text-right" : "text-left"} text-base font-bold ${
        highlight ? color : "text-foreground"
      } ${low ? "opacity-60" : ""}`}
      title={low ? "Nízká spolehlivost (malý vzorek zápasů)" : undefined}
    >
      {value == null ? "—" : value.toFixed(1)}
      {low && value != null ? "*" : ""}
    </span>
  );
}

