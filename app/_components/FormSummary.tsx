import type { MatchResult, TeamSummary } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";

/**
 * Blok nad metrikami: forma (posl. 5 jako W/D/L) a podíl čistého konta / zápasů
 * bez gólu (% z posl. 10) pro obě strany. Sleduje přepínač Doma/Venku/Celkově.
 */
export function FormSummary({
  home,
  away,
}: {
  home: TeamSummary | null;
  away: TeamSummary | null;
}) {
  if (!home && !away) return null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="space-y-3">
        <Row label="Forma">
          <FormBadges form={home?.form ?? []} opponents={home?.formOpponents ?? []} align="left" />
          <FormBadges form={away?.form ?? []} opponents={away?.formOpponents ?? []} align="right" />
        </Row>
        <Pct
          label="Čisté konto"
          home={home?.cleanSheetPct ?? null}
          away={away?.cleanSheetPct ?? null}
          homeN={home?.sampleSize ?? 0}
          awayN={away?.sampleSize ?? 0}
          higherIsBetter
        />
        <Pct
          label="Bez vstřeleného gólu"
          home={home?.failedToScorePct ?? null}
          away={away?.failedToScorePct ?? null}
          homeN={home?.sampleSize ?? 0}
          awayN={away?.sampleSize ?? 0}
          higherIsBetter={false}
        />
      </div>
    </section>
  );
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

const BADGE: Record<MatchResult, string> = {
  W: "bg-positive text-white",
  D: "bg-muted/30 text-foreground",
  L: "bg-red-500 text-white",
};

type FormOpponent = { id: number; name: string; logoUrl: string | null } | null;

function FormBadges({
  form,
  opponents,
  align,
}: {
  form: MatchResult[];
  opponents: FormOpponent[];
  align: "left" | "right";
}) {
  if (form.length === 0) {
    return <span className="text-sm text-muted">—</span>;
  }
  // Nejnovější první; pro hosty zarovnáme doprava (nejnovější u kraje).
  const paired = form.map((r, i) => ({ r, opponent: opponents[i] ?? null }));
  const ordered = align === "right" ? [...paired].reverse() : paired;
  return (
    <div className="flex gap-1">
      {ordered.map(({ r, opponent }, i) => (
        <span
          key={i}
          title={opponent?.name}
          className="flex flex-col items-center gap-0.5"
        >
          {opponent && (
            <TeamLogo src={opponent.logoUrl ?? undefined} alt={opponent.name} size={12} />
          )}
          <span
            className={`flex h-6 w-6 items-center justify-center rounded text-xs font-bold ${BADGE[r]}`}
          >
            {r}
          </span>
        </span>
      ))}
    </div>
  );
}

function Pct({
  label,
  home,
  away,
  homeN,
  awayN,
  higherIsBetter,
}: {
  label: string;
  home: number | null;
  away: number | null;
  homeN: number;
  awayN: number;
  higherIsBetter: boolean;
}) {
  const better =
    home == null || away == null
      ? null
      : home === away
        ? null
        : (higherIsBetter ? home > away : home < away)
          ? "home"
          : "away";

  return (
    <Row label={label}>
      <PctValue value={home} n={homeN} accent="home" highlight={better === "home"} />
      <PctValue
        value={away}
        n={awayN}
        accent="away"
        highlight={better === "away"}
        alignRight
      />
    </Row>
  );
}

function PctValue({
  value,
  n,
  accent,
  highlight,
  alignRight,
}: {
  value: number | null;
  n: number;
  accent: "home" | "away";
  highlight?: boolean;
  alignRight?: boolean;
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  return (
    <div className={alignRight ? "text-right" : "text-left"}>
      <span
        className={`text-sm font-bold tabular-nums ${
          highlight ? color : "text-foreground"
        }`}
      >
        {value == null ? "—" : `${value} %`}
      </span>
      {n > 0 && (
        <span className="ml-1 text-[10px] text-muted">z {n} záp.</span>
      )}
    </div>
  );
}
