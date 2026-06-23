"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CompareResult,
  EntityType,
  Injury,
  League,
  Metric,
  Venue,
} from "@/lib/types";
import { METRIC_LABELS, METRIC_HINTS, LOWER_IS_BETTER } from "@/lib/types";
import { MetricRow } from "./MetricRow";
import { MatchVerdict } from "./MatchVerdict";
import { MatchPrediction } from "./MatchPrediction";
import { KeySignals } from "./KeySignals";
import { FormSummary } from "./FormSummary";
import { InsightChips } from "./InsightChips";
import { InjuryList } from "./InjuryList";
import { TeamLogo } from "./TeamLogo";
import { TeamCombobox } from "./TeamCombobox";
import { AppHeader } from "./AppHeader";
import { ProLock } from "./ProLock";
import {
  FavoritesSection,
  type SavedFavorite,
  type Selection,
} from "./FavoritesSection";
import type { SessionUser } from "./sessionUser";

interface TeamLite {
  id: number;
  name: string;
  logoUrl: string;
  country: string;
}

/** Počáteční výběr načtený z URL (server page → props). */
export interface InitialSelection {
  mode?: EntityType;
  homeLeague?: number;
  awayLeague?: number;
  home?: number;
  away?: number;
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
function useTeams(leagueId: number | null): { teams: TeamLite[]; error: boolean } {
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (leagueId == null) return;
    let active = true;
    fetch(`/api/teams?league=${leagueId}`)
      .then((r) => {
        if (!r.ok) throw new Error("teams");
        return r.json();
      })
      .then((d) => {
        if (active) {
          setTeams(d.teams ?? []);
          setError(false);
        }
      })
      .catch(() => {
        if (active) {
          setTeams([]);
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [leagueId]);
  return { teams, error };
}

/** Líně dotáhne zranění týmu (mimo kritickou cestu porovnání). */
function useInjuries(
  teamId: number | null,
  leagueId: number | null,
  enabled: boolean
): Injury[] {
  const [injuries, setInjuries] = useState<Injury[]>([]);
  useEffect(() => {
    if (!enabled || teamId == null || leagueId == null) return;
    let active = true;
    fetch(`/api/injuries?team=${teamId}&league=${leagueId}`)
      .then((r) => r.json())
      .then((d) => {
        if (active) setInjuries(d.injuries ?? []);
      })
      .catch(() => active && setInjuries([]));
    return () => {
      active = false;
    };
  }, [teamId, leagueId, enabled]);
  return injuries;
}

// Mimo tělo efektu → žádné synchronní setState v efektu (React 19 pravidlo).
// `unlock` = žádost o 1× trial PRO (server případně spotřebuje trial a vrátí plný výsledek).
async function runCompare(
  homeId: number,
  awayId: number,
  homeLeague: number,
  awayLeague: number,
  unlock: boolean,
  isActive: () => boolean,
  { setLoading, setError, setResult }: CompareSetters
): Promise<CompareResult | null> {
  setLoading(true);
  setError(null);
  try {
    const r = await fetch(
      `/api/compare?home=${homeId}&away=${awayId}&homeLeague=${homeLeague}&awayLeague=${awayLeague}${
        unlock ? "&unlock=1" : ""
      }`
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Chyba porovnání");
    if (!isActive()) return null;
    setResult(d as CompareResult);
    return d as CompareResult;
  } catch (e) {
    if (isActive()) setError(e instanceof Error ? e.message : "Chyba porovnání");
    return null;
  } finally {
    if (isActive()) setLoading(false);
  }
}

export function CompareApp({
  leagues,
  initial,
  user,
}: {
  leagues: League[];
  initial?: InitialSelection;
  user: SessionUser | null;
}) {
  const initialMode = initial?.mode ?? "CLUB";
  const [mode, setMode] = useState<EntityType>(initialMode);
  const [homeLeagueId, setHomeLeagueId] = useState<number | null>(
    initial?.homeLeague ?? firstLeagueId(leagues, initialMode)
  );
  const [awayLeagueId, setAwayLeagueId] = useState<number | null>(
    initial?.awayLeague ?? firstLeagueId(leagues, initialMode)
  );
  const [homeId, setHomeId] = useState<number | null>(initial?.home ?? null);
  const [awayId, setAwayId] = useState<number | null>(initial?.away ?? null);
  const [venue, setVenue] = useState<Venue>("TOTAL");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lokální stav trialu (zrcadlí DB) – po využití nabízej upgrade místo trialu.
  const [trialUsed, setTrialUsed] = useState<boolean>(user?.proTrialUsed ?? false);
  const [unlocking, setUnlocking] = useState(false);
  const trialAvailable = user?.tier === "FREE" && !trialUsed;
  // Po načtení oblíbeného ukaž snapshot „jak to bylo" a přeskoč auto-fetch.
  const skipAutoRef = useRef(false);
  const [savedView, setSavedView] = useState<string | null>(null);
  const isPro = user?.tier === "PRO";

  const { teams: homeTeams, error: homeTeamsError } = useTeams(homeLeagueId);
  const { teams: awayTeams, error: awayTeamsError } = useTeams(awayLeagueId);

  // Zranění se tahají líně, až je výsledek na obrazovce (mimo kritickou cestu).
  const homeInjuries = useInjuries(homeId, homeLeagueId, result != null);
  const awayInjuries = useInjuries(awayId, awayLeagueId, result != null);

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
    // Reprezentace jsou venue-neutrální → vždy Celkově (přepínač se skryje).
    if (next === "NATIONAL") setVenue("TOTAL");
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

  // Prohození domácí ⇄ host (liga i tým). Auto-fetch efekt přepočítá výsledek.
  function handleSwap() {
    setHomeLeagueId(awayLeagueId);
    setAwayLeagueId(homeLeagueId);
    setHomeId(awayId);
    setAwayId(homeId);
    setSavedView(null);
  }

  // Vyčisti výběr týmů a výsledek (ligy/konfederace nechej navolené).
  function handleReset() {
    setHomeId(null);
    setAwayId(null);
    setResult(null);
    setSavedView(null);
    setError(null);
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
    // Načtení oblíbeného nastaví ID i snapshot → tento jeden auto-fetch přeskoč.
    if (skipAutoRef.current) {
      skipAutoRef.current = false;
      return;
    }
    setSavedView(null);
    let active = true;
    void runCompare(
      homeId,
      awayId,
      homeLeagueId,
      awayLeagueId,
      false,
      () => active,
      { setLoading, setError, setResult }
    );
    return () => {
      active = false;
    };
  }, [canCompare, homeId, awayId, homeLeagueId, awayLeagueId]);

  // Načti uložené porovnání: ukaž snapshot okamžitě, bez nového fetchu.
  function applyFavorite(fav: SavedFavorite) {
    skipAutoRef.current = true;
    setMode(fav.mode);
    setHomeLeagueId(fav.homeLeagueId);
    setAwayLeagueId(fav.awayLeagueId);
    setHomeId(fav.homeTeamId);
    setAwayId(fav.awayTeamId);
    setError(null);
    setResult(fav.snapshot);
    setSavedView(new Date(fav.savedAt).toLocaleDateString("cs-CZ"));
  }

  // Aktualizuj zobrazené (uložené) porovnání čerstvými daty.
  function refreshCurrent() {
    if (!canCompare) return;
    setSavedView(null);
    void runCompare(
      homeId,
      awayId,
      homeLeagueId,
      awayLeagueId,
      false,
      () => true,
      { setLoading, setError, setResult }
    );
  }

  // Trial: odemkni plnou PRO verzi tohoto jednoho porovnání (server spotřebuje trial).
  async function handleUnlockTrial() {
    if (
      homeId == null ||
      awayId == null ||
      homeLeagueId == null ||
      awayLeagueId == null
    )
      return;
    setUnlocking(true);
    const res = await runCompare(
      homeId,
      awayId,
      homeLeagueId,
      awayLeagueId,
      true,
      () => true,
      { setLoading, setError, setResult }
    );
    setUnlocking(false);
    if (res && res.locked === false) setTrialUsed(true);
  }

  // Stav výběru drž v URL (sdílení/záložky). history.replaceState nezpůsobí
  // server re-render → žádný remount/ztráta stavu; žádný setState → lint OK.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    if (homeLeagueId != null) params.set("homeLeague", String(homeLeagueId));
    if (awayLeagueId != null) params.set("awayLeague", String(awayLeagueId));
    if (homeId != null) params.set("home", String(homeId));
    if (awayId != null) params.set("away", String(awayId));
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [mode, homeLeagueId, awayLeagueId, homeId, awayId]);

  // Klubový režim = výběr ligy, reprezentační = výběr konfederace (obojí per tým).
  const leagueLabel = mode === "CLUB" ? "Liga" : "Konfederace";

  // Typovaný výběr pro uložení do oblíbených (null, dokud nejsou oba týmy).
  const selection: Selection | null =
    homeId != null &&
    awayId != null &&
    homeLeagueId != null &&
    awayLeagueId != null
      ? {
          mode,
          homeTeamId: homeId,
          homeLeagueId,
          awayTeamId: awayId,
          awayLeagueId,
        }
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/", label: "Zápasy", emoji: "📅" },
          { href: "/predikce", label: "Tipy", emoji: "📈" },
          { href: "/transfers", label: "Přestupy", emoji: "🔄" },
        ]}
        share
      />

