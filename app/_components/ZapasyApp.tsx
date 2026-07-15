"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import type {
  FixtureDay,
  LiveScore,
  SettledMatch,
  UpcomingFixture,
} from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { RankBadge } from "./RankBadge";
import { buildCompareHref } from "./compareHref";
import type { SessionUser } from "./sessionUser";

type View = "program" | "results";

/** Stabilní prázdné pole (nemění referenci mezi rendery → nezpouští efekty nadarmo). */
const NO_FIXTURES: UpcomingFixture[] = [];

/** Živý zápas svítí, dokud je jeho výkop v tomto okně před „teď" (plausibilita pollu). */
const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;

/** Je pravděpodobné, že se právě něco hraje (→ smysl pollovat živé skóre)? */
function plausiblyLive(fixtures: UpcomingFixture[], now: number): boolean {
  return fixtures.some((f) => {
    if (f.live) return true;
    const k = new Date(f.kickoff).getTime();
    return k <= now && k >= now - LIVE_WINDOW_MS;
  });
}

/**
 * Klientský poll živého skóre (~90 s). Běží jen když je záložka viditelná a je plausibilně
 * živo (jinak 0 volání – offseason ticho). Náklad stropuje sdílená serverová cache.
 */
function useLiveScores(
  enabled: boolean,
  fixtures: UpcomingFixture[]
): { scores: Map<number, LiveScore>; loaded: boolean } {
  const [scores, setScores] = useState<Map<number, LiveScore>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function tick(): Promise<void> {
      if (document.hidden || !plausiblyLive(fixtures, Date.now())) return;
      try {
        const r = await fetch("/api/fixtures/live");
        const d: { live?: LiveScore[] } = await r.json();
        if (!active) return;
        const map = new Map<number, LiveScore>();
        for (const l of d.live ?? []) map.set(l.fixtureId, l);
        setScores(map);
        setLoaded(true);
      } catch {
        // živý stav je best-effort – necháme běžet SSR snapshot
      }
    }
    void tick();
    const timer = setInterval(() => void tick(), 90_000);
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, fixtures]);

  return { scores, loaded };
}

/**
 * Autoritativní překryv SSR snapshotu živým skóre: běžící zápas přepíše minutu/skóre,
 * zápas, který ze živé sady vypadl (dohráno), z Programu **zmizí** (opraví i stale SSR).
 * Dokud poll neproběhl (`loaded=false`), věříme SSR (nic neskrýváme).
 */
function mergeLive(
  fixtures: UpcomingFixture[],
  scores: Map<number, LiveScore>,
  loaded: boolean
): UpcomingFixture[] {
  return fixtures
    .filter((f) => {
      if (scores.has(f.fixtureId)) return true; // právě běží
      return !(loaded && f.live); // byl živý, teď už není → dohráno → ven
    })
    .map((f) => {
      const l = scores.get(f.fixtureId);
      if (!l) return f;
      return {
        ...f,
        live: true,
        elapsed: l.elapsed,
        liveHome: l.homeGoals,
        liveAway: l.awayGoals,
      };
    });
}

/** Oblíbené: live první, pak dle výkopu (primární sekce nahoře). */
function sortFavorites(a: UpcomingFixture, b: UpcomingFixture): number {
  const al = a.live ? 0 : 1;
  const bl = b.live ? 0 : 1;
  if (al !== bl) return al - bl;
  return a.kickoff.localeCompare(b.kickoff);
}

/** Oblíbené IDs uživatele (PRO) + optimistický toggle s revertem při chybě. */
function useFavorites(isPro: boolean): {
  favFixtures: Set<number>;
  favLeagues: Set<number>;
  toggle: (type: "fixture" | "league", id: number, on: boolean) => void;
} {
  const [favFixtures, setFavFixtures] = useState<Set<number>>(new Set());
  const [favLeagues, setFavLeagues] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isPro) return;
    let active = true;
    fetch("/api/fixtures/favorites")
      .then((r) => r.json())
      .then((d: { locked?: boolean; fixtures?: number[]; leagues?: number[] }) => {
        if (!active || d.locked) return;
        setFavFixtures(new Set(d.fixtures ?? []));
        setFavLeagues(new Set(d.leagues ?? []));
      })
      .catch(() => {
        // bez oblíbených se Program vykreslí normálně
      });
    return () => {
      active = false;
    };
  }, [isPro]);

  const toggle = useCallback(
    (type: "fixture" | "league", id: number, on: boolean) => {
      const setter = type === "fixture" ? setFavFixtures : setFavLeagues;
      const apply = (add: boolean) =>
        setter((prev) => {
          const n = new Set(prev);
          if (add) n.add(id);
          else n.delete(id);
          return n;
        });
      apply(on); // optimistic
      fetch("/api/fixtures/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, id, on }),
      })
        .then((r) => {
          if (!r.ok) apply(!on); // revert
        })
        .catch(() => apply(!on));
    },
    []
  );

  return { favFixtures, favLeagues, toggle };
}

