"use client";

import { useEffect, useState } from "react";
import type { UpcomingFixture } from "@/lib/types";
import type { LiveReport } from "@/lib/stats/liveReport";
import { Chip, DimensionBar } from "./MatchDimensionBar";

/**
 * Přehled **probíhajícího** zápasu v rozbaleném řádku Programu – kdo zatím určuje hru.
 *
 * Proč vlastní komponenta vedle `MatchReportPanel`: ten je typovaný na dohraný zápas
 * (`SettledMatch`) a jeho kontrakt je „načti jednou, nikdy se to nezmění, cache 1 h".
 * Tenhle panel bere běžící zápas, pollí a mění stav. Sdílené je jen kreslení pruhů a
 * chipů (`MatchDimensionBar`).
 *
 * **Náklad:** každý refresh může stát 1 volání API (statistiky jednoho zápasu se nedají
 * sdílet mezi zápasy), proto se pollí jen dokud je panel otevřený a záložka viditelná.
 * Sbalení řádku komponentu odmontuje → poll skončí. Strop drží serverové TTL.
 */

const REFRESH_MS = 60_000;

type PanelState =
  | { state: "loading" }
  | { state: "done"; report: LiveReport | null; reason: string | null }
  | { state: "error" };

/** Dotaz na routu poskládaný z toho, co o zápase víme z živého feedu. */
function queryFor(fixture: UpcomingFixture): URLSearchParams {
  const p = new URLSearchParams({
    fixture: String(fixture.fixtureId),
    home: String(fixture.home.id),
    away: String(fixture.away.id),
    hn: fixture.home.name,
    an: fixture.away.name,
    // Stav z živého feedu; než doběhne první poll, odhad z toho, že zápas běží.
    st: fixture.liveStatus ?? (fixture.live ? "2H" : "NS"),
  });
  if (fixture.liveHome != null && fixture.liveAway != null) {
    p.set("gh", String(fixture.liveHome));
    p.set("ga", String(fixture.liveAway));
  }
  if (fixture.elapsed != null) p.set("el", String(fixture.elapsed));
  if (fixture.halftimeHome != null && fixture.halftimeAway != null) {
    p.set("hh", String(fixture.halftimeHome));
    p.set("ha", String(fixture.halftimeAway));
  }
  return p;
}

/**
 * Stav v JEDNOM objektu a `setState` výhradně v callbacku promisy – stejný tvar jako
 * `MatchReportPanel`. Synchronní `setState` v těle effectu je zakázané lintem
 * (`react-hooks/set-state-in-effect`) a vede na kaskádové rendery.
 */
function useLiveReport(fixture: UpcomingFixture): PanelState {
  const [data, setData] = useState<PanelState>({ state: "loading" });

  useEffect(() => {
    const signal = { cancelled: false };
    const run = () => {
      fetch(`/api/live-report?${queryFor(fixture)}`)
        .then((r) => r.json())
        .then((d: { report: LiveReport | null; reason: string | null }) => {
          if (!signal.cancelled) {
            setData({ state: "done", report: d.report ?? null, reason: d.reason ?? null });
          }
        })
        .catch(() => {
          if (!signal.cancelled) setData({ state: "error" });
        });
    };

    run();
    const timer = setInterval(() => {
      if (!document.hidden) run();
    }, REFRESH_MS);
    const onVis = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      signal.cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fixture]);

  return data;
}

/** Prázdné stavy mají vlastní text – „je brzy" a „nedorazily statistiky" není totéž. */
function emptyText(reason: string | null): string {
  if (reason === "budget") return "Živý přehled je teď dočasně vypnutý.";
  if (reason === "nostats") return "Pro tenhle zápas zatím nemáme živé statistiky.";
  return "Pro tenhle zápas zatím nemáme živé statistiky.";
}

/** Rámeček je pořád stejně vysoký, aby refresh neposkakoval seznamem. */
function Frame({ children, dashed }: { children: React.ReactNode; dashed?: boolean }) {
  return (
    <div
      className={`min-h-[4.5rem] rounded-xl border bg-surface/50 px-3 py-3 ${
        dashed ? "border-dashed border-border" : "border-border"
      }`}
    >
      {children}
    </div>
  );
}

export function LiveReportPanel({ fixture }: { fixture: UpcomingFixture }) {
  const data = useLiveReport(fixture);

  if (data.state === "loading") {
    return (
      <Frame>
        <p className="text-center text-xs text-muted">Načítám průběh…</p>
      </Frame>
    );
  }
  if (data.state === "error" || !data.report) {
    return (
      <Frame dashed>
        <p className="text-center text-xs text-muted">
          {emptyText(data.state === "done" ? data.reason : null)}
        </p>
      </Frame>
    );
  }

  const report = data.report;
  const chips = [
    report.character.openness,
    report.character.balance,
    report.character.intensity,
  ].filter((c) => c != null);

  return (
    <Frame dashed={!report.available}>
      <div className="space-y-3">
        {report.headline && (
          <p className="text-sm font-medium leading-snug text-foreground">
            {report.headline}
          </p>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
        )}

        {report.available && (
          <div className="space-y-2.5">
            {report.dimensions.map((d) => (
              <DimensionBar key={d.key} dim={d} />
            ))}
          </div>
        )}

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

        {/*
          Bez téhle značky vypadá zamrzlý panel (nebo snímek z CDN) jako aktuální stav.
          Minuta je součást tvrzení, ne dekorace.
        */}
        <p className="text-right text-[10px] text-muted">stav v {report.minute}. minutě</p>
      </div>
    </Frame>
  );
}
