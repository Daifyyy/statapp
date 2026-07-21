"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import type { FixtureDay, UpcomingFixture } from "@/lib/types";
import type { TipMarket, TipRow, TipSelection } from "@/lib/tips/types";
import type { TipStats } from "@/lib/tips/stats";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import type { SessionUser } from "./sessionUser";

type View = "tipovat" | "tipy" | "bilance";

const NAV = [
  { href: "/", label: "Zápasy", emoji: "📅" },
  { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
  { href: "/predikce", label: "Predikce", emoji: "🎯" },
  { href: "/tabulky", label: "Tabulky", emoji: "📊" },
  { href: "/hra", label: "Hra", emoji: "🎮" },
];

/** Trhy a jejich strany pro tipovací formulář (kurzy se ZÁMĚRNĚ nezobrazují). */
const MARKETS: {
  market: TipMarket;
  label: string;
  options: { selection: TipSelection; label: string }[];
}[] = [
  {
    market: "win",
    label: "Vítěz (1X2)",
    options: [
      { selection: "home", label: "1" },
      { selection: "draw", label: "X" },
      { selection: "away", label: "2" },
    ],
  },
  {
    market: "over25",
    label: "Góly (2.5)",
    options: [
      { selection: "over", label: "Přes" },
      { selection: "under", label: "Pod" },
    ],
  },
  {
    market: "btts",
    label: "Oba skórují",
    options: [
      { selection: "yes", label: "Ano" },
      { selection: "no", label: "Ne" },
    ],
  },
];

/**
 * Tipovačka = osobní tréninkový deník. Tipuješ nadcházející zápasy na intuici (kurz je
 * SKRYTÝ), po odehrání vidíš úspěšnost, odhalený kurz a ROI. Tři pohledy: Tipovat /
 * Moje tipy / Bilance. FREE pro přihlášené (anonym → výzva k přihlášení).
 */
export function TipovackaApp({
  days,
  user,
}: {
  days: FixtureDay[];
  user: SessionUser | null;
}) {
  const [view, setView] = useState<View>("tipovat");
  const [tips, setTips] = useState<TipRow[]>([]);
  const [stats, setStats] = useState<TipStats | null>(null);
  const [loading, setLoading] = useState(Boolean(user));

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/tips", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { tips: TipRow[]; stats: TipStats }
        | null;
      if (data?.tips) {
        setTips(data.tips);
        setStats(data.stats);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tipsByFixture = useMemo(() => {
    const map = new Map<number, Map<TipMarket, TipRow>>();
    for (const t of tips) {
      let inner = map.get(t.fixtureId);
      if (!inner) {
        inner = new Map();
        map.set(t.fixtureId, inner);
      }
      inner.set(t.market, t);
    }
    return map;
  }, [tips]);

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
        <AppHeader user={user} nav={NAV} />
        <h1 className="mt-4 text-lg font-semibold text-foreground">Tipovačka</h1>
        <SignInPrompt />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader user={user} nav={NAV} />
      <h1 className="mt-4 text-lg font-semibold text-foreground">Tipovačka</h1>
      <p className="mt-1 text-sm text-muted">
        Tipuj na intuici bez kurzů. Po odehrání uvidíš úspěšnost, odhalený kurz a ROI.
      </p>

      <ViewTabs
        view={view}
        onSelect={setView}
        openCount={stats?.pending ?? 0}
      />

      {view === "tipovat" && (
        <TipovatView days={days} tipsByFixture={tipsByFixture} onPlaced={refresh} />
      )}
      {view === "tipy" && (
        <TipyView tips={tips} loading={loading} onDeleted={refresh} />
      )}
      {view === "bilance" && <BilanceView stats={stats} loading={loading} />}
    </main>
  );
}

function SignInPrompt() {
  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
      <span className="text-3xl" aria-hidden>
        🎯
      </span>
      <h2 className="mt-2 text-base font-semibold text-foreground">
        Vyzkoušej si svou intuici
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        Tipuj výsledky zápasů bez kurzů a sleduj, jak dobře je umíš vyhodnotit –
        úspěšnost i ROI vůči kurzům. Tvoje tipy zůstanou uložené k tvému účtu.
      </p>
      <button
        type="button"
        onClick={() => void signIn("google")}
        className="mt-4 rounded-full bg-positive px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        Přihlásit se a tipovat
      </button>
    </section>
  );
}

