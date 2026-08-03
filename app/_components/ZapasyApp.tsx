"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import type {
  FixtureDay,
  LiveScore,
  PlayedFixture,
  UpcomingFixture,
} from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { AppHeader } from "./AppHeader";
import { Empty } from "./Empty";
import { RankBadge } from "./RankBadge";
import { buildCompareHref } from "./compareHref";
import { MatchReportPanel } from "./MatchReportPanel";
import { ViewTabs } from "./ViewTabs";
import { LiveReportPanel } from "./LiveReportPanel";
import { buildTipHref } from "./tipHref";
import { useCurrentUser } from "./useCurrentUser";

type View = "program" | "results";

/** Stabilní prázdné pole (nemění referenci mezi rendery → nezpouští efekty nadarmo). */
const NO_FIXTURES: UpcomingFixture[] = [];

/**
 * Dnešek v pražské zóně (YYYY-MM-DD) na klientovi. Stránka je statická (ISR) → serverem
 * upečený „dnes" může být zastaralý (regenerace běží až na požadavek + stale-while-revalidate),
 * takže hranici dne musí určit klient podle skutečného času.
 */
function pragueToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Následující kalendářní den z YYYY-MM-DD (čistá aritmetika, nezávislá na zóně). */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Předchozí kalendářní den z YYYY-MM-DD. */
function prevDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

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
): {
  scores: Map<number, LiveScore>;
  loaded: boolean;
  /** Poslední poll selhal → minuty a skóre na obrazovce **stojí**. */
  failing: boolean;
  /** Čas posledního úspěšného pollu (ms), `null` dokud žádný neproběhl. */
  updatedAt: number | null;
  /** Zápasy, které dohrály za běhu stránky (viz `detectFinished`). */
  finished: PlayedFixture[];
} {
  const [scores, setScores] = useState<Map<number, LiveScore>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [failing, setFailing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [finished, setFinished] = useState<PlayedFixture[]>([]);
  // Předchozí snímek. Zapisuje se **jen v callbacku pollu**, nikdy při renderu.
  const prevScores = useRef<Map<number, LiveScore>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function tick(): Promise<void> {
      if (document.hidden || !plausiblyLive(fixtures, Date.now())) return;
      try {
        const r = await fetch("/api/fixtures/live");
        if (!r.ok) throw new Error(String(r.status));
        const d: { live?: LiveScore[] } = await r.json();
        if (!active) return;
        const map = new Map<number, LiveScore>();
        for (const l of d.live ?? []) map.set(l.fixtureId, l);

        // Co ze živé sady vypadlo, dohrálo → poskládat pro Výsledky, než dorazí rozpis.
        const done = detectFinished(prevScores.current, map, fixtures);
        prevScores.current = map;
        if (done.length > 0) {
          setFinished((cur) => {
            const known = new Set(cur.map((p) => p.fixtureId));
            const add = done.filter((p) => !known.has(p.fixtureId));
            return add.length > 0 ? [...cur, ...add] : cur;
          });
        }

        setScores(map);
        setLoaded(true);
        setFailing(false);
        setUpdatedAt(Date.now());
      } catch {
        // Živý stav je best-effort a SSR snímek zůstane – ale mlčet se nesmí:
        // zamrzlá minuta vypadá k nerozeznání od „nic se zrovna nehraje".
        if (active) setFailing(true);
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

  return { scores, loaded, failing, updatedAt, finished };
}

/**
 * Razítko čerstvosti živého skóre. Bez něj vypadá zamrzlý poll (nebo snímek z CDN)
 * jako aktuální stav – minuta je součást tvrzení, ne dekorace. Ukazuje se jen když
 * se opravdu něco hraje, aby mimo sezónu nedělalo hluk.
 */
function LiveFreshness({
  failing,
  updatedAt,
}: {
  failing: boolean;
  updatedAt: number | null;
}) {
  if (updatedAt == null && !failing) return null;
  const time =
    updatedAt == null
      ? null
      : new Date(updatedAt).toLocaleTimeString("cs-CZ", {
          hour: "2-digit",
          minute: "2-digit",
        });
  return (
    <p
      // Odečítač se o výpadku dozví; průběžné aktualizace času by ale hlásit neměl.
      role={failing ? "status" : undefined}
      className={`mt-2 text-right text-[10px] ${failing ? "text-warning" : "text-muted"}`}
    >
      {failing
        ? `⚠ Živé skóre se nedaří obnovit${time ? ` – naposledy v ${time}` : ""}.`
        : `Živé skóre aktualizováno v ${time}`}
    </p>
  );
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
        liveStatus: l.status,
        halftimeHome: l.halftimeHome,
        halftimeAway: l.halftimeAway,
      };
    });
}

