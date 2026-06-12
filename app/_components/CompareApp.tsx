"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CompareResult,
  EntityType,
  League,
  Metric,
  Venue,
} from "@/lib/types";
import { METRIC_LABELS } from "@/lib/types";
import { MetricRow } from "./MetricRow";
import { InsightChips } from "./InsightChips";
import { TeamLogo } from "./TeamLogo";
import { TeamCombobox } from "./TeamCombobox";

interface TeamLite {
  id: number;
  name: string;
  logoUrl: string;
  country: string;
}

const VENUE_LABELS: Record<Venue, string> = {
  HOME: "Doma",
  AWAY: "Venku",
  TOTAL: "Celkově",
};

function firstLeagueId(leagues: League[], mode: EntityType): number | null {
  const kind = mode === "CLUB" ? "CLUB_LEAGUE" : "NATIONAL_COMP";
  return leagues.find((l) => l.kind === kind)?.id ?? null;
}

interface CompareSetters {
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setResult: (v: CompareResult | null) => void;
}

/** Načte týmy zvolené ligy (prefetch hned po výběru ligy). */
function useTeams(leagueId: number | null): TeamLite[] {
  const [teams, setTeams] = useState<TeamLite[]>([]);
  useEffect(() => {
    if (leagueId == null) return;
    let active = true;
    fetch(`/api/teams?league=${leagueId}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) setTeams(d.teams ?? []);
      })
      .catch(() => active && setTeams([]));
    return () => {
      active = false;
    };
  }, [leagueId]);
  return teams;
}

// Mimo tělo efektu → žádné synchronní setState v efektu (React 19 pravidlo).
async function runCompare(
  homeId: number,
  awayId: number,
  homeLeague: number,
  awayLeague: number,
  isActive: () => boolean,
  { setLoading, setError, setResult }: CompareSetters
): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const r = await fetch(
      `/api/compare?home=${homeId}&away=${awayId}&homeLeague=${homeLeague}&awayLeague=${awayLeague}`
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Chyba porovnání");
    if (isActive()) setResult(d as CompareResult);
  } catch (e) {
    if (isActive()) setError(e instanceof Error ? e.message : "Chyba porovnání");
  } finally {
    if (isActive()) setLoading(false);
  }
}

export function CompareApp({ leagues }: { leagues: League[] }) {
  const [mode, setMode] = useState<EntityType>("CLUB");
  const [homeLeagueId, setHomeLeagueId] = useState<number | null>(
    firstLeagueId(leagues, "CLUB")
  );
  const [awayLeagueId, setAwayLeagueId] = useState<number | null>(
    firstLeagueId(leagues, "CLUB")
  );
  const [homeId, setHomeId] = useState<number | null>(null);
  const [awayId, setAwayId] = useState<number | null>(null);
  const [venue, setVenue] = useState<Venue>("TOTAL");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const homeTeams = useTeams(homeLeagueId);
  const awayTeams = useTeams(awayLeagueId);

  const modeLeagues = useMemo(
    () =>
      leagues.filter((l) =>
        mode === "CLUB" ? l.kind === "CLUB_LEAGUE" : l.kind === "NATIONAL_COMP"
      ),
    [leagues, mode]
  );

  // Reset výběru se řeší v event handlerech (ne v efektu) — doporučený vzor.
  function handleMode(next: EntityType) {
    if (next === mode) return;
    setMode(next);
    const first = firstLeagueId(leagues, next);
    setHomeLeagueId(first);
    setAwayLeagueId(first);
    setHomeId(null);
    setAwayId(null);
    setResult(null);
  }

  function handleHomeLeague(id: number) {
    setHomeLeagueId(id);
    setHomeId(null);
    setResult(null);
  }

  function handleAwayLeague(id: number) {
    setAwayLeagueId(id);
    setAwayId(null);
    setResult(null);
  }

  // Porovnej, jakmile jsou vybrané oba (různé) týmy.
  const canCompare =
    homeId != null &&
    awayId != null &&
    homeId !== awayId &&
    homeLeagueId != null &&
    awayLeagueId != null;
  useEffect(() => {
    if (!canCompare) return;
    let active = true;
    void runCompare(homeId, awayId, homeLeagueId, awayLeagueId, () => active, {
      setLoading,
      setError,
      setResult,
    });
    return () => {
      active = false;
    };
  }, [canCompare, homeId, awayId, homeLeagueId, awayLeagueId]);

  // Klubový režim = výběr ligy, reprezentační = výběr konfederace (obojí per tým).
  const leagueLabel = mode === "CLUB" ? "Liga" : "Konfederace";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <Header mode={mode} onMode={handleMode} />

      <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <TeamSelect
            accent="home"
            heading="Domácí"
            teams={homeTeams}
            value={homeId}
            exclude={awayId}
            onChange={setHomeId}
            leagueLabel={leagueLabel}
            leagues={modeLeagues}
            leagueId={homeLeagueId}
            onLeagueChange={handleHomeLeague}
          />
          <TeamSelect
            accent="away"
            heading="Host"
            teams={awayTeams}
            value={awayId}
            exclude={homeId}
            onChange={setAwayId}
            leagueLabel={leagueLabel}
            leagues={modeLeagues}
            leagueId={awayLeagueId}
            onLeagueChange={handleAwayLeague}
          />
        </div>
      </section>

      <div className="sticky top-0 z-10 mt-4 bg-background/80 py-2 backdrop-blur">
        <Segmented
          options={(["HOME", "AWAY", "TOTAL"] as Venue[]).map((v) => ({
            value: v,
            label: VENUE_LABELS[v],
          }))}
          value={venue}
          onChange={setVenue}
        />
      </div>

      <ResultPanel
        result={result}
        venue={venue}
        loading={loading}
        error={error}
        ready={canCompare}
      />
    </main>
  );
}

function Header({
  mode,
  onMode,
}: {
  mode: EntityType;
  onMode: (m: EntityType) => void;
}) {
  return (
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-lg font-bold tracking-tight">
        ⚽ Predictapp
      </h1>
      <Segmented
        options={[
          { value: "CLUB" as EntityType, label: "Kluby" },
          { value: "NATIONAL" as EntityType, label: "Reprezentace" },
        ]}
        value={mode}
        onChange={onMode}
        compact
      />
    </header>
  );
}

function ResultPanel({
  result,
  venue,
  loading,
  error,
  ready,
}: {
  result: CompareResult | null;
  venue: Venue;
  loading: boolean;
  error: string | null;
  ready: boolean;
}) {
  if (error) {
    return <Empty>{error}</Empty>;
  }
  if (!ready) {
    return <Empty>Vyber domácí a hostující tým pro porovnání.</Empty>;
  }
  if (loading && !result) {
    return <Skeleton />;
  }
  if (!result) return null;

  const valueFor = (teamSide: "home" | "away", metric: Metric) =>
    result[teamSide].values.find(
      (v) => v.metric === metric && v.venue === venue
    ) ?? null;

  return (
    <div
      key={`${result.home.team.id}-${result.away.team.id}`}
      className="fade-in mt-3 space-y-4"
    >
      {result.sourceNote && (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
          ⚠ {result.sourceNote}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <TeamHeading
            name={result.home.team.name}
            logo={result.home.team.logoUrl}
            accent="home"
          />
          <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {VENUE_LABELS[venue]}
          </span>
          <TeamHeading
            name={result.away.team.name}
            logo={result.away.team.logoUrl}
            accent="away"
            alignRight
          />
        </div>

        <div className="divide-y divide-border">
          {result.metrics.map((metric) => (
            <MetricRow
              key={metric}
              label={METRIC_LABELS[metric]}
              home={valueFor("home", metric)}
              away={valueFor("away", metric)}
              lowerIsBetter={
                metric === "GOALS_AGAINST" || metric === "FOULS"
              }
            />
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <InsightChips
          title={result.home.team.name}
          accent="home"
          insights={result.home.insights}
        />
        <InsightChips
          title={result.away.team.name}
          accent="away"
          insights={result.away.insights}
        />
      </div>
    </div>
  );
}

function TeamSelect({
  accent,
  heading,
  teams,
  value,
  exclude,
  onChange,
  leagueLabel,
  leagues,
  leagueId,
  onLeagueChange,
}: {
  accent: "home" | "away";
  heading: string;
  teams: TeamLite[];
  value: number | null;
  exclude: number | null;
  onChange: (id: number) => void;
  leagueLabel: string;
  leagues: League[];
  leagueId: number | null;
  onLeagueChange: (id: number) => void;
}) {
  const ring = accent === "home" ? "text-home" : "text-away";
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${ring}`}>
        {heading}
      </p>
      <label className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-muted">
        {leagueLabel}
      </label>
      <select
        className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
        value={leagueId ?? ""}
        onChange={(e) => onLeagueChange(Number(e.target.value))}
      >
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <div className="mt-2">
        <TeamCombobox
          teams={teams}
          value={value}
          exclude={exclude}
          onChange={onChange}
          accent={accent}
        />
      </div>
    </div>
  );
}

function TeamHeading({
  name,
  logo,
  accent,
  alignRight,
}: {
  name: string;
  logo: string;
  accent: "home" | "away";
  alignRight?: boolean;
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 sm:flex-col sm:gap-1.5 ${
        alignRight ? "flex-row-reverse text-right sm:text-center" : "sm:text-center"
      }`}
    >
      <span className="shrink-0">
        <span className="sm:hidden">
          <TeamLogo src={logo} alt={name} size={32} />
        </span>
        <span className="hidden sm:inline">
          <TeamLogo src={logo} alt={name} size={48} />
        </span>
      </span>
      <span className={`truncate text-sm font-semibold sm:text-base ${color}`}>
        {name}
      </span>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`inline-flex w-full rounded-full border border-border bg-surface p-0.5 ${
        compact ? "w-auto" : ""
      }`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-foreground text-background"
                : "text-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-border bg-surface p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-9 animate-pulse rounded-lg bg-border/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