/**
 * Záložka „Zápasy" = domovská obrazovka pro rychlý přístup k predikci. Dvě části
 * (přepínač): **Program** = nadcházející zápasy seskupené podle ligy (klik = Porovnání
 * s předvyplněnými týmy + predikcí, bez ručního zadávání) a **Výsledky** = jak dopadly
 * naše nedávné predikce (skóre + ✓/✗). Seznamy jsou jen navigace – nic se nepočítá živě.
 */
export function ZapasyApp({
  days,
  results,
  user,
}: {
  days: FixtureDay[];
  results: SettledMatch[];
  user: SessionUser | null;
}) {
  const [view, setView] = useState<View>("program");
  const [dayIdx, setDayIdx] = useState(0);
  const [onlyFav, setOnlyFav] = useState(false);
  const [proCta, setProCta] = useState(false);
  const active = days[dayIdx] ?? days[0];
  const isPro = user?.tier === "PRO";

  const { scores, loaded } = useLiveScores(
    view === "program",
    active?.fixtures ?? NO_FIXTURES
  );
  const { favFixtures, favLeagues, toggle } = useFavorites(!!isPro);

  // SSR snapshot překrytý živým skóre (dohrané zmizí, běžící přepíšou minutu/skóre).
  const dayFixtures = useMemo(
    () => mergeLive(active?.fixtures ?? NO_FIXTURES, scores, loaded),
    [active, scores, loaded]
  );

  const isFavorite = useCallback(
    (f: UpcomingFixture) => favFixtures.has(f.fixtureId) || favLeagues.has(f.leagueId),
    [favFixtures, favLeagues]
  );
  const favList = useMemo(
    () => dayFixtures.filter(isFavorite).sort(sortFavorites),
    [dayFixtures, isFavorite]
  );

  // Klik na hvězdu: PRO toggluje, ostatní dostanou PRO CTA (žádná perzistence).
  const onFavClick = useCallback(
    (type: "fixture" | "league", id: number, on: boolean) => {
      if (isPro) toggle(type, id, on);
      else setProCta(true);
    },
    [isPro, toggle]
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader
        user={user}
        nav={[
          { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
          { href: "/tabulky", label: "Tabulky", emoji: "📊" },
          { href: "/predikce", label: "Tipy", emoji: "📈" },
          { href: "/transfers", label: "Přestupy", emoji: "🔄" },
          { href: "/hra", label: "Hra", emoji: "🎮" },
          { href: "/tipovacka", label: "Tipovačka", emoji: "🎲" },
        ]}
      />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Zápasy</h1>
      <p className="mt-1 text-sm text-muted">
        {view === "program"
          ? "Vyber zápas a rovnou se otevře porovnání týmů s predikcí."
          : "Jak dopadly naše nedávné predikce – skóre a zda jsme trefili výsledek."}
      </p>

      <ViewTabs view={view} onSelect={setView} resultCount={results.length} />

      {view === "program" ? (
        <>
          <DayTabs days={days} active={dayIdx} onSelect={setDayIdx} />

          {proCta && (
            <ProCtaBanner
              signedIn={!!user}
              onDismiss={() => setProCta(false)}
            />
          )}

          {(favFixtures.size > 0 || favLeagues.size > 0) && (
            <FavoriteToggle onlyFav={onlyFav} onChange={setOnlyFav} />
          )}

          {active && dayFixtures.length > 0 ? (
            <>
              {!onlyFav && favList.length > 0 && (
                <FavoritesSection
                  fixtures={favList}
                  favFixtures={favFixtures}
                  onToggleFixture={(id, on) => onFavClick("fixture", id, on)}
                />
              )}
              {onlyFav ? (
                favList.length > 0 ? (
                  <FavoritesSection
                    fixtures={favList}
                    favFixtures={favFixtures}
                    onToggleFixture={(id, on) => onFavClick("fixture", id, on)}
                  />
                ) : (
                  <Empty>
                    Na tento den nemáš žádný oblíbený zápas. Přidej si zápas nebo ligu
                    hvězdičkou, nebo vypni filtr „Jen oblíbené&ldquo;.
                  </Empty>
                )
              ) : (
                <LeagueGroups
                  fixtures={dayFixtures}
                  favFixtures={favFixtures}
                  favLeagues={favLeagues}
                  onToggleFixture={(id, on) => onFavClick("fixture", id, on)}
                  onToggleLeague={(id, on) => onFavClick("league", id, on)}
                />
              )}
            </>
          ) : (
            <Empty>
              Na tento den nemáme naplánované zápasy ve sledovaných ligách. Mimo sezónu
              (léto) top ligy nehrají – zkus jiný den nebo se vrať během sezóny.
            </Empty>
          )}
        </>
      ) : results.length > 0 ? (
        <ResultsList results={results} />
      ) : (
        <Empty>
          Zatím nemáme vyhodnocené predikce. Výsledky se naplní, jakmile se odehrají
          zápasy z našich sledovaných lig.
        </Empty>
      )}
    </main>
  );
}

function FavoriteToggle({
  onlyFav,
  onChange,
}: {
  onlyFav: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mt-3 flex justify-end">
      <button
        type="button"
        onClick={() => onChange(!onlyFav)}
        aria-pressed={onlyFav}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          onlyFav
            ? "border-warning bg-warning/10 text-foreground"
            : "border-border bg-surface text-muted hover:text-foreground"
        }`}
      >
        {onlyFav ? "★" : "☆"} Jen oblíbené
      </button>
    </div>
  );
}

function ProCtaBanner({
  signedIn,
  onDismiss,
}: {
  signedIn: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <span className="text-foreground">
        ⭐ Oblíbené zápasy a ligy jsou funkce PRO.
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {!signedIn && (
          <button
            type="button"
            onClick={() => void signIn("google")}
            className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background transition hover:opacity-90"
          >
            Přihlásit se
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Zavřít"
          className="text-muted transition hover:text-foreground"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Primární sekce oblíbených zápasů (plochá, nad ligovými kontejnery; live první). */
function FavoritesSection({
  fixtures,
  favFixtures,
  onToggleFixture,
}: {
  fixtures: UpcomingFixture[];
  favFixtures: Set<number>;
  onToggleFixture: (id: number, on: boolean) => void;
}) {
  return (
    <section className="mt-4">
      <div className="flex items-center gap-2 px-1">
        <span aria-hidden>⭐</span>
        <h2 className="text-sm font-semibold text-foreground">Oblíbené</h2>
      </div>
      <ul className="mt-2 space-y-2">
        {fixtures.map((f) => (
          <FixtureRow
            key={f.fixtureId}
            fixture={f}
            isFavorite={favFixtures.has(f.fixtureId)}
            onToggleFavorite={(on) => onToggleFixture(f.fixtureId, on)}
          />
        ))}
      </ul>
    </section>
  );
}

function ViewTabs({
  view,
  onSelect,
  resultCount,
}: {
  view: View;
  onSelect: (v: View) => void;
  resultCount: number;
}) {
  const tabs: { value: View; label: string }[] = [
    { value: "program", label: "Program" },
    {
      value: "results",
      label: resultCount > 0 ? `Výsledky (${resultCount})` : "Výsledky",
    },
  ];
  return (
    <div className="mt-4 inline-flex w-full rounded-full border border-border bg-surface p-0.5">
      {tabs.map((t) => {
        const activeTab = t.value === view;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onSelect(t.value)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              activeTab
                ? "bg-foreground text-background"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// idx 0 → „Dnes", 1 → „Zítra", dál krátký den v týdnu + datum (So 28. 6.).
function dayLabel(date: string, idx: number): string {
  if (idx === 0) return "Dnes";
  if (idx === 1) return "Zítra";
  return new Date(`${date}T00:00:00`).toLocaleDateString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
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
  // Horizontálně scrollovatelný pásek (mobile-first) – týden dní se nevejde do řady.
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
              : `border-border bg-surface hover:text-foreground ${
                  isWeekend(d.date) ? "text-foreground/80" : "text-muted"
                }`
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
  favFixtures,
  favLeagues,
  onToggleFixture,
  onToggleLeague,
}: {
  fixtures: UpcomingFixture[];
  favFixtures: Set<number>;
  favLeagues: Set<number>;
  onToggleFixture: (id: number, on: boolean) => void;
  onToggleLeague: (id: number, on: boolean) => void;
}) {
  // Seskup dle ligy; pořadí lig dle nejbližšího výkopu (fixtures jsou už dle času).
  const groups = useMemo<LeagueGroup[]>(() => {
    const map = new Map<number, LeagueGroup>();
    for (const f of fixtures) {
      let g = map.get(f.leagueId);
      if (!g) {
        g = {
          leagueId: f.leagueId,
          name: f.leagueName,
          logoUrl: f.leagueLogoUrl,
          fixtures: [],
        };
        map.set(f.leagueId, g);
      }
      g.fixtures.push(f);
    }
    return [...map.values()];
  }, [fixtures]);

  // Rozbalené ligy (výchozí: vše sbaleno, bez auto-rozbalení).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  return (
    <div className="mt-4 space-y-3">
      {groups.map((g) => (
        <LeagueContainer
          key={g.leagueId}
          group={g}
          open={expanded.has(g.leagueId)}
          onToggleOpen={() =>
            setExpanded((prev) => {
              const n = new Set(prev);
              if (n.has(g.leagueId)) n.delete(g.leagueId);
              else n.add(g.leagueId);
              return n;
            })
          }
          isLeagueFavorite={favLeagues.has(g.leagueId)}
          onToggleLeague={(on) => onToggleLeague(g.leagueId, on)}
          favFixtures={favFixtures}
          onToggleFixture={onToggleFixture}
        />
      ))}
    </div>
  );
}

function LeagueContainer({
  group,
  open,
  onToggleOpen,
  isLeagueFavorite,
  onToggleLeague,
  favFixtures,
  onToggleFixture,
}: {
  group: LeagueGroup;
  open: boolean;
  onToggleOpen: () => void;
  isLeagueFavorite: boolean;
  onToggleLeague: (on: boolean) => void;
  favFixtures: Set<number>;
  onToggleFixture: (id: number, on: boolean) => void;
}) {
  const hasLive = group.fixtures.some((f) => f.live);
  // Nejbližší (nadcházející) výkop pro přehled ve sbalené hlavičce.
  const nextKickoff = group.fixtures.find((f) => !f.live)?.kickoff;
  const nextTime = nextKickoff
    ? new Date(nextKickoff).toLocaleTimeString("cs-CZ", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <TeamLogo src={group.logoUrl} alt={group.name} size={18} />
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {group.name}
          </span>
          {hasLive && <LiveDot />}
          <span className="shrink-0 text-xs text-muted">({group.fixtures.length})</span>
          {!open && nextTime && (
            <span className="shrink-0 text-xs text-muted">· {nextTime}</span>
          )}
        </button>
        <StarButton
          on={isLeagueFavorite}
          onClick={() => onToggleLeague(!isLeagueFavorite)}
          label={isLeagueFavorite ? "Odebrat ligu z oblíbených" : "Přidat ligu do oblíbených"}
        />
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label={open ? "Sbalit" : "Rozbalit"}
          className="shrink-0 text-muted transition hover:text-foreground"
        >
          {open ? "▲" : "▼"}
        </button>
      </div>
      {open && (
        <ul className="space-y-2 px-3 pb-3">
          {group.fixtures.map((f) => (
            <FixtureRow
              key={f.fixtureId}
              fixture={f}
              isFavorite={favFixtures.has(f.fixtureId)}
              onToggleFavorite={(on) => onToggleFixture(f.fixtureId, on)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Pulzující červená tečka = liga/zápas má právě živý zápas. */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-label="Živě">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-negative opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-negative" />
    </span>
  );
}

function StarButton({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={`shrink-0 text-base leading-none transition ${
        on ? "text-warning" : "text-muted hover:text-foreground"
      }`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

function FixtureRow({
  fixture,
  isFavorite,
  onToggleFavorite,
}: {
  fixture: UpcomingFixture;
  isFavorite: boolean;
  onToggleFavorite: (on: boolean) => void;
}) {
  const time = new Date(fixture.kickoff).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Klikatelné, když známe „ligu" obou stran pro deep-link (klub vždy; reprezentace
  // jen když se dohledala konfederace každého týmu). Jinak neklikací karta.
  const href = buildCompareHref(fixture);
  const clickable = href != null;
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <div className="flex items-center gap-2">
      {fixture.live ? (
        <span className="flex w-10 shrink-0 flex-col items-start gap-0.5 leading-tight">
          <span className="flex items-center gap-1 text-[11px] font-bold text-negative">
            <LiveDot />
            {fixture.elapsed != null ? `${fixture.elapsed}'` : "živě"}
          </span>
        </span>
      ) : (
        <span className="w-10 shrink-0 text-[11px] leading-tight text-muted">{time}</span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        <TeamLogo src={fixture.home.logoUrl} alt={fixture.home.name} size={20} />
        <span className="min-w-0 truncate font-medium text-home">{fixture.home.name}</span>
        <RankBadge rank={fixture.homeRank} />
        {fixture.live ? (
          <span className="shrink-0 font-bold tabular-nums text-negative">
            {fixture.liveHome ?? 0}:{fixture.liveAway ?? 0}
          </span>
        ) : (
          <span className="shrink-0 text-muted">–</span>
        )}
        <TeamLogo src={fixture.away.logoUrl} alt={fixture.away.name} size={20} />
        <span className="min-w-0 truncate font-medium text-away">{fixture.away.name}</span>
        <RankBadge rank={fixture.awayRank} />
      </div>
      {clickable && (
        <span className="shrink-0 text-muted" aria-hidden>
          ›
        </span>
      )}
    </div>
  );
  return (
    <li className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        {href != null ? (
          <Link href={href} className={`${cardClass} transition hover:border-foreground/30`}>
            {inner}
          </Link>
        ) : (
          <div className={cardClass}>{inner}</div>
        )}
      </div>
      <StarButton
        on={isFavorite}
        onClick={() => onToggleFavorite(!isFavorite)}
        label={isFavorite ? "Odebrat zápas z oblíbených" : "Přidat zápas do oblíbených"}
      />
    </li>
  );
}