/**
 * Stavy, ze kterých se dá dohraný zápas dopočítat na klientovi. `ET`/`BT`/`P` schválně
 * chybí: `PlayedFixture.homeGoals` je **skóre po 90 minutách** (to model predikuje), ale
 * živý feed nese průběžné skóre včetně prodloužení – po rozstřelu bychom dosadili špatné
 * číslo. Takový zápas počká na rozpis; radši o pár minut později než špatně.
 */
const REGULAR_TIME_STATUSES = new Set(["1H", "HT", "2H"]);

/**
 * Zápas, který **právě zmizel ze živé sady**, je dohraný. `mergeLive` ho z Programu
 * vyhodí, ale Výsledky se počítají ze statické `days` prop, takže tam do další ISR
 * regenerace (až 10 min) nedorazil – zápas, který jsi sledoval, spadl do díry.
 * Tohle ho z posledního živého snímku poskládá a doplní do Výsledků rovnou.
 *
 * Je to **optimistický překryv**, ne zdroj pravdy: jakmile dorazí čerstvý rozpis se
 * stejným `fixtureId`, `mergePlayed` dá přednost jemu (nese i `tip` a `afterExtraTime`).
 */
function toPlayedFixture(
  f: UpcomingFixture,
  last: LiveScore
): PlayedFixture | null {
  if (!REGULAR_TIME_STATUSES.has(last.status)) return null;
  if (last.homeGoals == null || last.awayGoals == null) return null;
  return {
    fixtureId: f.fixtureId,
    leagueId: f.leagueId,
    leagueName: f.leagueName,
    leagueLogoUrl: f.leagueLogoUrl,
    kickoff: f.kickoff,
    home: f.home,
    away: f.away,
    homeGoals: last.homeGoals,
    awayGoals: last.awayGoals,
    afterExtraTime: false,
    national: f.national,
    compareMode: f.compareMode,
    homeCompareLeagueId: f.homeCompareLeagueId,
    awayCompareLeagueId: f.awayCompareLeagueId,
    // `tip` vědomě chybí – ✓/✗ dorazí až se settlem, dřív ho poctivě nevíme.
  };
}

/** Zápasy ze serveru mají přednost; dopočítané se přidají jen když v rozpisu ještě nejsou. */
function mergePlayed(
  served: PlayedFixture[],
  extra: PlayedFixture[]
): PlayedFixture[] {
  if (extra.length === 0) return served;
  const known = new Set(served.map((p) => p.fixtureId));
  const add = extra.filter((p) => !known.has(p.fixtureId));
  if (add.length === 0) return served;
  return [...served, ...add].sort((a, b) => b.kickoff.localeCompare(a.kickoff));
}

/** Oblíbené: live první, pak dle výkopu (primární sekce nahoře). */
function sortFavorites(a: UpcomingFixture, b: UpcomingFixture): number {
  const al = a.live ? 0 : 1;
  const bl = b.live ? 0 : 1;
  if (al !== bl) return al - bl;
  return a.kickoff.localeCompare(b.kickoff);
}

/** Pražský kalendářní den výkopu – aby dopočítaný zápas spadl do správného dne Výsledků. */
function pragueDayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Které zápasy z předchozího snímku v novém chybí → právě dohrály. Čistá funkce, aby
 * se dala volat z callbacku pollu (a ne z dalšího efektu – synchronní `setState` v těle
 * efektu tenhle repo zakazuje kvůli kaskádovým renderům).
 */