      <div className="mt-4">
        <Segmented
          options={[
            { value: "CLUB" as EntityType, label: "Kluby" },
            { value: "NATIONAL" as EntityType, label: "Reprezentace" },
          ]}
          value={mode}
          onChange={handleMode}
          ariaLabel="Typ porovnání"
        />
      </div>

      <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <TeamSelect
            accent="home"
            heading="Domácí"
            teams={homeTeams}
            teamsError={homeTeamsError}
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
            teamsError={awayTeamsError}
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

      {(homeId != null || awayId != null) && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleSwap}
            title="Prohodit domácí a hostující tým"
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted transition hover:text-foreground"
          >
            ⇄ Prohodit
          </button>
          <button
            type="button"
            onClick={handleReset}
            title="Vymazat výběr a začít nové porovnání"
            className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted transition hover:text-foreground"
          >
            ✕ Nové porovnání
          </button>
        </div>
      )}

      {/* Reprezentace jsou venue-neutrální → přepínač Doma/Venku jen pro kluby. */}
      {mode === "CLUB" && (
        <div className="sticky top-0 z-10 mt-4 bg-background/80 py-2 backdrop-blur">
          <Segmented
            options={(["HOME", "AWAY", "TOTAL"] as Venue[]).map((v) => ({
              value: v,
              label: VENUE_LABELS[v],
            }))}
            value={venue}
            onChange={setVenue}
            ariaLabel="Doma / Venku / Celkově"
          />
        </div>
      )}

      {isPro && (
        <FavoritesSection
          selection={selection}
          result={result}
          onApply={applyFavorite}
        />
      )}

      {savedView && result && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
          <span>📌 Zobrazeno z uložené verze ({savedView}).</span>
          <button
            type="button"
            onClick={refreshCurrent}
            className="rounded-full border border-border px-2.5 py-1 font-medium text-foreground transition hover:bg-background"
          >
            ↻ Aktualizovat
          </button>
        </div>
      )}

      <ResultPanel
        result={result}
        venue={venue}
        loading={loading}
        error={error}
        ready={canCompare}
        onRetry={refreshCurrent}
        homeInjuries={homeInjuries}
        awayInjuries={awayInjuries}
        user={user}
        trialAvailable={trialAvailable}
        unlocking={unlocking}
        onUnlockTrial={handleUnlockTrial}
      />
    </main>
  );
}


