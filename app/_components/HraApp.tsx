"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "./AppHeader";
import { TeamLogo } from "./TeamLogo";
import type { SessionUser } from "./sessionUser";
import { teamById } from "@/lib/game/teams";
import { randomSeed } from "@/lib/game/rng";
import {
  newSeason,
  playRound,
  simulateToEnd,
  isSeasonOver,
  currentTable,
  setTactic,
  yourNextMatch,
  yourResults,
} from "@/lib/game/engine";
import { summarizeSeason, startNextSeason, careerStats } from "@/lib/game/career";
import {
  initialReputation,
  updateReputation,
  isHireable,
  expectedRank,
  HIRE_MARGIN,
} from "@/lib/game/reputation";
import {
  teamPrestige,
  seasonHeadline,
  seasonTone,
} from "@/lib/game/leagues";
import { teamSeasonStats } from "@/lib/game/analysis";
import { SAVE_VERSION } from "@/lib/game/types";
import type {
  GameTeam,
  LeagueInfo,
  SaveState,
  SeasonState,
  Tactic,
} from "@/lib/game/types";

const NAV = [
  { href: "/", label: "Zápasy", emoji: "📅" },
  { href: "/predikce", label: "Tipy", emoji: "📈" },
  { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
];

const TACTIC_LABEL: Record<Tactic, string> = {
  attack: "Útočná",
  balanced: "Vyvážená",
  defense: "Defenzivní",
};
const TACTIC_HINT: Record<Tactic, string> = {
  attack: "Víc vstřelíš, ale i dostaneš. Vysoká variance.",
  balanced: "Bez úprav – vyrovnaný přístup.",
  defense: "Míň gólů na obou stranách. Dobré proti favoritovi.",
};

function saveEndpoint(next: SaveState) {
  fetch("/api/game", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: next }),
  }).catch(() => {
    /* ticho: lokální stav je zdroj pravdy, další akce uloží znovu */
  });
}

function repTier(r: number): string {
  if (r >= 85) return "Elitní trenér";
  if (r >= 65) return "Zvučné jméno";
  if (r >= 45) return "Zavedený";
  if (r >= 25) return "Nadějný";
  return "Začínající";
}

export function HraApp({ user }: { user: SessionUser | null }) {
  const [loading, setLoading] = useState(Boolean(user));
  const [save, setSave] = useState<SaveState | null>(null);
  const [view, setView] = useState<"season" | "history">("season");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/game");
        const d = await r.json();
        if (!active) return;
        if (!r.ok) throw new Error(d.error ?? "Chyba načtení");
        setSave(
          d.save && d.save.version === SAVE_VERSION ? (d.save as SaveState) : null
        );
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Chyba načtení");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const persist = useCallback((next: SaveState) => {
    setSave(next);
    saveEndpoint(next);
  }, []);

  const startGame = useCallback(
    (leagueId: number, leagueName: string, teams: GameTeam[], teamId: number) => {
      const seed = randomSeed();
      const current = newSeason(seed, teamId, { teams, leagueId, leagueName });
      const reputation = initialReputation(
        teamById(teams, teamId),
        leagueId,
        teams
      );
      persist({
        version: SAVE_VERSION,
        manager: { reputation },
        current,
        history: [],
      });
      setView("season");
    },
    [persist]
  );

  const mutateSeason = useCallback((fn: (s: SeasonState) => SeasonState) => {
    setSave((prev) => {
      if (!prev) return prev;
      const next = { ...prev, current: fn(prev.current) };
      saveEndpoint(next);
      return next;
    });
  }, []);

  const onPlayRound = useCallback(() => {
    setBusy(true);
    mutateSeason((s) => playRound(s));
    setBusy(false);
  }, [mutateSeason]);

  const onSimulateToEnd = useCallback(() => {
    setBusy(true);
    mutateSeason((s) => simulateToEnd(s));
    setBusy(false);
  }, [mutateSeason]);

  const onTactic = useCallback(
    (t: Tactic) => mutateSeason((s) => setTactic(s, t)),
    [mutateSeason]
  );

  // Uzavře sezónu (souhrn + reputace), pak sestaví další (pokračovat / změnit tým).
  const finishAndAdvance = useCallback(
    (buildNext: (prev: SaveState) => SeasonState) => {
      setSave((prev) => {
        if (!prev) return prev;
        const summary = summarizeSeason(prev.current);
        const reputation = updateReputation(prev.manager.reputation, summary);
        const next: SaveState = {
          ...prev,
          manager: { reputation },
          current: buildNext(prev),
          history: [...prev.history, summary],
        };
        saveEndpoint(next);
        return next;
      });
      setView("season");
    },
    []
  );

  const onContinue = useCallback(
    () => finishAndAdvance((prev) => startNextSeason(prev.current)),
    [finishAndAdvance]
  );

  const onSwitch = useCallback(
    (leagueId: number, leagueName: string, teams: GameTeam[], teamId: number) =>
      finishAndAdvance((prev) =>
        newSeason(randomSeed(), teamId, {
          teams,
          leagueId,
          leagueName,
          season: prev.current.season + 1,
        })
      ),
    [finishAndAdvance]
  );

  const onReset = useCallback(() => {
    if (!confirm("Opravdu začít znovu? Aktuální hra i historie kariéry se smažou."))
      return;
    fetch("/api/game", { method: "DELETE" }).catch(() => {});
    setSave(null);
    setView("season");
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-5 sm:py-8">
      <AppHeader user={user} nav={NAV} />
      <h1 className="mt-4 text-lg font-semibold text-foreground">🎮 Manažer</h1>
      <p className="mt-1 text-sm text-muted">
        Veď reálný klub sezónou i kariérou. Před každým zápasem uvidíš predikci a analýzu
        stejného modelu, který jinak tipuje reálné zápasy.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}

      {!user ? (
        <SignInGate />
      ) : loading ? (
        <LoadingRows />
      ) : !save ? (
        <NewGameFlow onStart={startGame} onError={setError} />
      ) : (
        <GameView
          save={save}
          managerName={user.name ?? null}
          view={view}
          setView={setView}
          busy={busy}
          onPlayRound={onPlayRound}
          onSimulateToEnd={onSimulateToEnd}
          onTactic={onTactic}
          onContinue={onContinue}
          onSwitch={onSwitch}
          onReset={onReset}
          onError={setError}
        />
      )}
    </main>
  );
}

