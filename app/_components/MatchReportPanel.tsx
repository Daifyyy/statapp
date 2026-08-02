"use client";

import { useEffect, useState } from "react";
import type { EntityType, Standing } from "@/lib/types";
import type { MatchReport } from "@/lib/stats/matchReport";
import type { MatchReview } from "@/lib/picks/matchReview";
import { Chip, DimensionBar } from "./MatchDimensionBar";

/**
 * Minimum, které panel potřebuje – **strukturální tvar, ne konkrétní typ**. Splní ho
 * `PlayedFixture` (Výsledky) i `SettledMatch` (track-record), takže přehled nezávisí na
 * tom, jestli k zápasu existuje naše predikce.
 */
export interface ReportedMatch {
  fixtureId: number;
  leagueId: number;
  home: { id: number; name: string };
  away: { id: number; name: string };
  homeGoals: number;
  awayGoals: number;
  compareMode: EntityType;
}

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
  | { state: "done"; report: MatchReport | null; review: MatchReview | null }
  | { state: "error" };

function useMatchReport(match: ReportedMatch): ReportState {
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
      .then((d: { report: MatchReport | null; review: MatchReview | null }) => {
        if (!cancelled)
          setData({
            state: "done",
            report: d.report ?? null,
            review: d.review ?? null,
          });
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

/**
 * Aktuální postavení obou týmů v tabulce – druhý líný fetch na už existující
 * `/api/standings` (FREE, cache 5/10 min). Jen klubové zápasy: reprezentace tabulku
 * nemají a endpoint by u nich vracel `null`.
 *
 * **Je to „aktuální pořadí", ne „po zápase".** Tabulka je dnešní; u zápasu starého tři
 * dny už mezitím proběhlo další kolo. Tvrdit „po výhře je Slavia první" by u staršího
 * řádku bylo nepravdivé, takže to popisek neříká.
 */
function useStandings(
  match: ReportedMatch
): { home: Standing | null; away: Standing | null } {
  const [data, setData] = useState<{ home: Standing | null; away: Standing | null }>({
    home: null,
    away: null,
  });

  useEffect(() => {
    if (match.compareMode !== "CLUB") return;
    let cancelled = false;
    const get = (teamId: number) =>
      fetch(`/api/standings?team=${teamId}&league=${match.leagueId}`)
        .then((r) => r.json())
        .then((d: { standing?: Standing | null }) => d.standing ?? null)
        .catch(() => null);
    Promise.all([get(match.home.id), get(match.away.id)]).then(([home, away]) => {
      if (!cancelled) setData({ home, away });
    });
    return () => {
      cancelled = true;
    };
  }, [match]);

  return data;
}

const SIDE_LABELS: Record<"home" | "draw" | "away", string> = {
  home: "Domácí",
  draw: "Remíza",
  away: "Hosté",
};

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function MatchReportPanel({ match }: { match: ReportedMatch }) {
  const data = useMatchReport(match);
  const standings = useStandings(match);

  if (data.state === "loading") {
    return (
      <div className="rounded-xl border border-border bg-surface/50 px-3 py-4 text-center text-xs text-muted">
        Načítám přehled…
      </div>
    );
  }
  // Obraz hry a „model vs. skutečnost" jsou nezávislé: statistiky chybí u části zápasů,
  // predikce zase nemusela vzniknout. Prázdný stav patří jen tam, kde není ANI JEDNO.
  if (data.state === "error" || (!data.report && !data.review)) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/50 px-3 py-4 text-center text-xs text-muted">
        Pro tenhle zápas nemáme statistiky.
      </div>
    );
  }

  const { report, review } = data;
  const chips = report
    ? [
        report.character.openness,
        report.character.balance,
        report.character.intensity,
      ].filter((c) => c != null)
    : [];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface/50 px-3 py-3">
      {report?.verdict && (
        <p className="text-sm font-medium leading-snug text-foreground">{report.verdict}</p>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
      )}

      {report && report.dimensions.length > 0 && (
        <div className="space-y-2.5">
          {report.dimensions.map((d) => (
            <DimensionBar key={d.key} dim={d} />
          ))}
        </div>
      )}

      {review?.model && (
        <ModelSection
          model={review.model}
          goals={{ home: match.homeGoals, away: match.awayGoals }}
        />
      )}

      {review && review.marketNotes.length > 0 && (
        <MarketSection notes={review.marketNotes} />
      )}

      {(review?.corners || review?.cards) && (
        <CountsSection corners={review.corners} cards={review.cards} />
      )}

      {(standings.home || standings.away) && (
        <StandingsSection
          match={match}
          home={standings.home}
          away={standings.away}
        />
      )}

      {report && report.notes.length > 0 && (
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

/** Nadpis sekce – jednotný oddělovač a typografie pro všechny přidané bloky. */
function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 border-t border-border pt-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          {title}
        </h4>
        {badge}
      </div>
      {children}
    </div>
  );
}

/** Řádek „popisek → hodnota" (mobile-first: dva sloupce, čísla tabulární). */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px] leading-snug">
      <span className="min-w-0 text-muted">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/** Co model před výkopem řekl vs. jak to dopadlo. */
function ModelSection({
  model,
  goals,
}: {
  model: NonNullable<MatchReview["model"]>;
  goals: { home: number; away: number };
}) {
  return (
    <Section
      title="Model před výkopem"
      badge={
        <span
          className={`text-sm font-bold ${
            model.hit ? "text-positive" : "text-negative"
          }`}
          aria-label={model.hit ? "Predikce vyšla" : "Predikce nevyšla"}
        >
          {model.hit ? "✓" : "✗"}
        </span>
      }
    >
      <Row
        label={`Tip: ${SIDE_LABELS[model.side]}`}
        value={`${pct(model.prob)} → padlo ${goals.home}:${goals.away}`}
      />
      <Row
        label="Očekávané góly"
        value={`${model.lambdaHome.toFixed(2)} : ${model.lambdaAway.toFixed(2)}`}
      />
      {model.topScore && (
        <Row
          label="Nejpravděpodobnější skóre"
          value={`${model.topScore.home}:${model.topScore.away} (${pct(model.topScore.prob)})`}
        />
      )}
      <Row
        label="Over 2.5"
        value={`${pct(model.over25Prob)} → ${model.over25Hit ? "ano" : "ne"}`}
      />
      <Row
        label="Oba dají gól"
        value={`${pct(model.bttsProb)} → ${model.bttsHit ? "ano" : "ne"}`}
      />
      {model.lowConfidence && (
        <p className="pt-0.5 text-[10px] text-muted">
          Predikce stála na malém vzorku dat.
        </p>
      )}
    </Section>
  );
}

/** Co říkal trh – hotové věty z `matchReview` (skloňování patří do jádra, ne sem). */
function MarketSection({ notes }: { notes: string[] }) {
  return (
    <Section title="Co říkal trh">
      <ul className="space-y-0.5 text-[11px] leading-snug text-muted">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Section>
  );
}

/** Očekávané vs. skutečné rohy a karty – jediné místo, kde jsou tyhle modely vidět. */
function CountsSection({
  corners,
  cards,
}: {
  corners: MatchReview["corners"];
  cards: MatchReview["cards"];
}) {
  return (
    <Section title="Rohy a karty">
      {corners && (
        <Row
          label="Rohy (čekali jsme × bylo)"
          value={`${corners.expectedTotal} × ${corners.actualTotal}`}
        />
      )}
      {cards && (
        <Row
          label="Karty (čekali jsme × bylo)"
          value={`${cards.expectedTotal} × ${cards.actualTotal}`}
        />
      )}
    </Section>
  );
}

/** Aktuální postavení obou týmů v tabulce (ne stav těsně po zápase – viz `useStandings`). */
function StandingsSection({
  match,
  home,
  away,
}: {
  match: ReportedMatch;
  home: Standing | null;
  away: Standing | null;
}) {
  return (
    <Section title="Aktuálně v tabulce">
      {home && (
        <Row
          label={match.home.name}
          value={`${home.rank}. · ${home.points} b.`}
        />
      )}
      {away && (
        <Row
          label={match.away.name}
          value={`${away.rank}. · ${away.points} b.`}
        />
      )}
    </Section>
  );
}
