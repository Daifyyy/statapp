import type { Standing, StandingSplit, Venue } from "@/lib/types";

/**
 * FREE kontext nad metrikami: postavení obou týmů v ligové tabulce (pozice, body,
 * V-R-P, rozdíl skóre). Rozpad V-R-P sleduje přepínač Doma/Venku/Celkově. Líně
 * načítané mimo compareTeams; reprezentace tabulku nemají → `null` (sekce se skryje).
 */
export function StandingContext({
  home,
  away,
  venue,
}: {
  home: Standing | null;
  away: Standing | null;
  venue: Venue;
}) {
  if (!home && !away) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="space-y-3">
        <Row label="V tabulce">
          <RankValue s={home} accent="home" />
          <RankValue s={away} accent="away" alignRight />
        </Row>
        <Row label={`V-R-P (${VENUE_LABELS[venue]})`}>
          <RecordValue split={splitFor(home, venue)} accent="home" />
          <RecordValue split={splitFor(away, venue)} accent="away" alignRight />
        </Row>
      </div>
    </section>
  );
}

const VENUE_LABELS: Record<Venue, string> = {
  HOME: "Doma",
  AWAY: "Venku",
  TOTAL: "Celkově",
};

function splitFor(s: Standing | null, venue: Venue): StandingSplit | null {
  if (!s) return null;
  if (venue === "HOME") return s.home;
  if (venue === "AWAY") return s.away;
  return s.all;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: [React.ReactNode, React.ReactNode];
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-1 justify-start">{children[0]}</div>
      <span className="shrink-0 px-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="flex flex-1 justify-end">{children[1]}</div>
    </div>
  );
}

function RankValue({
  s,
  accent,
  alignRight,
}: {
  s: Standing | null;
  accent: "home" | "away";
  alignRight?: boolean;
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  if (!s) return <span className="text-sm text-muted">—</span>;
  return (
    <div className={alignRight ? "text-right" : "text-left"}>
      <span className={`text-sm font-bold tabular-nums ${color}`}>
        {s.rank}. místo
      </span>
      <span className="ml-1.5 text-xs text-muted tabular-nums">
        {s.points} b · {s.goalsDiff > 0 ? `+${s.goalsDiff}` : s.goalsDiff}
      </span>
    </div>
  );
}

function RecordValue({
  split,
  accent,
  alignRight,
}: {
  split: StandingSplit | null;
  accent: "home" | "away";
  alignRight?: boolean;
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  if (!split || split.played === 0) {
    return <span className="text-sm text-muted">—</span>;
  }
  return (
    <div className={alignRight ? "text-right" : "text-left"}>
      <span className={`text-sm font-bold tabular-nums ${color}`}>
        {split.win}-{split.draw}-{split.lose}
      </span>
      <span className="ml-1 text-[10px] text-muted tabular-nums">
        {split.goalsFor}:{split.goalsAgainst}
      </span>
    </div>
  );
}