// ───────────────────────── společné ─────────────────────────

function SignInGate() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center">
      <p className="text-3xl">🔒</p>
      <p className="mt-2 text-sm font-medium text-foreground">
        Hra je vázaná na tvůj profil
      </p>
      <p className="mt-1 text-sm text-muted">
        Přihlas se (vpravo nahoře), aby se rozehraná kariéra uložila na tvůj účet a byla
        dostupná i na jiném zařízení.
      </p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="mt-4 space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-xl bg-border/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

function TeamBadge({ team, size = 26 }: { team: GameTeam; size?: number }) {
  if (team.logo) return <TeamLogo src={team.logo} alt={team.name} size={size} />;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white"
      style={{
        backgroundColor: team.color,
        width: size,
        height: size,
        fontSize: size * 0.36,
      }}
      aria-hidden
    >
      {team.short}
    </span>
  );
}

/** Hrubá síla týmu jako 1–5 (útok mínus obrana). */
function strengthStars(team: GameTeam): number {
  const s = team.attack - team.defense;
  const norm = (s + 1.0) / 2.6;
  return Math.max(1, Math.min(5, Math.round(norm * 4) + 1));
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-xs text-warning">
      {"★".repeat(n)}
      <span className="text-muted">{"★".repeat(5 - n)}</span>
    </span>
  );
}

// ───────────────────────── nová hra ─────────────────────────