function ViewTabs({
  view,
  onSelect,
  openCount,
}: {
  view: View;
  onSelect: (v: View) => void;
  openCount: number;
}) {
  const tabs: { value: View; label: string }[] = [
    { value: "tipovat", label: "Tipovat" },
    { value: "tipy", label: openCount > 0 ? `Moje tipy (${openCount})` : "Moje tipy" },
    { value: "bilance", label: "Bilance" },
  ];
  return (
    <div className="mt-4 inline-flex w-full rounded-full border border-border bg-surface p-0.5">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onSelect(t.value)}
          className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
            t.value === view
              ? "bg-foreground text-background"
              : "text-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────── Tipovat ───────────────────────────

function TipovatView({
  days,
  tipsByFixture,
  onPlaced,
}: {
  days: FixtureDay[];
  tipsByFixture: Map<number, Map<TipMarket, TipRow>>;
  onPlaced: () => Promise<void>;
}) {
  const [dayIdx, setDayIdx] = useState(0);
  // Na živý zápas nejde tipnout (POST /api/tips ho stejně odmítne) → vyřaď ho z nabídky.
  const tippableDays = useMemo(
    () => days.map((d) => ({ ...d, fixtures: d.fixtures.filter((f) => !f.live) })),
    [days]
  );
  const active = tippableDays[dayIdx] ?? tippableDays[0];

  return (
    <>
      <DayTabs days={tippableDays} active={dayIdx} onSelect={setDayIdx} />
      {active && active.fixtures.length > 0 ? (
        <LeagueGroups
          fixtures={active.fixtures}
          tipsByFixture={tipsByFixture}
          onPlaced={onPlaced}
        />
      ) : (
        <Empty>
          Na tento den nemáme zápasy ve sledovaných ligách. Mimo sezónu (léto) top ligy
          nehrají – zkus jiný den.
        </Empty>
      )}
    </>
  );
}

function dayLabel(date: string, idx: number): string {
  if (idx === 0) return "Dnes";
  if (idx === 1) return "Zítra";
  return new Date(`${date}T00:00:00`).toLocaleDateString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

function DayTabs({
  days,
  active,
  onSelect,
}: {
  days: FixtureDay[];
  active: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="mt-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {days.map((d, i) => (
        <button
          key={d.date}
          type="button"
          onClick={() => onSelect(i)}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition ${
            i === active
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-surface text-muted hover:text-foreground"
          }`}
        >
          {dayLabel(d.date, i)}
          <span className="ml-1.5 text-xs opacity-70">({d.fixtures.length})</span>
        </button>
      ))}
    </div>
  );
}

interface LeagueGroup {
  leagueId: number;
  name: string;
  logoUrl: string;
  fixtures: UpcomingFixture[];
}

function LeagueGroups({
  fixtures,
  tipsByFixture,
  onPlaced,
}: {
  fixtures: UpcomingFixture[];
  tipsByFixture: Map<number, Map<TipMarket, TipRow>>;
  onPlaced: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const groups = useMemo<LeagueGroup[]>(() => {
    const map = new Map<number, LeagueGroup>();
    for (const f of fixtures) {
      let g = map.get(f.leagueId);
      if (!g) {
        g = { leagueId: f.leagueId, name: f.leagueName, logoUrl: f.leagueLogoUrl, fixtures: [] };
        map.set(f.leagueId, g);
      }
      g.fixtures.push(f);
    }
    return [...map.values()];
  }, [fixtures]);

  return (
    <div className="mt-4 space-y-5">
      {groups.map((g) => (
        <section key={g.leagueId}>
          <div className="flex items-center gap-2 px-1">
            <TeamLogo src={g.logoUrl} alt={g.name} size={18} />
            <h2 className="text-sm font-semibold text-foreground">{g.name}</h2>
          </div>
          <ul className="mt-2 space-y-2">
            {g.fixtures.map((f) => (
              <TipFixtureCard
                key={f.fixtureId}
                fixture={f}
                existing={tipsByFixture.get(f.fixtureId)}
                open={expanded === f.fixtureId}
                onToggle={() =>
                  setExpanded((cur) => (cur === f.fixtureId ? null : f.fixtureId))
                }
                onPlaced={onPlaced}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TipFixtureCard({
  fixture,
  existing,
  open,
  onToggle,
  onPlaced,
}: {
  fixture: UpcomingFixture;
  existing: Map<TipMarket, TipRow> | undefined;
  open: boolean;
  onToggle: () => void;
  onPlaced: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<TipMarket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = new Date(fixture.kickoff).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const tipCount = existing?.size ?? 0;

  async function place(market: TipMarket, selection: TipSelection) {
    setBusy(market);
    setError(null);
    try {
      const res = await fetch("/api/tips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixtureId: fixture.fixtureId,
          leagueId: fixture.leagueId,
          leagueName: fixture.leagueName,
          kickoff: fixture.kickoff,
          homeTeamId: fixture.home.id,
          awayTeamId: fixture.away.id,
          homeName: fixture.home.name,
          awayName: fixture.away.name,
          homeLogo: fixture.home.logoUrl,
          awayLogo: fixture.away.logoUrl,
          national: fixture.national,
          market,
          selection,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(d?.error ?? "Tip se nepodařilo uložit");
        return;
      }
      await onPlaced();
    } catch {
      setError("Tip se nepodařilo uložit");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-xl border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="w-10 shrink-0 text-[11px] leading-tight text-muted">{time}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <TeamLogo src={fixture.home.logoUrl} alt={fixture.home.name} size={20} />
          <span className="min-w-0 truncate font-medium text-home">{fixture.home.name}</span>
          <span className="shrink-0 text-muted">–</span>
          <TeamLogo src={fixture.away.logoUrl} alt={fixture.away.name} size={20} />
          <span className="min-w-0 truncate font-medium text-away">{fixture.away.name}</span>
        </div>
        {tipCount > 0 && (
          <span className="shrink-0 rounded-full bg-positive/15 px-2 py-0.5 text-[11px] font-semibold text-positive">
            {tipCount} tip{tipCount > 1 ? "y" : ""}
          </span>
        )}
        <span className="shrink-0 text-muted" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3">
          <div className="space-y-3">
            {MARKETS.map((m) => {
              const current = existing?.get(m.market)?.selection;
              return (
                <div key={m.market} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs font-medium text-muted">{m.label}</span>
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {m.options.map((o) => {
                      const selected = current === o.selection;
                      return (
                        <button
                          key={o.selection}
                          type="button"
                          disabled={busy === m.market}
                          onClick={() => void place(m.market, o.selection)}
                          className={`min-w-11 rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                            selected
                              ? "border-positive bg-positive text-white"
                              : "border-border bg-background text-foreground hover:border-foreground/40"
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Poznámka (proč tipuješ tak) – volitelné"
            maxLength={280}
            className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-foreground/40 focus:outline-none"
          />

          {error && <p className="mt-2 text-xs text-negative">{error}</p>}
          <p className="mt-2 text-[11px] text-muted">
            Kurz teď schválně nevidíš – tipuješ na intuici. Odhalí se u vyhodnocení.
          </p>
        </div>
      )}
    </li>
  );
}

