"use client";

import { useCallback, useEffect, useState } from "react";
import type { MatchPick, PickMarket } from "@/lib/types";
import { PICK_PRESETS } from "@/lib/picks/rules";
import { PREDICTION_READY_SAMPLE } from "@/lib/stats/readiness";
import type {
  BacktestResult,
  BacktestSample,
  BenchmarkTrackRecord,
  TrackRecord,
} from "@/lib/picks/trackRecord";
import type {
  ReliabilityCurve,
  ReliabilityReport,
} from "@/lib/picks/reliability";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { ProLock } from "./ProLock";
import { PickRow } from "./PickRow";
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
  minEdge: number | undefined,
  minReadiness: number | undefined,
  isActive: () => boolean,
  { setLoading, setError, setLocked, setPicks }: PicksSetters
): Promise<void> {
  setLoading(true);
  setError(null);
  try {
    const q = new URLSearchParams({ market, venue, minProb: String(minProb) });
    if (minEdge != null) q.set("minEdge", String(minEdge));
    if (minReadiness != null) q.set("minReadiness", String(minReadiness));
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
  // Value režim: filtruje na tipy s kladnou hranou nad kurzem sázkovky (edge > 0).
  // Vypnutý → kurzy se ignorují (chování jako dnes, čistě pravděpodobnostní práh).
  const [valueOnly, setValueOnly] = useState(false);
  const minEdge = valueOnly ? 0 : undefined;
  // Skrýt tipy s málo daty (default ON) – ochrana na startu sezóny, kdy je vzorek tenký.
  // Gatuje jen seznam nadcházejících tipů, ne historický backtest (ten běží nad vším).
  const [hideUnready, setHideUnready] = useState(true);
  const minReadiness = hideUnready ? PREDICTION_READY_SAMPLE : undefined;

  const [picks, setPicks] = useState<MatchPick[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkTrackRecord | null>(null);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [reliability, setReliability] = useState<ReliabilityReport | null>(null);

  const retry = useCallback(() => {
    void loadPicks(market, venue, minProb, minEdge, minReadiness, () => true, {
      setLoading,
      setError,
      setLocked,
      setPicks,
    });
  }, [market, venue, minProb, minEdge, minReadiness]);

  useEffect(() => {
    let active = true;
    void loadPicks(market, venue, minProb, minEdge, minReadiness, () => active, {
      setLoading,
      setError,
      setLocked,
      setPicks,
    });
    return () => {
      active = false;
    };
  }, [market, venue, minProb, minEdge, minReadiness]);

  // Track-record (globální) + backtest strategie dle navolených parametrů.
  useEffect(() => {
    let active = true;
    const q = new URLSearchParams({ market, venue, minProb: String(minProb) });
    if (minEdge != null) q.set("minEdge", String(minEdge));
    fetch(`/api/picks/stats?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.trackRecord) setTrack(d.trackRecord);
        setBenchmark(d.benchmark ?? null);
        setBacktest(d.backtest ?? null);
        setReliability(d.reliability ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [market, venue, minProb, minEdge]);

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
          { href: "/", label: "Zápasy", emoji: "📅" },
          { href: "/digest", label: "Tipy týdne", emoji: "🔥" },
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/transfers", label: "Přestupy", emoji: "🔄" },
          { href: "/hra", label: "Hra", emoji: "🎮" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Predikční tipy</h1>
      <p className="mt-1 text-sm text-muted">
        Nadcházející zápasy vybrané podle pravidla z předpočítaných predikcí.
      </p>

      {/* Agregátní/historické panely (track-record, benchmark, backtest) jsou FREE –
          budují důvěru. Zamčený je jen seznam konkrétních nadcházejících tipů. */}
      {backtest && (
        <StrategyPanel backtest={backtest} market={market} venue={venue} minProb={minProb} />
      )}
      {track && <TrackRecordPanel track={track} />}
      {benchmark && benchmark.n > 0 && <BenchmarkPanel benchmark={benchmark} />}
      {reliability && <ReliabilityPanel reliability={reliability} />}

      <RuleControls
        market={market}
        venue={venue}
        minProb={minProb}
        valueOnly={valueOnly}
        hideUnready={hideUnready}
        onMarket={setMarket}
        onVenue={setVenue}
        onMinProb={setMinProb}
        onValueOnly={setValueOnly}
        onHideUnready={setHideUnready}
        onPreset={applyPreset}
      />

      {/* Sekce nadcházejících tipů = PRO. FREE/anonym → ProLock místo seznamu. */}
      {locked ? (
        <div className="mt-4">
          <ProLock user={user} trialAvailable={false} onUnlockTrial={() => {}} unlocking={false} />
        </div>
      ) : loading && !picks ? (
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

function BenchmarkPanel({ benchmark }: { benchmark: BenchmarkTrackRecord }) {
  const { n, our, bench } = benchmark;
  if (!our || !bench) return null;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const small = n < 30;
  // Log-loss je férovější ukazatel kvality pravděpodobností než holá přesnost
  // (nižší = lepší). Verdikt podle něj, ne podle argmaxu (ten je zašuměný).
  const better =
    our.logloss < bench.logloss
      ? "our"
      : our.logloss > bench.logloss
        ? "bench"
        : "tie";
  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Náš model vs. API-Football
        </p>
        <span className="text-[11px] text-muted">{n} společných zápasů</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div
          className={`rounded-xl p-2.5 ${
            better === "our" ? "bg-positive/10 ring-1 ring-positive/30" : "bg-background"
          }`}
        >
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {pct(our.accuracy)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Náš model</div>
        </div>
        <div
          className={`rounded-xl p-2.5 ${
            better === "bench" ? "bg-positive/10 ring-1 ring-positive/30" : "bg-background"
          }`}
        >
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {pct(bench.accuracy)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted">API-Football</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Přesnost 1X2 (argmax) na stejných zápasech. Kvalita pravděpodobností (log-loss,
        nižší = lepší):{" "}
        <span className="font-semibold text-foreground">{our.logloss.toFixed(3)}</span> vs{" "}
        {bench.logloss.toFixed(3)} →{" "}
        {better === "our"
          ? "✅ vedeme"
          : better === "bench"
            ? "⚠ vede API-Football"
            : "≈ vyrovnané"}
        .
      </p>
      {small && (
        <p className="mt-2 text-[11px] text-warning">
          Malý vzorek – čísla jsou zatím orientační.
        </p>
      )}
    </section>
  );
}

const RELIABILITY_LABELS: Record<ReliabilityCurve["market"], string> = {
  "1x2": "Výsledek (1X2)",
  over25: "Přes 2.5 gólu",
  btts: "Oba skórují",
};

/**
 * Kalibrace modelu: když řekneme „X %", padne to opravdu v ~X %? Per trh rozbinované
 * predikce vs. skutečnost + ECE (čím níž, tím líp). FREE – buduje důvěru v čísla.
 * Vykreslí se až jsou nějaké odehrané predikce (mimo sezónu prázdno → null).
 */
function ReliabilityPanel({ reliability }: { reliability: ReliabilityReport }) {
  const curves = [reliability.outcome, reliability.over25, reliability.btts];
  if (curves.every((c) => c.n === 0)) return null;
  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Kalibrace modelu
      </p>
      <p className="mt-1 text-[11px] text-muted">
        Když řekneme „X %“, padne to opravdu v ~X %? Predikováno vs. skutečnost.
      </p>
      <div className="mt-3 space-y-4">
        {curves.map((c) => (
          <ReliabilityCurveView key={c.market} curve={c} />
        ))}
      </div>
    </section>
  );
}

function calibrationVerdict(ece: number): { text: string; cls: string } {
  if (ece < 0.05) return { text: "✅ dobře kalibrováno", cls: "text-positive" };
  if (ece < 0.1) return { text: "mírná odchylka", cls: "text-muted" };
  return { text: "⚠ kalibrace odchýlená", cls: "text-warning" };
}

function ReliabilityCurveView({ curve }: { curve: ReliabilityCurve }) {
  const populated = curve.bins.filter((b) => b.count > 0);
  if (populated.length === 0) return null;
  const small = curve.n > 0 && curve.n < 30;
  const verdict = curve.ece == null ? null : calibrationVerdict(curve.ece);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-xs font-semibold text-foreground">
          {RELIABILITY_LABELS[curve.market]}
        </span>
        <span className="text-[11px] text-muted">
          {curve.ece != null && verdict && (
            <>
              ECE <span className="tabular-nums">{curve.ece.toFixed(3)}</span> ·{" "}
              <span className={verdict.cls}>{verdict.text}</span> ·{" "}
            </>
          )}
          n {curve.n}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {populated.map((b) => (
          <ReliabilityBinRow key={b.lower} bin={b} />
        ))}
      </div>
      {small && (
        <p className="mt-1.5 text-[11px] text-warning">
          Malý vzorek – kalibrace je zatím orientační.
        </p>
      )}
    </div>
  );
}

function ReliabilityBinRow({
  bin,
}: {
  bin: ReliabilityCurve["bins"][number];
}) {
  const observed = bin.observed ?? 0;
  const predicted = bin.avgPredicted ?? 0;
  const off = Math.abs(observed - predicted);
  // Barva sloupce dle odchylky pozorováno vs. predikováno (čím blíž diagonále, tím líp).
  const barCls = off < 0.1 ? "bg-positive/70" : off < 0.2 ? "bg-warning/70" : "bg-negative/70";
  const p = (x: number) => Math.round(x * 100);
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="w-14 shrink-0 tabular-nums text-muted">
        {p(bin.lower)}–{p(bin.upper)}
      </span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-border/50">
        {/* Sloupec = pozorovaná četnost; svislá značka = průměrná predikce (ideál = překryv). */}
        <div className={`bar-fill h-full ${barCls}`} style={{ width: `${observed * 100}%` }} />
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground/70"
          style={{ left: `${predicted * 100}%` }}
          title={`Predikováno ${p(predicted)} %`}
        />
      </div>
      <span className="w-20 shrink-0 text-right tabular-nums text-foreground">
        {p(observed)}
        <span className="text-muted"> / {p(predicted)} %</span>
      </span>
      <span className="w-6 shrink-0 text-right tabular-nums text-muted">{bin.count}</span>
    </div>
  );
}

function RuleControls({
  market,
  venue,
  minProb,
  valueOnly,
  hideUnready,
  onMarket,
  onVenue,
  onMinProb,
  onValueOnly,
  onHideUnready,
  onPreset,
}: {
  market: PickMarket;
  venue: Venue;
  minProb: number;
  valueOnly: boolean;
  hideUnready: boolean;
  onMarket: (m: PickMarket) => void;
  onVenue: (v: Venue) => void;
  onMinProb: (p: number) => void;
  onValueOnly: (v: boolean) => void;
  onHideUnready: (v: boolean) => void;
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

      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {/* Value filtr: ponechá jen tipy, kde má model výhodu nad kurzem sázkovky
            (edge > 0). Kurzy se plní jen klubovým ligám blízko výkopu → mimo to prázdno. */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={valueOnly}
            onChange={(e) => onValueOnly(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm font-medium text-foreground">
            Jen value tipy <span className="font-normal text-muted">(kurz výhodný, edge &gt; 0)</span>
          </span>
        </label>
        {/* Readiness gate: skryje tipy s tenkým vzorkem (start sezóny). Default ON. */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hideUnready}
            onChange={(e) => onHideUnready(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm font-medium text-foreground">
            Skrýt málo dat <span className="font-normal text-muted">(jen predikce s dost zápasy)</span>
          </span>
        </label>
      </div>
    </section>
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