function ResultPanel({
  result,
  venue,
  loading,
  error,
  ready,
  onRetry,
  homeInjuries,
  awayInjuries,
  user,
  trialAvailable,
  unlocking,
  onUnlockTrial,
}: {
  result: CompareResult | null;
  venue: Venue;
  loading: boolean;
  error: string | null;
  ready: boolean;
  onRetry: () => void;
  homeInjuries: Injury[];
  awayInjuries: Injury[];
  user: SessionUser | null;
  trialAvailable: boolean;
  unlocking: boolean;
  onUnlockTrial: () => void;
}) {
  if (error) {
    return (
      <Empty>
        <p>{error}</p>
        {ready && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground transition hover:bg-background"
          >
            ↻ Zkusit znovu
          </button>
        )}
      </Empty>
    );
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

  const summaryFor = (teamSide: "home" | "away") =>
    result[teamSide].summary.find((s) => s.venue === venue) ?? null;

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

      {result.locked ? (
        <ProLock
          user={user}
          trialAvailable={trialAvailable}
          onUnlockTrial={onUnlockTrial}
          unlocking={unlocking}
        />
      ) : (
        <>
          {result.insightReport && (
            <MatchVerdict verdict={result.insightReport.verdict} />
          )}
          {result.prediction && (
            <MatchPrediction
              prediction={result.prediction}
              homeName={result.home.team.name}
              awayName={result.away.team.name}
            />
          )}
          {result.insightReport && (
            <KeySignals signals={result.insightReport.keySignals} />
          )}
          {(homeInjuries.length > 0 || awayInjuries.length > 0) && (
            <InjurySummary
              homeName={result.home.team.name}
              awayName={result.away.team.name}
              homeCount={homeInjuries.length}
              awayCount={awayInjuries.length}
            />
          )}
        </>
      )}

      <FormSummary home={summaryFor("home")} away={summaryFor("away")} />

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
              hint={METRIC_HINTS[metric]}
              home={valueFor("home", metric)}
              away={valueFor("away", metric)}
              lowerIsBetter={LOWER_IS_BETTER.has(metric)}
            />
          ))}
        </div>
      </section>

      {!result.locked && result.insightReport && (
        <div className="grid gap-3 sm:grid-cols-2">
          <InsightChips
            title={result.home.team.name}
            accent="home"
            insights={result.insightReport.home}
          />
          <InsightChips
            title={result.away.team.name}
            accent="away"
            insights={result.insightReport.away}
          />
        </div>
      )}

      {(homeInjuries.length > 0 || awayInjuries.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {homeInjuries.length > 0 && (
            <InjuryList
              title={result.home.team.name}
              accent="home"
              injuries={homeInjuries}
            />
          )}
          {awayInjuries.length > 0 && (
            <InjuryList
              title={result.away.team.name}
              accent="away"
              injuries={awayInjuries}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TeamSelect({
  accent,
  heading,
  teams,
  teamsError,
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
  teamsError?: boolean;
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
    <div className="min-w-0 rounded-xl border border-border bg-background p-3">
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${ring}`}>
        {heading}
      </p>
      <label className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-muted">
        {leagueLabel}
      </label>
      <select
        className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-base"
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
        {teamsError && (
          <p className="mt-1 text-[11px] text-warning">
            Týmy se nepodařilo načíst. Zkus přepnout ligu/konfederaci znovu.
          </p>
        )}
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
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
  ariaLabel?: string;
}) {
  // Šipkami posouvej výběr (vzor radiogroup s roving tabindexem).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % options.length
        : (i - 1 + options.length) % options.length;
    onChange(options[next].value);
  }
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
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
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
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

/** Stručné shrnutí počtu hráčů mimo hru (odvozené z už načtených zranění). */
function InjurySummary({
  homeName,
  awayName,
  homeCount,
  awayCount,
}: {
  homeName: string;
  awayName: string;
  homeCount: number;
  awayCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">
      <span className="font-semibold uppercase tracking-wide">🏥 Mimo hru</span>
      <span>
        <span className="font-semibold text-home">{homeName}</span>{" "}
        {homeCount} {plural(homeCount)}
      </span>
      <span aria-hidden>·</span>
      <span>
        <span className="font-semibold text-away">{awayName}</span>{" "}
        {awayCount} {plural(awayCount)}
      </span>
    </div>
  );
}

/** Česká pluralizace „hráč / hráči / hráčů". */
function plural(n: number): string {
  if (n === 1) return "hráč";
  if (n >= 2 && n <= 4) return "hráči";
  return "hráčů";
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
