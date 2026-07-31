"use client";

import { useEffect, useState } from "react";
import type { SettledMatch } from "@/lib/types";
import type { MatchReport } from "@/lib/stats/matchReport";
import { Chip, DimensionBar } from "./MatchDimensionBar";

/**
 * Kategorický přehled odehraného zápasu ve Výsledcích – kdo dominoval, o jaký typ zápasu
 * šlo a jak kdo zahrál, bez čtení devatenácti řádků syrových statistik.
 *
 * **Načítá se až po rozkliknutí** (`/api/match-report`), protože na studený zápas stojí
 * 1 volání API; pak už je zápas trvale v `MatchStatCache`. Stejný líný vzor jako zranění,
 * tabulka nebo střelci.
 *
 * Vyhodnocení je čistá funkce (`lib/stats/matchReport.ts`) – tady se jen kreslí.
 */

/**
 * Stav v JEDNOM objektu a počáteční „loading" rovnou v `useState` – ne `setState` uvnitř
 * effectu. Komponenta se montuje až po rozkliknutí, takže „ještě se nenačítá" je stav,
 * který nikdy nenastane.
 */
type ReportState =
  | { state: "loading" }
  | { state: "done"; report: MatchReport | null }
  | { state: "error" };

function useMatchReport(match: SettledMatch): ReportState {
  const [data, setData] = useState<ReportState>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    const p = new URLSearchParams({
      fixture: String(match.fixtureId),
      home: String(match.home.id),
      away: String(match.away.id),
      hn: match.home.name,
      an: match.away.name,
      gh: String(match.homeGoals),
      ga: String(match.awayGoals),
      mode: match.compareMode,
    });
    fetch(`/api/match-report?${p}`)
      .then((r) => r.json())
      .then((d: { report: MatchReport | null }) => {
        if (!cancelled) setData({ state: "done", report: d.report ?? null });
      })
      .catch(() => {
        if (!cancelled) setData({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [match]);

  return data;
}

export function MatchReportPanel({ match }: { match: SettledMatch }) {
  const data = useMatchReport(match);

  if (data.state === "loading") {
    return (
      <div className="rounded-xl border border-border bg-surface/50 px-3 py-4 text-center text-xs text-muted">
        Načítám přehled…
      </div>
    );
  }
  if (data.state === "error" || !data.report) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/50 px-3 py-4 text-center text-xs text-muted">
        Pro tenhle zápas nemáme statistiky.
      </div>
    );
  }

  const report = data.report;
  const chips = [
    report.character.openness,
    report.character.balance,
    report.character.intensity,
  ].filter((c) => c != null);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface/50 px-3 py-3">
      {report.verdict && (
        <p className="text-sm font-medium leading-snug text-foreground">{report.verdict}</p>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {report.dimensions.map((d) => (
          <DimensionBar key={d.key} dim={d} />
        ))}
      </div>

      {report.notes.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-2 text-[11px] leading-snug text-muted">
          {report.notes.map((n) => (
            <li key={n} className="flex gap-1.5">
              <span aria-hidden className="shrink-0">
                •
              </span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