function detectFinished(
  prev: Map<number, LiveScore>,
  next: Map<number, LiveScore>,
  fixtures: UpcomingFixture[]
): PlayedFixture[] {
  if (prev.size === 0) return []; // první snímek nemá s čím porovnávat
  const done: PlayedFixture[] = [];
  for (const [id, last] of prev) {
    if (next.has(id)) continue; // pořád běží
    const f = fixtures.find((x) => x.fixtureId === id);
    if (!f) continue;
    const played = toPlayedFixture(f, last);
    if (played) done.push(played);
  }
  return done;
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
 * (přepínač) nad **jedním** polem dní `[dnes−RESULT_DAYS … dnes+6]`: **Program** =
 * nadcházející zápasy seskupené podle ligy (klik = Porovnání s předvyplněnými týmy +
 * predikcí) a **Výsledky** = odehrané zápasy týchž lig, den po dni dozadu.
 * Seznamy jsou jen navigace – nic se nepočítá živě.
 *
 * **Ve Výsledcích je náš tip odznak, ne podmínka.** Zápas se ukáže, jakmile ho API hlásí
 * dohraný; ✓/✗ dorazí, až predikci vypořádá `settle-results`. Dřív byly Výsledky čtené
 * výhradně z uložených predikcí, takže večerní zápas v nich chyběl klidně 17 h a zápas
 * bez predikce navždy.
 */
export function ZapasyApp({
  days,
  resultDays,
}: {
  days: FixtureDay[];
  /** Kolik prvních položek `days` je minulost (kontrakt s `RESULT_DAYS` v `app/page.tsx`). */
  resultDays: number;
}) {
  // Stránka je statická (ISR) → uživatele načteme klientsky (anon = null; PRO odemkne
  // oblíbené). Krátký flash „nepřihlášen" v hlavičce je cena za CDN-cacheovaný shell.
  const user = useCurrentUser();
  const [view, setView] = useState<View>("program");
  // Vlastní kurzor pro každý pohled – pásky jedou opačným směrem, sdílený index by
  // po přepnutí skočil na náhodný den.
  const [dayIdx, setDayIdx] = useState(0);
  const [resultIdx, setResultIdx] = useState(0);
  const [onlyFav, setOnlyFav] = useState(false);
  const [proCta, setProCta] = useState(false);

  // Skutečný „dnes" podle klienta (SSR snapshot může být o den starý). Přepočítá se i při
  // návratu na záložku/do popředí (PWA reopen přes noc → JS stav přežije, mount effect neběží).
  const [clientToday, setClientToday] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setClientToday(pragueToday());
    sync();
    const onVis = () => {
      if (!document.hidden) sync();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  // Odfiltruj minulé dny ze zastaralého snapshotu (yesterday-as-„Dnes" fix). Když by tím
  // nezbylo nic (extrémně starý snapshot), radši ukaž původní data než prázdno.
  //
  // **Do prvního renderu (SSR/hydratace) se řeže indexem, ne datem** – server a klient si
  // musí padnout do noty. `days` chodí seřazené nejstarší první, takže Program začíná na
  // `resultDays` (= dnešek dle serveru) a Výsledky berou zbytek. Po mountu rozhoduje
  // skutečný pražský „dnes" na klientovi.
  const visibleDays = useMemo(() => {
    if (!clientToday) return days.slice(resultDays);
    const future = days.filter((d) => d.date >= clientToday);
    return future.length > 0 ? future : days.slice(resultDays);
  }, [days, clientToday, resultDays]);

  const active = visibleDays[dayIdx] ?? visibleDays[0];
  const isPro = user?.tier === "PRO";

  const {
    scores,
    loaded,
    failing,
    updatedAt,
    finished: justFinished,
  } = useLiveScores(view === "program", active?.fixtures ?? NO_FIXTURES);
  const { favFixtures, favLeagues, toggle } = useFavorites(!!isPro);

  // Výsledky jedou opačně: dnešek první, pak dozadu. Do dne se přimíchají zápasy,
  // které dohrály za běhu stránky (jinak by čekaly na ISR regeneraci, až 10 min).
  const pastDays = useMemo(() => {
    const past = clientToday
      ? days.filter((d) => d.date <= clientToday)
      : days.slice(0, resultDays + 1);
    const base = (past.length > 0 ? past : days.slice(0, resultDays + 1))
      .slice()
      .reverse();
    if (justFinished.length === 0) return base;
    return base.map((d) => {
      const extra = justFinished.filter((p) => pragueDayOf(p.kickoff) === d.date);
      const played = mergePlayed(d.played, extra);
      return played === d.played ? d : { ...d, played };
    });
  }, [days, clientToday, resultDays, justFinished]);

  const activePast = pastDays[resultIdx] ?? pastDays[0];
  const playedCount = useMemo(
    () => pastDays.reduce((n, d) => n + d.played.length, 0),
    [pastDays]
  );

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
      <AppHeader user={user} />

      <h1 className="mt-4 text-lg font-semibold text-foreground">Zápasy</h1>
      <p className="mt-1 text-sm text-muted">
        {view === "program"
          ? "Vyber zápas a rovnou se otevře porovnání týmů s predikcí."
          : "Odehrané zápasy sledovaných lig – a u těch, které jsme tipovali, i jak nám to vyšlo."}
      </p>

      <ViewTabs
        tabs={[
          { value: "program", label: "Program" },
          {
            value: "results",
            label: playedCount > 0 ? `Výsledky (${playedCount})` : "Výsledky",
          },
        ]}
        active={view}
        onSelect={setView}
      />

      {view === "program" ? (
        <>
          <DayTabs
            days={visibleDays}
            active={dayIdx}
            today={clientToday}
            direction="future"
            count={(d) => d.fixtures.length}
            onSelect={setDayIdx}
          />

          {proCta && (
            <ProCtaBanner
              signedIn={!!user}
              onDismiss={() => setProCta(false)}
            />
          )}

          {(favFixtures.size > 0 || favLeagues.size > 0) && (
            <FavoriteToggle onlyFav={onlyFav} onChange={setOnlyFav} />
          )}

          <LiveFreshness failing={failing} updatedAt={updatedAt} />

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
      ) : (
        <>
          <DayTabs
            days={pastDays}
            active={resultIdx}
            today={clientToday}
            direction="past"
            count={(d) => d.played.length}
            onSelect={setResultIdx}
          />
          {activePast && activePast.played.length > 0 ? (
            <ResultsList played={activePast.played} />
          ) : (
            <Empty>
              Na tento den nemáme ve sledovaných ligách odehraný zápas. Zkus jiný den –
              mimo sezónu (léto) top ligy nehrají.
            </Empty>
          )}
        </>
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

// Je-li znám skutečný „dnes" (klient), labeluj podle data (odolné vůči zastaralému snapshotu);
// dokud není (SSR/hydratace), padni zpět na index, aby seděl server i klient. Dál krátký den
// v týdnu + datum (So 28. 6.). `direction` řeší jen index fallback: Program jde dopředu
// (0 = Dnes, 1 = Zítra), Výsledky dozadu (0 = Dnes, 1 = Včera).
function dayLabel(
  date: string,
  idx: number,
  today: string | null,
  direction: DayDirection
): string {
  if (today) {
    if (date === today) return "Dnes";
    if (date === nextDay(today)) return "Zítra";
    if (date === prevDay(today)) return "Včera";
  } else {
    if (idx === 0) return "Dnes";
    if (idx === 1) return direction === "future" ? "Zítra" : "Včera";
  }
  return new Date(`${date}T00:00:00`).toLocaleDateString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  });
}

type DayDirection = "future" | "past";

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function DayTabs({
  days,
  active,
  today,
  direction,
  count,
  onSelect,
}: {
  days: FixtureDay[];
  active: number;
  today: string | null;
  direction: DayDirection;
  /** Co se počítá do bubliny – Program bere `fixtures`, Výsledky `played`. */
  count: (d: FixtureDay) => number;
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
          {dayLabel(d.date, i, today, direction)}
          <span className="ml-1.5 text-xs opacity-70">({count(d)})</span>
        </button>
      ))}
    </div>
  );
}

