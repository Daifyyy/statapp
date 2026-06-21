"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { MatchPick, PickMarket } from "@/lib/types";
import { PICK_PRESETS } from "@/lib/picks/rules";
import { isNationalTournamentLeague } from "@/lib/data/catalog";
import type { BacktestResult, BacktestSample, TrackRecord } from "@/lib/picks/trackRecord";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { ProLock } from "./ProLock";
import type { SessionUser } from "./sessionUser";

type Venue = "home" | "away" | "any";

const MARKET_LABELS: Record<PickMarket, string> = {
  win: "Výhra",
  over25: "Přes 2.5 gólu",
  btts: "Oba skórují",
};

interface PicksSetters {
  setLoading: (v: boolean) => void;
  setError: (v: string | null) => void;
  setLocked: (v: boolean) => void;
  setPicks: (v: MatchPick[] | null) => void;
}

// Mimo komponentu (vzor CompareApp): žádné synchronní setState přímo v efektu.
async function loadPicks(
  market: PickMarket,
  venue: Venue,
  minProb: number,
  isActive: () => boolean,
  { setLoading, setError, setLocked, setPicks }: PicksSetters
): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const q = new URLSearchParams({ market, venue, minProb: String(minProb) });
    const r = await fetch(`/api/picks?${q.toString()}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Chyba tipů");
    if (!isActive()) return;
    if (d.locked) {
      setLocked(true);
      setPicks(null);
    } else {
      setLocked(false);
      setPicks(d.picks ?? []);
    }
  } catch (e) {
    if (isActive()) setError(e instanceof Error ? e.message : "Chyba tipů");
  } finally {
    if (isActive()) setLoading(false);
  }
}

export function PicksApp({ user }: { user: SessionUser | null }) {
  const [market, setMarket] = useState<PickMarket>("win");
  const [venue, setVenue] = useState<Venue>("home");
  const [minProb, setMinProb] = useState(0.65);

  const [picks, setPicks] = useState<MatchPick[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);

  const retry = useCallback(() => {
    void loadPicks(market, venue, minProb, () => true, {
      setLoading,
      setError,
      setLocked,
      setPicks,
    });
  }, [market, venue, minProb]);

  useEffect(() => {
    let active = true;
    void loadPicks(market, venue, minProb, () => active, {
      setLoading,
      setError,
      setLocked,
      setPicks,
    });
    return () => {
      active = false;
    };
  }, [market, venue, minProb]);

  // Track-record (globální) + backtest strategie dle navolených parametrů.
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams({ market, venue, minProb: String(minProb) });
    fetch(`/api/picks/stats?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.trackRecord) setTrack(d.trackRecord);
        setBacktest(d.backtest ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [market, venue, minProb]);

  function applyPreset(rule: { market: PickMarket; venue: Venue; minProb: number }) {
    setMarket(rule.market);
    setVenue(rule.venue);
    setMinProb(rule.minProb);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/", label: "Porovnání", emoji: "⇄" },
          { href: "/transfers", label: "Přestupy", emoji: "🔄" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Predikční tipy</h1>
      <p className="mt-1 text-sm text-muted">
        Nadcházející zápasy vybrané podle pravidla z předpočítaných predikcí.
      </p>

      {locked ? (
        <div className="mt-4">
          <ProLock user={user} trialAvailable={false} onUnlockTrial={() => {}} unlocking={false} />
        </div>
      ) : (
        <>
          {backtest && (
            <StrategyPanel backtest={backtest} market={market} venue={venue} minProb={minProb} />
          )}
          {track && <TrackRecordPanel track={track} />}

          <RuleControls
            market={market}
            venue={venue}
            minProb={minProb}
            onMarket={setMarket}
            onVenue={setVenue}
            onMinProb={setMinProb}
            onPreset={applyPreset}
          />

          {loading && !picks ? (
            <PicksSkeleton />
          ) : error ? (
            <Empty>
              <p>{error}</p>
              <button
                type="button"
                onClick={retry}
                className="mt-3 rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground transition hover:bg-background"
              >
                ↻ Zkusit znovu
              </button>
            </Empty>
          ) : picks && picks.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {picks.map((p) => (
                <PickRow key={p.fixtureId} pick={p} />
              ))}
            </ul>
          ) : (
            <Empty>
              Žádné nadcházející zápasy neodpovídají pravidlu. Mimo sezónu (léto) nemají
              top ligy naplánované zápasy – zkus jiné pravidlo nebo se vrať během sezóny.
            </Empty>
          )}
        </>
      )}
    </main>
  );
}