function NewGameFlow({
  onStart,
  onError,
}: {
  onStart: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number
  ) => void;
  onError: (e: string | null) => void;
}) {
  const [leagues, setLeagues] = useState<LeagueInfo[] | null>(null);
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [teams, setTeams] = useState<GameTeam[] | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/game/leagues");
        const d = await r.json();
        if (!active) return;
        if (!r.ok) throw new Error(d.error ?? "Chyba");
        setLeagues(d.leagues as LeagueInfo[]);
      } catch {
        if (active) onError("Nepodařilo se načíst ligy.");
      }
    })();
    return () => {
      active = false;
    };
  }, [onError]);

  const pickLeague = useCallback(
    async (l: LeagueInfo) => {
      setLeague(l);
      setTeams(null);
      setLoadingTeams(true);
      onError(null);
      try {
        const r = await fetch(`/api/game/league?id=${l.id}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Chyba");
        setTeams(d.teams as GameTeam[]);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Nepodařilo se načíst ligu.");
        setLeague(null);
      } finally {
        setLoadingTeams(false);
      }
    },
    [onError]
  );

  if (!leagues) return <LoadingRows />;

  // Krok 2: výběr klubu ve zvolené lize.
  if (league) {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={() => {
            setLeague(null);
            setTeams(null);
          }}
          className="text-xs text-muted hover:text-foreground"
        >
          ← Zpět na ligy
        </button>
        <h2 className="mt-2 text-sm font-semibold text-foreground">
          {league.name} — vyber svůj klub
        </h2>
        {loadingTeams || !teams ? (
          <LoadingRows />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[...teams]
              .sort((a, b) => strengthStars(b) - strengthStars(a))
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onStart(league.id, league.name, teams, t.id)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-sm transition hover:border-foreground/30"
                >
                  <TeamBadge team={t} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {t.name}
                    </span>
                    <Stars n={strengthStars(t)} />
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    );
  }

  // Krok 1: výběr ligy.
  return (
    <div className="mt-5">
      <h2 className="text-sm font-semibold text-foreground">Vyber ligu</h2>
      <p className="mt-1 text-xs text-muted">
        Reálné týmy a jejich síla se berou z aktuální ligové tabulky.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {leagues.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => pickLeague(l)}
            className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-3 text-left shadow-sm transition hover:border-foreground/30"
          >
            <span className="text-sm font-medium text-foreground">{l.name}</span>
            <span className="text-xs text-muted">{l.country}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── běžící hra ─────────────────────────

function GameView({
  save,
  managerName,
  view,
  setView,
  busy,
  onPlayRound,
  onSimulateToEnd,
  onTactic,
  onContinue,
  onSwitch,
  onReset,
  onError,
}: {
  save: SaveState;
  managerName: string | null;
  view: "season" | "history";
  setView: (v: "season" | "history") => void;
  busy: boolean;
  onPlayRound: () => void;
  onSimulateToEnd: () => void;
  onTactic: (t: Tactic) => void;
  onContinue: () => void;
  onSwitch: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number
  ) => void;
  onReset: () => void;
  onError: (e: string | null) => void;
}) {
  const s = save.current;
  const you = teamById(s.teams, s.yourTeamId);
  const done = isSeasonOver(s);

  return (
    <div className="mt-5">
      {/* pruh: tvůj tým + reputace + přepínač + reset */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TeamBadge team={you} size={30} />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">{you.name}</div>
            <div className="text-xs text-muted">
              {s.leagueName} · sezóna {s.season} · kolo{" "}
              {Math.min(s.round + (done ? 0 : 1), s.schedule.length)}/{s.schedule.length}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Segment active={view === "season"} onClick={() => setView("season")}>
            Sezóna
          </Segment>
          <Segment active={view === "history"} onClick={() => setView("history")}>
            Kariéra
          </Segment>
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-negative"
          >
            Nová kariéra
          </button>
        </div>
      </div>

      <ManagerProfile save={save} managerName={managerName} />

      {view === "season" && !done && (
        <RoleNote save={save} />
      )}

      {view === "history" ? (
        <HistoryView save={save} />
      ) : done ? (
        <SeasonDone
          save={save}
          onContinue={onContinue}
          onSwitch={onSwitch}
          onError={onError}
        />
      ) : (
        <>
          <NextMatch state={s} onTactic={onTactic} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onPlayRound}
              className="flex-1 rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Odehrát kolo
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSimulateToEnd}
              className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-50"
            >
              Dohrát sezónu
            </button>
          </div>
          <LeagueTable state={s} />
          <YourForm state={s} />
        </>
      )}
    </div>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1.5 text-xs font-medium transition " +
        (active
          ? "bg-foreground text-background"
          : "border border-border bg-surface text-muted hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function ManagerProfile({
  save,
  managerName,
}: {
  save: SaveState;
  managerName: string | null;
}) {
  const rep = Math.round(save.manager.reputation);
  const titles = save.history.filter((h) => h.champion).length;
  const europe = save.history.filter((h) => h.europe !== "NONE").length;
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            👔 {managerName || "Trenér"}
          </div>
          <div className="text-xs text-muted">{repTier(rep)}</div>
        </div>
        <div className="flex shrink-0 gap-3 text-center">
          <ProfileStat label="Titulů" value={titles} accent={titles > 0} />
          <ProfileStat label="Poháry" value={europe} />
          <ProfileStat label="Sezón" value={save.history.length + 1} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted">Reputace</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
          <div
            className="h-full rounded-full bg-positive"
            style={{ width: `${rep}%` }}
          />
        </div>
        <span className="tabular-nums font-semibold text-foreground">{rep}/100</span>
      </div>
    </div>
  );
}

function ProfileStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="leading-tight">
      <div
        className={
          "text-sm font-bold tabular-nums " +
          (accent ? "text-warning" : "text-foreground")
        }
      >
        {value}
      </div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}

/** Krátké přiblížení role: koho vedeš, prestiž klubu, očekávání a dosah reputace. */
function RoleNote({ save }: { save: SaveState }) {
  const s = save.current;
  const you = teamById(s.teams, s.yourTeamId);
  const prestige = teamPrestige(you, s.leagueId, s.teams);
  const exp = expectedRank(you, s.teams);
  const reach = Math.round(save.manager.reputation) + HIRE_MARGIN;
  return (
    <p className="mt-2 rounded-xl border border-dashed border-border bg-surface/50 px-3 py-2 text-xs text-muted">
      Vedeš <strong className="text-foreground">{you.name}</strong> ({s.leagueName}) —
      prestiž klubu <strong className="text-foreground">{prestige}</strong>, očekává se{" "}
      <strong className="text-foreground">{exp}. místo</strong>. S reputací tě teď osloví
      kluby do prestiže ~{reach}.
    </p>
  );
}

function NextMatch({
  state,
  onTactic,
}: {
  state: SeasonState;
  onTactic: (t: Tactic) => void;
}) {
  const next = yourNextMatch(state);
  if (!next) return null;
  const you = teamById(state.teams, state.yourTeamId);
  const yourWin = next.isHome ? next.probs.homeWin : next.probs.awayWin;
  const yourLoss = next.isHome ? next.probs.awayWin : next.probs.homeWin;
  const draw = next.probs.draw;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        Nejbližší zápas {next.isHome ? "(doma)" : "(venku)"}
      </div>
      <div className="mt-2 flex items-center justify-center gap-3">
        <TeamBadge team={next.isHome ? you : next.opponent} size={30} />
        <span className="max-w-[35%] truncate text-sm font-medium text-foreground">
          {next.isHome ? you.name : next.opponent.name}
        </span>
        <span className="text-xs text-muted">vs</span>
        <span className="max-w-[35%] truncate text-sm font-medium text-foreground">
          {next.isHome ? next.opponent.name : you.name}
        </span>
        <TeamBadge team={next.isHome ? next.opponent : you} size={30} />
      </div>

      {/* Predikce modelu */}
      <div className="mt-3">
        <div className="mb-1 text-center text-xs text-muted">Predikce modelu</div>
        <div className="flex overflow-hidden rounded-full border border-border text-[11px] font-semibold text-white">
          <ProbBar label="Výhra" pct={yourWin} className="bg-positive" />
          <ProbBar label="Remíza" pct={draw} className="bg-muted" />
          <ProbBar label="Prohra" pct={yourLoss} className="bg-negative" />
        </div>
      </div>

      {/* Analýza z odehrané sezóny */}
      <AnalysisPanel state={state} youId={you.id} oppId={next.opponent.id} />

      {/* Taktika */}
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-foreground">Taktika</div>
        <div className="grid grid-cols-3 gap-1.5">
          {(["attack", "balanced", "defense"] as Tactic[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTactic(t)}
              className={
                "rounded-lg px-2 py-1.5 text-xs font-medium transition " +
                (state.tactic === t
                  ? "bg-foreground text-background"
                  : "border border-border bg-surface text-muted hover:text-foreground")
              }
            >
              {TACTIC_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted">
          {TACTIC_HINT[state.tactic]}
        </p>
      </div>
    </div>
  );
}

function AnalysisPanel({
  state,
  youId,
  oppId,
}: {
  state: SeasonState;
  youId: number;
  oppId: number;
}) {
  const a = teamSeasonStats(state, youId);
  const b = teamSeasonStats(state, oppId);
  if (a.played === 0 && b.played === 0) {
    return (
      <p className="mt-3 text-center text-[11px] text-muted">
        Analýza formy naskočí po prvních odehraných kolech.
      </p>
    );
  }
  const rows: { label: string; a: string; b: string; better?: "a" | "b" }[] = [
    {
      label: "Pozice",
      a: a.rank ? `${a.rank}.` : "–",
      b: b.rank ? `${b.rank}.` : "–",
      better: a.rank && b.rank ? (a.rank < b.rank ? "a" : a.rank > b.rank ? "b" : undefined) : undefined,
    },
    { label: "Body", a: String(a.points), b: String(b.points), better: cmp(a.points, b.points) },
    {
      label: "Ø vstřelené",
      a: a.avgFor.toFixed(2),
      b: b.avgFor.toFixed(2),
      better: cmp(a.avgFor, b.avgFor),
    },
    {
      label: "Ø obdržené",
      a: a.avgAgainst.toFixed(2),
      b: b.avgAgainst.toFixed(2),
      better: cmp(b.avgAgainst, a.avgAgainst), // méně = lépe
    },
    {
      label: "Čistá konta",
      a: `${a.cleanSheetPct} %`,
      b: `${b.cleanSheetPct} %`,
      better: cmp(a.cleanSheetPct, b.cleanSheetPct),
    },
  ];
  return (
    <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-1 text-center text-xs font-semibold text-foreground">
        Analýza sezóny
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-3 items-center text-xs">
            <span
              className={
                "text-left tabular-nums " +
                (r.better === "a" ? "font-bold text-positive" : "text-foreground")
              }
            >
              {r.a}
            </span>
            <span className="text-center text-[11px] text-muted">{r.label}</span>
            <span
              className={
                "text-right tabular-nums " +
                (r.better === "b" ? "font-bold text-positive" : "text-foreground")
              }
            >
              {r.b}
            </span>
          </div>
        ))}
        {/* Forma */}
        <div className="grid grid-cols-3 items-center text-xs">
          <span className="flex gap-0.5">
            <FormDots form={a.form} />
          </span>
          <span className="text-center text-[11px] text-muted">Forma</span>
          <span className="flex justify-end gap-0.5">
            <FormDots form={b.form} />
          </span>
        </div>
      </div>
    </div>
  );
}

function cmp(x: number, y: number): "a" | "b" | undefined {
  return x > y ? "a" : x < y ? "b" : undefined;
}

function FormDots({ form }: { form: ("W" | "D" | "L")[] }) {
  if (form.length === 0) return <span className="text-[11px] text-muted">–</span>;
  return (
    <>
      {form.map((f, i) => (
        <span
          key={i}
          className={
            "inline-block h-3.5 w-3.5 rounded-sm text-center text-[9px] font-bold leading-[14px] text-white " +
            (f === "W" ? "bg-positive" : f === "L" ? "bg-negative" : "bg-muted")
          }
          title={f}
        >
          {f}
        </span>
      ))}
    </>
  );
}

function ProbBar({
  label,
  pct,
  className,
}: {
  label: string;
  pct: number;
  className: string;
}) {
  const p = Math.round(pct * 100);
  return (
    <div
      className={"flex items-center justify-center py-1 " + className}
      style={{ width: `${Math.max(pct * 100, 8)}%` }}
      title={`${label} ${p}%`}
    >
      {p >= 12 ? `${p}%` : ""}
    </div>
  );
}

function LeagueTable({ state }: { state: SeasonState }) {
  const table = currentTable(state);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-2 py-1.5">#</th>
            <th className="px-2 py-1.5">Tým</th>
            <th className="px-2 py-1.5 text-center">Z</th>
            <th className="px-2 py-1.5 text-center">V-R-P</th>
            <th className="px-2 py-1.5 text-center">Skóre</th>
            <th className="px-2 py-1.5 text-center">B</th>
          </tr>
        </thead>
        <tbody>
          {table.map((row) => {
            const t = teamById(state.teams, row.teamId);
            const mine = row.teamId === state.yourTeamId;
            return (
              <tr
                key={row.teamId}
                className={
                  "border-t border-border " +
                  (mine ? "bg-positive/10 font-semibold" : "")
                }
              >
                <td className="px-2 py-1.5 tabular-nums text-muted">{row.rank}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    <TeamBadge team={t} size={20} />
                    <span className="truncate text-foreground">{t.name}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted">
                  {row.played}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted">
                  {row.win}-{row.draw}-{row.loss}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted">
                  {row.goalsFor}:{row.goalsAgainst}
                </td>
                <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-foreground">
                  {row.points}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function YourForm({ state }: { state: SeasonState }) {
  const results = yourResults(state).slice(0, 6);
  if (results.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-foreground">Tvé poslední zápasy</h3>
      <div className="mt-2 space-y-1.5">
        {results.map((r, i) => {
          const isHome = r.homeId === state.yourTeamId;
          const oppId = isHome ? r.awayId : r.homeId;
          const opp = teamById(state.teams, oppId);
          const yourGoals = isHome ? r.homeGoals : r.awayGoals;
          const oppGoals = isHome ? r.awayGoals : r.homeGoals;
          const outcome =
            yourGoals > oppGoals ? "V" : yourGoals < oppGoals ? "P" : "R";
          const badge =
            outcome === "V"
              ? "bg-positive/15 text-positive"
              : outcome === "P"
                ? "bg-negative/15 text-negative"
                : "bg-border/60 text-muted";
          return (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <span
                className={
                  "flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold " +
                  badge
                }
              >
                {outcome}
              </span>
              <span className="text-xs text-muted">{isHome ? "doma" : "venku"} vs</span>
              <TeamBadge team={opp} size={18} />
              <span className="min-w-0 flex-1 truncate text-foreground">{opp.name}</span>
              <span className="tabular-nums font-medium text-foreground">
                {yourGoals}:{oppGoals}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── konec sezóny + job market ─────────────────────────

function SeasonDone({
  save,
  onContinue,
  onSwitch,
  onError,
}: {
  save: SaveState;
  onContinue: () => void;
  onSwitch: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number
  ) => void;
  onError: (e: string | null) => void;
}) {
  const s = save.current;
  const summary = summarizeSeason(s);
  const projectedRep = updateReputation(save.manager.reputation, summary);
  const repDelta = projectedRep - Math.round(save.manager.reputation);
  const champ = teamById(s.teams, summary.championId);
  const tone = seasonTone(summary);
  const [jobs, setJobs] = useState(false);

  if (jobs) {
    return (
      <JobMarket
        reputation={projectedRep}
        onPick={onSwitch}
        onClose={() => setJobs(false)}
        onError={onError}
      />
    );
  }

  const toneClass =
    tone === "good"
      ? "text-positive"
      : tone === "bad"
        ? "text-negative"
        : "text-foreground";

  return (
    <div className="mt-4">
      <div className="rounded-2xl border border-border bg-surface p-5 text-center shadow-sm">
        <p className="text-3xl">
          {summary.champion ? "🏆" : summary.relegated ? "⚠️" : "🏁"}
        </p>
        <p className="mt-2 text-sm font-semibold text-foreground">
          Sezóna {summary.season} · {s.leagueName}
        </p>
        <p className={"mt-1 text-base font-bold " + toneClass}>
          {seasonHeadline(summary)}
        </p>
        <p className="mt-1 text-sm text-muted">
          {summary.yourRank}. místo · {summary.yourPoints} b ({summary.win}-{summary.draw}-
          {summary.loss}) · očekáváno {summary.expectedRank}.
        </p>
        <p className="mt-1 text-sm text-muted">
          Mistr: <strong className="text-foreground">{champ.name}</strong>
        </p>
        <p className="mt-2 text-xs">
          Reputace{" "}
          <strong className={repDelta >= 0 ? "text-positive" : "text-negative"}>
            {repDelta >= 0 ? "+" : ""}
            {repDelta}
          </strong>{" "}
          → {projectedRep}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Pokračovat s klubem →
          </button>
          <button
            type="button"
            onClick={() => setJobs(true)}
            className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:text-foreground"
          >
            Změnit tým
          </button>
        </div>
      </div>
      <LeagueTable state={s} />
    </div>
  );
}

function JobMarket({
  reputation,
  onPick,
  onClose,
  onError,
}: {
  reputation: number;
  onPick: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number
  ) => void;
  onClose: () => void;
  onError: (e: string | null) => void;
}) {
  const [leagues, setLeagues] = useState<LeagueInfo[] | null>(null);
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [teams, setTeams] = useState<GameTeam[] | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/game/leagues");
        const d = await r.json();
        if (active && r.ok) setLeagues(d.leagues as LeagueInfo[]);
      } catch {
        if (active) onError("Nepodařilo se načíst ligy.");
      }
    })();
    return () => {
      active = false;
    };
  }, [onError]);

  const pickLeague = useCallback(
    async (l: LeagueInfo) => {
      setLeague(l);
      setTeams(null);
      setLoadingTeams(true);
      try {
        const r = await fetch(`/api/game/league?id=${l.id}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Chyba");
        setTeams(d.teams as GameTeam[]);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Nepodařilo se načíst ligu.");
        setLeague(null);
      } finally {
        setLoadingTeams(false);
      }
    },
    [onError]
  );

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Nabídky (reputace {reputation})
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-foreground"
        >
          Zrušit
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        Zvučnější kluby si tě najmou jen s dost vysokou reputací. Buduj ji úspěchem.
      </p>

      {!leagues ? (
        <LoadingRows />
      ) : !league ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {leagues.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => pickLeague(l)}
              className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-3 text-left shadow-sm transition hover:border-foreground/30"
            >
              <span className="text-sm font-medium text-foreground">{l.name}</span>
              <span className="text-xs text-muted">{l.country}</span>
            </button>
          ))}
        </div>
      ) : loadingTeams || !teams ? (
        <LoadingRows />
      ) : (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              setLeague(null);
              setTeams(null);
            }}
            className="text-xs text-muted hover:text-foreground"
          >
            ← Zpět na ligy
          </button>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[...teams]
              .sort((a, b) => teamPrestige(b, league.id, teams) - teamPrestige(a, league.id, teams))
              .map((t) => {
                const prestige = teamPrestige(t, league.id, teams);
                const ok = isHireable(t, league.id, teams, reputation);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!ok}
                    onClick={() => onPick(league.id, league.name, teams, t.id)}
                    className={
                      "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left shadow-sm transition " +
                      (ok
                        ? "border-border bg-surface hover:border-foreground/30"
                        : "border-border/60 bg-surface/40 opacity-60")
                    }
                  >
                    <TeamBadge team={t} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {t.name}
                      </span>
                      <Stars n={strengthStars(t)} />
                    </span>
                    <span className="shrink-0 text-right text-[11px]">
                      <span className="block text-muted">prestiž {prestige}</span>
                      <span className={ok ? "text-positive" : "text-negative"}>
                        {ok ? "dostupný" : "🔒 mimo dosah"}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── kariéra / historie ─────────────────────────

function HistoryView({ save }: { save: SaveState }) {
  const stats = careerStats(save.history);
  if (!stats) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/50 p-8 text-center text-sm text-muted">
        Zatím žádná dohraná sezóna. Dohraj tu aktuální a objeví se tu tvá kariéra.
      </div>
    );
  }
  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatTile label="Sezón" value={stats.seasons} />
        <StatTile label="Titulů" value={stats.titles} accent />
        <StatTile label="Poháry" value={stats.europeanQualifs} />
        <StatTile label="Sestupy" value={stats.relegations} />
        <StatTile label="Ø vstř." value={stats.avgGoalsFor.toFixed(2)} />
        <StatTile label="Ø obdr." value={stats.avgGoalsAgainst.toFixed(2)} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatTile label="Nejlepší" value={`${stats.bestRank}.`} />
        <StatTile label="Průměr" value={`${stats.avgRank}.`} />
        <StatTile label="Čistá konta" value={stats.cleanSheets} />
        <StatTile label="Výhry" value={stats.totalWin} />
        <StatTile label="Remízy" value={stats.totalDraw} />
        <StatTile label="Prohry" value={stats.totalLoss} />
      </div>

      <h3 className="mt-4 text-xs font-semibold text-foreground">Odehrané sezóny</h3>
      <div className="mt-2 space-y-1.5">
        {[...save.history].reverse().map((h, i) => {
          const tone = seasonTone(h);
          const toneClass =
            tone === "good"
              ? "bg-positive/15 text-positive"
              : tone === "bad"
                ? "bg-negative/15 text-negative"
                : "bg-border/60 text-muted";
          return (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="w-8 shrink-0 text-xs text-muted">S{h.season}</span>
              <span className="w-10 shrink-0 text-xs text-muted">{h.yourRank}.</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground">{h.yourName}</span>{" "}
                <span className="text-xs text-muted">· {h.leagueName}</span>
              </span>
              <span
                className={
                  "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold " + toneClass
                }
              >
                {seasonHeadline(h)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-2 py-2.5 text-center shadow-sm">
      <div
        className={
          "text-base font-bold tabular-nums " +
          (accent ? "text-warning" : "text-foreground")
        }
      >
        {value}
      </div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}