interface LeagueGroupOf<T> {
  leagueId: number;
  name: string;
  logoUrl: string;
  fixtures: T[];
}

type LeagueGroup = LeagueGroupOf<UpcomingFixture>;

/**
 * Seskupí zápasy podle ligy. **Pořadí lig i zápasů drží pořadí vstupu** – ten je už
 * seřazený (Program dle nejbližšího výkopu, Výsledky od nejnovějšího), takže sem
 * nepatří žádné vlastní řazení, které by se s ním rozešlo.
 */
function groupByLeague<
  T extends { leagueId: number; leagueName: string; leagueLogoUrl: string },
>(fixtures: T[]): LeagueGroupOf<T>[] {
  const map = new Map<number, LeagueGroupOf<T>>();
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
  const groups = useMemo<LeagueGroup[]>(() => groupByLeague(fixtures), [fixtures]);

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
        {fixture.live && <LiveReportToggle fixture={fixture} />}
      </div>
      {!fixture.live && (
        <Link
          href={buildTipHref(fixture)}
          aria-label="Tipnout zápas"
          title="Tipnout zápas"
          className="shrink-0 text-base leading-none text-muted transition hover:text-foreground"
        >
          🎯
        </Link>
      )}
      <StarButton
        on={isFavorite}
        onClick={() => onToggleFavorite(!isFavorite)}
        label={isFavorite ? "Odebrat zápas z oblíbených" : "Přidat zápas do oblíbených"}
      />
    </li>
  );
}

/**
 * Rozbalení průběhu u živého zápasu. Tlačítko je **mimo** `<Link>` karty – uvnitř by klik
 * navigoval do Porovnání místo rozbalení (stejný důvod jako u „Přehled zápasu" ve
 * Výsledcích). Sbalením se panel odmontuje, takže se zastaví i jeho poll.
 */
function LiveReportToggle({ fixture }: { fixture: UpcomingFixture }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="px-1 text-[11px] font-medium text-muted transition hover:text-foreground"
      >
        {open ? "▾" : "▸"} Průběh zápasu
      </button>
      {open && (
        <div className="mt-1.5">
          <LiveReportPanel fixture={fixture} />
        </div>
      )}
    </div>
  );
}