function ResultsList({ results }: { results: SettledMatch[] }) {
  const hits = results.filter((r) => r.outcomeHit).length;
  return (
    <div className="mt-4">
      <p className="px-1 text-xs text-muted">
        Výsledek 1X2 trefen u{" "}
        <span className="font-semibold text-foreground">
          {hits} z {results.length}
        </span>{" "}
        nedávných zápasů.
      </p>
      <ul className="mt-2 space-y-2">
        {results.map((r) => (
          <ResultRow key={r.fixtureId} result={r} />
        ))}
      </ul>
    </div>
  );
}

const SIDE_LABELS: Record<SettledMatch["predictedSide"], string> = {
  home: "Domácí",
  draw: "Remíza",
  away: "Hosté",
};

function ResultRow({ result }: { result: SettledMatch }) {
  const date = new Date(result.kickoff).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
  });
  const href = buildCompareHref(result);
  const tip = `Tip: ${SIDE_LABELS[result.predictedSide]} · ${Math.round(
    result.predictedProb * 100
  )} %`;
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className="w-9 shrink-0 text-[11px] leading-tight text-muted">{date}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <TeamLogo src={result.home.logoUrl} alt={result.home.name} size={20} />
          <span className="min-w-0 truncate font-medium text-home">{result.home.name}</span>
          <span
            className="shrink-0 font-bold tabular-nums text-foreground"
            title={
              result.afterExtraTime
                ? "Stav po 90 minutách (zápas se rozhodl až v prodloužení)"
                : undefined
            }
          >
            {result.homeGoals}:{result.awayGoals}
            {result.afterExtraTime && (
              <span className="ml-0.5 align-super text-[9px] font-normal text-muted">
                90′
              </span>
            )}
          </span>
          <span className="min-w-0 truncate font-medium text-away">{result.away.name}</span>
          <TeamLogo src={result.away.logoUrl} alt={result.away.name} size={20} />
        </div>
        <span
          className={`shrink-0 text-sm font-bold ${
            result.outcomeHit ? "text-positive" : "text-negative"
          }`}
          aria-label={result.outcomeHit ? "Predikce vyšla" : "Predikce nevyšla"}
        >
          {result.outcomeHit ? "✓" : "✗"}
        </span>
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">{tip}</div>
    </>
  );
  return (
    <li>
      {href != null ? (
        <Link href={href} className={`${cardClass} transition hover:border-foreground/30`}>
          {inner}
        </Link>
      ) : (
        <div className={cardClass}>{inner}</div>
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