// ─────────────────────────── Moje tipy ───────────────────────────

function selectionText(t: TipRow): string {
  switch (t.selection) {
    case "home":
      return `Výhra: ${t.homeName}`;
    case "draw":
      return "Remíza";
    case "away":
      return `Výhra: ${t.awayName}`;
    case "over":
      return `Přes ${t.line ?? 2.5} gólu`;
    case "under":
      return `Pod ${t.line ?? 2.5} gólu`;
    case "yes":
      return "Oba dají gól";
    case "no":
      return "Oba nedají gól";
  }
}

/** Profit tipu v jednotkách (jen když je znám kurz). */
function tipProfit(t: TipRow): number | null {
  if (t.odds == null || t.hit == null) return null;
  return t.hit ? t.stake * (t.odds - 1) : -t.stake;
}

function TipyView({
  tips,
  loading,
  onDeleted,
}: {
  tips: TipRow[];
  loading: boolean;
  onDeleted: () => Promise<void>;
}) {
  if (loading) return <Empty>Načítám tvoje tipy…</Empty>;
  if (tips.length === 0)
    return <Empty>Zatím nemáš žádný tip. Přepni na „Tipovat“ a vyber zápas.</Empty>;

  const open = tips.filter((t) => t.hit == null);
  const settled = tips.filter((t) => t.hit != null);

  return (
    <div className="mt-4 space-y-5">
      {open.length > 0 && (
        <section>
          <h2 className="px-1 text-sm font-semibold text-foreground">Čeká na výsledek</h2>
          <ul className="mt-2 space-y-2">
            {open.map((t) => (
              <OpenTipRow key={t.id} tip={t} onDeleted={onDeleted} />
            ))}
          </ul>
        </section>
      )}
      {settled.length > 0 && (
        <section>
          <h2 className="px-1 text-sm font-semibold text-foreground">Vyhodnocené</h2>
          <ul className="mt-2 space-y-2">
            {settled.map((t) => (
              <SettledTipRow key={t.id} tip={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TipHeader({ tip }: { tip: TipRow }) {
  const date = new Date(tip.kickoff).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
  });
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-9 shrink-0 text-[11px] leading-tight text-muted">{date}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <TeamLogo src={tip.homeLogo ?? ""} alt={tip.homeName} size={18} />
        <span className="min-w-0 truncate font-medium text-home">{tip.homeName}</span>
        <span className="shrink-0 text-muted">–</span>
        <TeamLogo src={tip.awayLogo ?? ""} alt={tip.awayName} size={18} />
        <span className="min-w-0 truncate font-medium text-away">{tip.awayName}</span>
      </div>
    </div>
  );
}

function OpenTipRow({
  tip,
  onDeleted,
}: {
  tip: TipRow;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tips/${tip.id}`, { method: "DELETE" });
      if (res.ok) await onDeleted();
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm">
      <TipHeader tip={tip} />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">{selectionText(tip)}</span>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="shrink-0 text-xs text-muted transition hover:text-negative disabled:opacity-50"
        >
          Smazat
        </button>
      </div>
      {tip.note && <p className="mt-1 text-[11px] italic text-muted">„{tip.note}“</p>}
    </li>
  );
}

function SettledTipRow({ tip }: { tip: TipRow }) {
  const profit = tipProfit(tip);
  return (
    <li className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <TipHeader tip={tip} />
        </div>
        <span className="shrink-0 font-bold tabular-nums text-foreground">
          {tip.homeGoals}:{tip.awayGoals}
        </span>
        <span
          className={`shrink-0 text-sm font-bold ${tip.hit ? "text-positive" : "text-negative"}`}
          aria-label={tip.hit ? "Tip vyšel" : "Tip nevyšel"}
        >
          {tip.hit ? "✓" : "✗"}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        <span className="font-medium text-foreground">{selectionText(tip)}</span>
        {tip.odds != null ? (
          <>
            <span>· kurz {tip.odds.toFixed(2)}</span>
            {tip.oddsBook && <span>({tip.oddsBook})</span>}
            {profit != null && (
              <span className={profit >= 0 ? "text-positive" : "text-negative"}>
                · {profit >= 0 ? "+" : ""}
                {profit.toFixed(2)} j
              </span>
            )}
          </>
        ) : tip.national ? (
          <span title="U reprezentačních zápasů se kurzy nesledují (v API často nejsou) – tip se počítá do úspěšnosti, ne do ROI.">
            · kurzy u reprezentací se nesledují
          </span>
        ) : (
          <span title="Kurz se snapshotuje v okamžiku vložení tipu (nezávisle na výsledku). Sázkovka pro tento zápas tehdy kurz neměla – časté mimo top ligy nebo daleko před výkopem. Tip se počítá do úspěšnosti, ne do ROI.">
            · kurz nebyl k dispozici
          </span>
        )}
      </div>
      {tip.note && <p className="mt-1 text-[11px] italic text-muted">„{tip.note}“</p>}
    </li>
  );
}

// ─────────────────────────── Bilance ───────────────────────────

function pct(x: number | null): string {
  return x == null ? "—" : `${Math.round(x * 100)} %`;
}

const MARKET_LABEL: Record<TipMarket, string> = {
  win: "Vítěz (1X2)",
  over25: "Góly (2.5)",
  btts: "Oba skórují",
};

function BilanceView({ stats, loading }: { stats: TipStats | null; loading: boolean }) {
  if (loading) return <Empty>Načítám bilanci…</Empty>;
  if (!stats || stats.settled === 0)
    return (
      <Empty>
        Zatím nemáš vyhodnocený tip. Bilance (úspěšnost + ROI) se naplní, jakmile se
        odehrají zápasy, které jsi tipnul.
      </Empty>
    );

  const roi = stats.roi;
  const profit = stats.profit;

  return (
    <div className="mt-4 space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Úspěšnost" value={pct(stats.accuracy)} sub={`${stats.hits}/${stats.settled}`} />
        <StatCard
          label="ROI"
          value={roi == null ? "—" : `${roi >= 0 ? "+" : ""}${Math.round(roi * 100)} %`}
          tone={roi == null ? "neutral" : roi >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Zisk"
          value={`${profit >= 0 ? "+" : ""}${profit.toFixed(2)} j`}
          tone={profit >= 0 ? "positive" : "negative"}
          sub={`vsazeno ${stats.staked.toFixed(0)} j`}
        />
        <StatCard label="Čeká" value={String(stats.pending)} sub="na výsledek" />
      </div>

      <section>
        <h2 className="px-1 text-sm font-semibold text-foreground">Podle trhu</h2>
        <div className="mt-2 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Trh</th>
                <th className="px-3 py-2 text-right font-medium">Úspěšnost</th>
                <th className="px-3 py-2 text-right font-medium">ROI</th>
                <th className="px-3 py-2 text-right font-medium">Zisk</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(stats.byMarket) as TipMarket[]).map((k) => {
                const m = stats.byMarket[k];
                if (m.settled === 0) return null;
                return (
                  <tr key={k} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground">{MARKET_LABEL[k]}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {pct(m.accuracy)}{" "}
                      <span className="text-xs text-muted">({m.hits}/{m.settled})</span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        m.roi == null
                          ? "text-muted"
                          : m.roi >= 0
                            ? "text-positive"
                            : "text-negative"
                      }`}
                    >
                      {m.roi == null ? "—" : `${m.roi >= 0 ? "+" : ""}${Math.round(m.roi * 100)} %`}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        m.profit >= 0 ? "text-positive" : "text-negative"
                      }`}
                    >
                      {m.profit >= 0 ? "+" : ""}
                      {m.profit.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {stats.vsModel && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">Ty vs model (1X2)</h2>
          <p className="mt-1 text-xs text-muted">
            Na {stats.vsModel.n} zápasech, kde tipuješ vítěze a máme i modelovou predikci.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatCard label="Ty" value={pct(stats.vsModel.you)} />
            <StatCard label="Model" value={pct(stats.vsModel.model)} />
          </div>
        </section>
      )}

      <p className="px-1 text-[11px] text-muted">
        ROI je vůči kurzu snapshotnutému při vložení tipu (Pinnacle, jinak fallback
        sázkovka). Tipy bez dostupného kurzu se počítají do úspěšnosti, ne do ROI.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const valueColor =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-3 text-center">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}