function ResultsList({ played }: { played: PlayedFixture[] }) {
  // Jmenovatel jsou **zápasy s predikcí**, ne všechny odehrané – jinak by číslo tiše
  // tvrdilo, že jsme tipovali i to, co jsme netipovali.
  const tipped = played.filter((p) => p.tip);
  const hits = tipped.filter((p) => p.tip!.hit).length;
  const groups = useMemo(() => groupByLeague(played), [played]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  return (
    <div className="mt-4">
      {tipped.length > 0 && (
        <p className="px-1 text-xs text-muted">
          Výsledek 1X2 trefen u{" "}
          <span className="font-semibold text-foreground">
            {hits} z {tipped.length}
          </span>{" "}
          {tipped.length === 1 ? "zápasu" : "zápasů"}, kde jsme měli predikci.
        </p>
      )}
      <div className="mt-2 space-y-3">
        {groups.map((g) => (
          <PlayedLeagueContainer
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
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Ligový kontejner ve Výsledcích – stejný vzhled i chování jako v Programu (klikací
 * hlavička, výchozí sbaleno), jen bez hvězdy a živé tečky: oblíbené řeší Program
 * a dohraný zápas živý není. Ve sbalené hlavičce je místo nejbližšího výkopu **bilance
 * tipů** v té lize, pokud nějaké máme.
 */
function PlayedLeagueContainer({
  group,
  open,
  onToggleOpen,
}: {
  group: LeagueGroupOf<PlayedFixture>;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const tipped = group.fixtures.filter((f) => f.tip);
  const hits = tipped.filter((f) => f.tip!.hit).length;

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
          <span className="shrink-0 text-xs text-muted">({group.fixtures.length})</span>
          {!open && tipped.length > 0 && (
            <span className="shrink-0 text-xs text-muted">
              · {hits}/{tipped.length} ✓
            </span>
          )}
        </button>
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
            <PlayedRow key={f.fixtureId} fixture={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

const SIDE_LABELS: Record<"home" | "draw" | "away", string> = {
  home: "Domácí",
  draw: "Remíza",
  away: "Hosté",
};

function PlayedRow({ fixture }: { fixture: PlayedFixture }) {
  const [open, setOpen] = useState(false);
  const time = new Date(fixture.kickoff).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const href = buildCompareHref(fixture);
  const tip = fixture.tip;
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[11px] leading-tight text-muted tabular-nums">
          {time}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <TeamLogo src={fixture.home.logoUrl} alt={fixture.home.name} size={20} />
          <span className="min-w-0 truncate font-medium text-home">
            {fixture.home.name}
          </span>
          <span
            className="shrink-0 font-bold tabular-nums text-foreground"
            title={
              fixture.afterExtraTime
                ? "Stav po 90 minutách (zápas se rozhodl až v prodloužení)"
                : undefined
            }
          >
            {fixture.homeGoals}:{fixture.awayGoals}
            {fixture.afterExtraTime && (
              <span className="ml-0.5 align-super text-[9px] font-normal text-muted">
                90′
              </span>
            )}
          </span>
          <span className="min-w-0 truncate font-medium text-away">
            {fixture.away.name}
          </span>
          <TeamLogo src={fixture.away.logoUrl} alt={fixture.away.name} size={20} />
        </div>
        {tip && (
          <span
            className={`shrink-0 text-sm font-bold ${
              tip.hit ? "text-positive" : "text-negative"
            }`}
            aria-label={tip.hit ? "Predikce vyšla" : "Predikce nevyšla"}
          >
            {tip.hit ? "✓" : "✗"}
          </span>
        )}
      </div>
      {tip && (
        <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">
          Tip: {SIDE_LABELS[tip.side]} · {Math.round(tip.prob * 100)} %
        </div>
      )}
    </>
  );
  return (
    <li className="space-y-1">
      {href != null ? (
        <Link href={href} className={`${cardClass} transition hover:border-foreground/30`}>
          {inner}
        </Link>
      ) : (
        <div className={cardClass}>{inner}</div>
      )}
      {/* Tlačítko je MIMO `Link` schválně – uvnitř by klik navigoval na Porovnání. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full rounded-lg px-3 py-1 text-left text-[11px] text-muted transition hover:text-foreground"
      >
        {open ? "▾" : "▸"} Přehled zápasu
      </button>
      {/* Panel se montuje až po otevření → fetch se pustí jen na vyžádání. */}
      {open && <MatchReportPanel match={fixture} />}
    </li>
  );
}