const VENUE_LABELS: Record<Venue, string> = {
  home: "doma",
  away: "venku",
  any: "doma i venku",
};

function strategyLabel(market: PickMarket, venue: Venue, minProb: number): string {
  const pct = Math.round(minProb * 100);
  if (market === "over25") return `Přes 2.5 gólu ≥ ${pct} %`;
  if (market === "btts") return `Oba skórují ≥ ${pct} %`;
  return `Favorit ${VENUE_LABELS[venue]} ≥ ${pct} %`;
}

function StrategyPanel({
  backtest,
  market,
  venue,
  minProb,
}: {
  backtest: BacktestResult;
  market: PickMarket;
  venue: Venue;
  minProb: number;
}) {
  const small = backtest.n > 0 && backtest.n < 30;
  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Tvoje strategie v historii
        </p>
        <span className="text-[11px] text-muted">{backtest.n} vsazených tipů</span>
      </div>
      <p className="mt-1 text-[11px] text-muted">{strategyLabel(market, venue, minProb)}</p>
      {backtest.n === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Žádné odehrané zápasy v historii neodpovídají tomuto pravidlu. Zkus nižší práh
          nebo jiný trh.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {Math.round((backtest.hitRate ?? 0) * 100)} %
            </span>
            <span className="text-sm text-muted">
              úspěšnost ({backtest.hits} / {backtest.n})
            </span>
          </div>
          {small && (
            <p className="mt-2 text-[11px] text-warning">
              Malý vzorek – čísla jsou zatím orientační.
            </p>
          )}
          {backtest.samples.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Posledních {backtest.samples.length} z {backtest.n} tipů
              </p>
              <ul className="mt-2 space-y-1.5">
                {backtest.samples.map((s) => (
                  <SampleRow key={s.fixtureId} sample={s} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function sampleTipLabel(sample: BacktestSample): string {
  if (sample.market === "over25") return MARKET_LABELS.over25;
  if (sample.market === "btts") return MARKET_LABELS.btts;
  return sample.side === "home" ? "Domácí výhra" : "Hostující výhra";
}

function SampleRow({ sample }: { sample: BacktestSample }) {
  const date = new Date(sample.kickoff).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
  });
  return (
    <li className="rounded-lg bg-background px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 text-sm font-bold ${
            sample.hit ? "text-positive" : "text-negative"
          }`}
          aria-label={sample.hit ? "Tip vyšel" : "Tip nevyšel"}
        >
          {sample.hit ? "✓" : "✗"}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
          <TeamLogo src={sample.home.logoUrl} alt={sample.home.name} size={16} />
          <span className="min-w-0 truncate font-medium text-home">{sample.home.name}</span>
          <span className="shrink-0 font-bold tabular-nums text-foreground">
            {sample.homeGoals}:{sample.awayGoals}
          </span>
          <span className="min-w-0 truncate font-medium text-away">{sample.away.name}</span>
          <TeamLogo src={sample.away.logoUrl} alt={sample.away.name} size={16} />
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
        <span className="truncate">
          {date} · {sampleTipLabel(sample)}
        </span>
        <span className="shrink-0 tabular-nums">{Math.round(sample.prob * 100)} %</span>
      </div>
    </li>
  );
}

function TrackRecordPanel({ track }: { track: TrackRecord }) {
  const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);
  const small = track.n > 0 && track.n < 30;
  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Úspěšnost modelu
        </p>
        <span className="text-[11px] text-muted">{track.n} odehraných predikcí</span>
      </div>
      {track.n === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Zatím nemáme odehrané predikce. Track-record se naplní, jak budou zápasy odehrané.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Výsledek (1X2)" value={pct(track.outcomeAccuracy)} />
            <Stat label="Přes 2.5" value={pct(track.over25Accuracy)} />
            <Stat label="Oba skórují" value={pct(track.bttsAccuracy)} />
          </div>
          {small && (
            <p className="mt-2 text-[11px] text-warning">
              Malý vzorek – čísla jsou zatím orientační.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background p-2">
      <div className="text-lg font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function RuleControls({
  market,
  venue,
  minProb,
  onMarket,
  onVenue,
  onMinProb,
  onPreset,
}: {
  market: PickMarket;
  venue: Venue;
  minProb: number;
  onMarket: (m: PickMarket) => void;
  onVenue: (v: Venue) => void;
  onMinProb: (p: number) => void;
  onPreset: (rule: { market: PickMarket; venue: Venue; minProb: number }) => void;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Rychlá volba</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PICK_PRESETS.map((preset) => {
          const active =
            preset.rule.market === market &&
            preset.rule.venue === venue &&
            Math.abs(preset.rule.minProb - minProb) < 0.001;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPreset(preset.rule)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted hover:text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Trh</span>
          <select
            value={market}
            onChange={(e) => onMarket(e.target.value as PickMarket)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-base"
          >
            <option value="win">{MARKET_LABELS.win}</option>
            <option value="over25">{MARKET_LABELS.over25}</option>
            <option value="btts">{MARKET_LABELS.btts}</option>
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Místo</span>
          <select
            value={venue}
            onChange={(e) => onVenue(e.target.value as Venue)}
            disabled={market !== "win"}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-base disabled:opacity-50"
          >
            <option value="home">Doma</option>
            <option value="away">Venku</option>
            <option value="any">Oboje</option>
          </select>
        </label>

        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
            Min. pravděpodobnost: {Math.round(minProb * 100)} %
          </span>
          <input
            type="range"
            min={0.5}
            max={0.9}
            step={0.05}
            value={minProb}
            onChange={(e) => onMinProb(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
      </div>
    </section>
  );
}

function PickRow({ pick }: { pick: MatchPick }) {
  const date = new Date(pick.kickoff).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
  });
  const time = new Date(pick.kickoff).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Reprezentační turnaje (MS) se v plném porovnání neotevírají – týmy jsou
  // cross-konfederační a deep-link (mode=CLUB) by nesedl → vykreslíme neklikací kartu.
  const national = isNationalTournamentLeague(pick.leagueId);
  const href = `/?mode=CLUB&homeLeague=${pick.leagueId}&awayLeague=${pick.leagueId}&home=${pick.home.id}&away=${pick.away.id}`;
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <>
      <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] leading-tight text-muted">
            {date} {time}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <TeamLogo src={pick.home.logoUrl} alt={pick.home.name} size={20} />
            <span className="min-w-0 truncate font-medium text-home">{pick.home.name}</span>
            <span className="shrink-0 text-muted">–</span>
            <TeamLogo src={pick.away.logoUrl} alt={pick.away.name} size={20} />
            <span className="min-w-0 truncate font-medium text-away">{pick.away.name}</span>
          </div>
          <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
            {Math.round(pick.prob * 100)} %
          </span>
        </div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">
        {pick.explanation}
      </div>
    </>
  );
  return (
    <li>
      {national ? (
        <div className={cardClass}>{inner}</div>
      ) : (
        <Link
          href={href}
          className={`${cardClass} transition hover:border-foreground/30`}
        >
          {inner}
        </Link>
      )}
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function PicksSkeleton() {
  return (
    <div className="mt-4 space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-xl bg-border/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
