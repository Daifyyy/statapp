"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "./AppHeader";
import { TeamLogo } from "./TeamLogo";
import type { SessionUser } from "./sessionUser";
import { teamById, injectYourTeam } from "@/lib/game/teams";
import { randomSeed } from "@/lib/game/rng";
import { RNG_SALT_LEAGUE } from "@/lib/game/agency";
import {
  newSeason,
  playRound,
  simulateToEnd,
  isSeasonOver,
  currentTable,
  setPlan,
  setInstruction,
  yourNextMatch,
  yourResults,
} from "@/lib/game/engine";
import { summarizeSeason, startNextSeason, careerStats } from "@/lib/game/career";
import {
  updateReputation,
  isHireable,
  expectedRank,
  HIRE_MARGIN,
} from "@/lib/game/reputation";
import {
  teamPrestige,
  seasonHeadline,
  seasonTone,
  leagueStars,
  evaluateSeason,
  nextTransition,
  EUROPE_LABEL,
} from "@/lib/game/leagues";
import { PLAN_LABEL, PLAN_HINT } from "@/lib/game/plans";
import {
  INSTRUCTIONS,
  INSTRUCTION_HINT,
  INSTRUCTION_LABEL,
} from "@/lib/game/instructions";
import { getEvent, applyEventChoice } from "@/lib/game/events";
import { fitnessDelta, fitnessLabel } from "@/lib/game/fitness";
import {
  DEV_AREA_HINT,
  DEV_AREA_LABEL,
  EMPTY_SPEND,
  applyDevelopment,
  developmentPoints,
  nextYouth,
  spendTotal,
} from "@/lib/game/development";
import type { DevSpend } from "@/lib/game/development";
import { teamSeasonStats } from "@/lib/game/analysis";
import { STYLE_LABEL } from "@/lib/game/scouting";
import type { ScoutReport } from "@/lib/game/scouting";
import { emptyProfile, startCareer, foldSeason, foldTournament } from "@/lib/game/profile";
import { ALL_ACHIEVEMENTS, newlyEarned, newlyEarnedTournament } from "@/lib/game/achievements";
import type { AchievementTier } from "@/lib/game/achievements";
import { updateReputationTournament } from "@/lib/game/reputation";
import {
  COMPETITIONS,
  startRun,
  playRunRound,
  simulateRunToEnd,
  isRunOver,
  setRunPlan,
  setRunInstruction,
  applyRunEventChoice,
  runPreview,
  summarizeRun,
  stageReachedOf,
  qualTable,
  nationOptions,
  STAGE_LABEL,
} from "@/lib/game/nationalCompetitions";
import type { CompetitionId, TournamentRun } from "@/lib/game/nationalCompetitions";
import { groupIndexOf, groupTableOf } from "@/lib/game/tournament";
import type { Stage } from "@/lib/game/tournament";
import { SAVE_VERSION } from "@/lib/game/types";
import {
  DEV_STADIUM_STEP,
  DEV_YOUTH_MAX,
  HOME_BOOST_CAP,
  QUAL_ADVANCE,
  STARTING_FITNESS,
  STARTING_REPUTATION,
} from "@/lib/game/balance";
import { leagueName as leagueNameFor } from "@/lib/game/leagues";
import type {
  EarnedAchievement,
  GameTeam,
  Instruction,
  LeagueAccess,
  LeagueInfo,
  ManagerProfile,
  Plan,
  SaveState,
  SeasonState,
  SeasonSummary,
} from "@/lib/game/types";

type GameView = "season" | "history" | "profile";

const NAV = [
  { href: "/", label: "Zápasy", emoji: "📅" },
  { href: "/predikce", label: "Tipy", emoji: "📈" },
  { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
];

const PLANS: Plan[] = ["balanced", "open", "low_block", "press", "counter"];

/** Data pro popup výsledku po odehraném kole. */
interface ToastData {
  oppName: string;
  yourGoals: number;
  oppGoals: number;
  /** Změna morálky za tento zápas (±), aby efekt výsledku nebyl jen tichá aktualizace baru. */
  moraleDelta: number;
}

/**
 * Uloží stav na server. Vrací, zda uložení uspělo – volající při `false` zobrazí
 * chybový banner s možností zkusit znovu (jinak by hráč mohl tiše přijít o postup,
 * viz `onSaveError`/`saveError` v `HraApp`).
 */
async function saveEndpoint(next: SaveState): Promise<boolean> {
  try {
    const r = await fetch("/api/game", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: next }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Migruje uložený save na aktuální SAVE_VERSION beze ztráty rozehrané kariéry. Appka
 * běží živě (Vercel) → bump verze nesmí zahodit existující save, jen doplní nová pole.
 * Neznámá/nižší než migrovaná verze → zahodit (nekompatibilní tvar).
 */
function migrateSave(raw: unknown): SaveState | null {
  let save = raw as (SaveState & { version: number }) | null | undefined;
  if (!save) return null;
  // Migrace se řetězí (5 → 6 → 7 → 8), ať starý save nezůstane viset na mezikroku.
  if (save.version === 5) {
    save = {
      ...save,
      version: 6,
      current: save.current ? { ...save.current, leagueAccess: null } : null,
    };
  }
  if (save.version === 6) {
    // v7 přidal kondici, vedlejší instrukci, mládež, rozvojový bonus a scout boost.
    save = {
      ...save,
      version: 7,
      current: save.current
        ? {
            ...save.current,
            instruction: "none",
            fitness: STARTING_FITNESS,
            youth: 0,
            devBonus: 0,
            scoutBoostUntilRound: null,
          }
        : null,
    };
  }
  if (save.version === 7) {
    // v8 oddělil RNG proudy režimů (liga vs. reprezentační turnaj) – `agency.ts`.
    save = {
      ...save,
      version: 8,
      current: save.current ? { ...save.current, rngSalt: RNG_SALT_LEAGUE } : null,
    };
  }
  if (save.version === SAVE_VERSION) return save;
  return null;
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
  const [view, setView] = useState<GameView>("season");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [hasUnseenAchievement, setHasUnseenAchievement] = useState(false);
  /** Stav, který se nepodařilo uložit na server – zůstává, dokud "Zkusit znovu" neuspěje. */
  const [saveError, setSaveError] = useState<SaveState | null>(null);

  const trackSave = useCallback((next: SaveState) => {
    saveEndpoint(next).then((ok) => setSaveError(ok ? null : next));
  }, []);

  const retrySave = useCallback(() => {
    if (saveError) trackSave(saveError);
  }, [saveError, trackSave]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/game");
        const d = await r.json();
        if (!active) return;
        if (!r.ok) throw new Error(d.error ?? "Chyba načtení");
        setSave(migrateSave(d.save));
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

  const startGame = useCallback(
    (
      leagueId: number,
      leagueName: string,
      teams: GameTeam[],
      teamId: number,
      leagueAccess: LeagueAccess | null
    ) => {
      const seed = randomSeed();
      const current = newSeason(seed, teamId, { teams, leagueId, leagueName, leagueAccess });
      setSave((prev) => {
        // Trvalý profil se zachová napříč kariérami; nová kariéra jen navýší počítadlo.
        const profile = startCareer(prev?.profile ?? emptyProfile());
        const next: SaveState = {
          version: SAVE_VERSION,
          profile,
          // Nová kariéra startuje na pevné reputaci → výběr klubu je gated (ne top klub).
          manager: { reputation: STARTING_REPUTATION },
          current,
          history: [],
        };
        trackSave(next);
        return next;
      });
      setView("season");
    },
    [trackSave]
  );

  const mutateSeason = useCallback((fn: (s: SeasonState) => SeasonState) => {
    setSave((prev) => {
      if (!prev || !prev.current) return prev;
      const next = { ...prev, current: fn(prev.current) };
      trackSave(next);
      return next;
    });
  }, [trackSave]);

  const mutateRun = useCallback((fn: (r: TournamentRun) => TournamentRun) => {
    setSave((prev) => {
      if (!prev || !prev.tournament) return prev;
      const next = { ...prev, tournament: fn(prev.tournament) };
      trackSave(next);
      return next;
    });
  }, [trackSave]);

  // ── Reprezentace: převzetí národa (mimo klubovou kariéru) ──
  const startTournament = useCallback(
    (competitionId: CompetitionId, teamId: number) => {
      setSave((prev) => {
        const base = prev ?? {
          version: SAVE_VERSION,
          profile: emptyProfile(),
          manager: { reputation: STARTING_REPUTATION },
          current: null,
          history: [],
        };
        // Reputace se SDÍLÍ napříč reprezentačními turnaji (buduje se) – nereset jako u klubu.
        const edition = (base.tournamentHistory?.length ?? 0) + 1;
        const run = startRun(competitionId, teamId, randomSeed(), edition);
        const next: SaveState = {
          ...base,
          profile: startCareer(base.profile),
          current: null,
          tournament: run,
          tournamentHistory: base.tournamentHistory ?? [],
        };
        trackSave(next);
        return next;
      });
      setView("season");
    },
    [trackSave]
  );

  const onTournPlayRound = useCallback(() => {
    setBusy(true);
    setTimeout(() => {
      setSave((prev) => {
        if (!prev || !prev.tournament || isRunOver(prev.tournament)) return prev;
        const before = prev.tournament;
        const prevActive = before.phase === "qualification" ? before.qualification : before.tournament;
        const prevMorale = prevActive?.morale ?? 0;
        const after = playRunRound(before);
        const next = { ...prev, tournament: after };
        trackSave(next);
        // Popup výsledku – z fáze, která se právě odehrála (before.phase).
        const results =
          before.phase === "qualification" ? after.qualification.results : after.tournament?.results ?? [];
        const yourLast = [...results].reverse().find((r) => r.homeId === before.yourTeamId || r.awayId === before.yourTeamId);
        if (yourLast) {
          const isHome = yourLast.homeId === before.yourTeamId;
          const teams = (before.phase === "qualification" ? after.qualification : after.tournament!).teams;
          const opp = teamById(teams, isHome ? yourLast.awayId : yourLast.homeId);
          const nextActive = after.phase === "qualification" ? after.qualification : after.tournament;
          const data: ToastData = {
            oppName: opp.name,
            yourGoals: isHome ? yourLast.homeGoals : yourLast.awayGoals,
            oppGoals: isHome ? yourLast.awayGoals : yourLast.homeGoals,
            moraleDelta: (nextActive?.morale ?? prevMorale) - prevMorale,
          };
          queueMicrotask(() => setToast(data));
        }
        return next;
      });
      setBusy(false);
    }, 0);
  }, [trackSave]);

  const onTournSimToEnd = useCallback(() => {
    if (
      !confirm(
        "Dohrát celý turnaj s aktuálním plánem? Zbývající zápasy se odehrají najednou, události se přeskočí a akci nejde vrátit."
      )
    )
      return;
    setBusy(true);
    setTimeout(() => {
      mutateRun((r) => simulateRunToEnd(r));
      setBusy(false);
    }, 0);
  }, [mutateRun]);

  const onTournPlan = useCallback((p: Plan) => mutateRun((r) => setRunPlan(r, p)), [mutateRun]);
  const onTournInstruction = useCallback(
    (i: Instruction) => mutateRun((r) => setRunInstruction(r, i)),
    [mutateRun]
  );
  const onTournEventChoice = useCallback(
    (choiceIndex: number) => mutateRun((r) => applyRunEventChoice(r, choiceIndex)),
    [mutateRun]
  );

  // Uzavře turnaj: souhrn + reputace + fold do profilu + achievementy, pak zpět do hubu.
  const onFinishTournament = useCallback(() => {
    setSave((prev) => {
      if (!prev || !prev.tournament) return prev;
      const summary = summarizeRun(prev.tournament);
      const reputation = updateReputationTournament(prev.manager.reputation, summary);
      const folded = foldTournament(prev.profile, summary);
      const earned = newlyEarnedTournament(
        prev.profile.achievements.map((a) => a.id),
        { allTime: folded.allTime, last: summary, reputation }
      );
      const nowIso = new Date().toISOString();
      const profile: ManagerProfile = {
        ...folded,
        achievements: [
          ...folded.achievements,
          ...earned.map((a) => ({ id: a.id, season: summary.edition, date: nowIso })),
        ],
      };
      const next: SaveState = {
        ...prev,
        profile,
        manager: { reputation },
        tournament: null,
        tournamentHistory: [...(prev.tournamentHistory ?? []), summary],
      };
      trackSave(next);
      if (earned.length > 0) setHasUnseenAchievement(true);
      return next;
    });
    setView("season");
  }, [trackSave]);

  const onPlayRound = useCallback(() => {
    setBusy(true);
    // setTimeout (ne přímo synchronně) nechá prohlížeč nejdřív vykreslit `busy`
    // stav (spinner/disabled) – jinak React batchuje a "busy" se nikdy nezobrazí.
    setTimeout(() => {
      setSave((prev) => {
        if (!prev || !prev.current || isSeasonOver(prev.current)) return prev;
        const prevMorale = prev.current.morale;
        const after = playRound(prev.current);
        const next = { ...prev, current: after };
        trackSave(next);
        // Popup výsledku tvého zápasu (jen pro jednotlivé kolo, ne „Dohrát sezónu").
        const r = yourResults(after)[0];
        if (r) {
          const isHome = r.homeId === after.yourTeamId;
          const opp = teamById(after.teams, isHome ? r.awayId : r.homeId);
          const data: ToastData = {
            oppName: opp.name,
            yourGoals: isHome ? r.homeGoals : r.awayGoals,
            oppGoals: isHome ? r.awayGoals : r.homeGoals,
            moraleDelta: after.morale - prevMorale,
          };
          queueMicrotask(() => setToast(data));
        }
        return next;
      });
      setBusy(false);
    }, 0);
  }, [trackSave]);

  const onSimulateToEnd = useCallback(() => {
    const planLabel = save?.current ? PLAN_LABEL[save.current.plan] : "";
    if (
      !confirm(
        `Dohrát celou sezónu s aktuálně zvoleným plánem (${planLabel})? Zbývající zápasy se odehrají najednou se stejným plánem, náhodné události se přeskočí a akci nejde vrátit zpět.`
      )
    )
      return;
    setBusy(true);
    setTimeout(() => {
      mutateSeason((s) => simulateToEnd(s));
      setBusy(false);
    }, 0);
  }, [mutateSeason, save]);

  const onPlan = useCallback(
    (p: Plan) => mutateSeason((s) => setPlan(s, p)),
    [mutateSeason]
  );

  const onInstruction = useCallback(
    (i: Instruction) => mutateSeason((s) => setInstruction(s, i)),
    [mutateSeason]
  );

  const onEventChoice = useCallback(
    (choiceIndex: number) =>
      mutateSeason((s) => applyEventChoice(s, choiceIndex)),
    [mutateSeason]
  );

  // Uzavře sezónu (souhrn + reputace + fold do trvalého profilu + achievementy),
  // pak sestaví další (pokračovat / změnit tým).
  const finishAndAdvance = useCallback(
    (buildNext: (prev: SaveState, current: SeasonState) => SeasonState) => {
      setSave((prev) => {
        if (!prev || !prev.current) return prev;
        const summary = summarizeSeason(prev.current);
        const reputation = updateReputation(prev.manager.reputation, summary);
        const folded = foldSeason(prev.profile, summary, reputation);
        const earned = newlyEarned(
          prev.profile.achievements.map((a) => a.id),
          { allTime: folded.allTime, last: summary, reputation }
        );
        const nowIso = new Date().toISOString();
        const profile: ManagerProfile = {
          ...folded,
          achievements: [
            ...folded.achievements,
            ...earned.map((a) => ({ id: a.id, season: summary.season, date: nowIso })),
          ],
        };
        const next: SaveState = {
          ...prev,
          profile,
          manager: { reputation },
          current: buildNext(prev, prev.current),
          history: [...prev.history, summary],
        };
        trackSave(next);
        if (earned.length > 0) setHasUnseenAchievement(true);
        return next;
      });
      setView("season");
    },
    [trackSave]
  );

  const onContinue = useCallback(
    (spend: DevSpend) =>
      finishAndAdvance((_prev, current) => startNextSeason(current, spend)),
    [finishAndAdvance]
  );

  const onSwitch = useCallback(
    (
      leagueId: number,
      leagueName: string,
      teams: GameTeam[],
      teamId: number,
      leagueAccess: LeagueAccess | null,
      // Postup/sestup si klub bereš s sebou → mládež jde s ním. Job market = nový klub → 0.
      youth = 0
    ) =>
      finishAndAdvance((_prev, current) =>
        newSeason(randomSeed(), teamId, {
          teams,
          leagueId,
          leagueName,
          leagueAccess,
          season: current.season + 1,
          youth,
        })
      ),
    [finishAndAdvance]
  );

  const onReset = useCallback(() => {
    if (
      !confirm(
        "Ukončit aktuální kariéru? Rozehraná sezóna a její historie se smažou, ale síň slávy (rekordy + achievementy) zůstane."
      )
    )
      return;
    setSave((prev) => {
      if (!prev) return prev;
      const next: SaveState = {
        ...prev,
        manager: { reputation: STARTING_REPUTATION },
        current: null,
        history: [],
        tournament: null,
        tournamentHistory: [],
      };
      trackSave(next);
      return next;
    });
    setView("season");
    setHasUnseenAchievement(false);
  }, [trackSave]);

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

      {saveError && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          <span>Nepodařilo se uložit postup. Zkontroluj připojení.</span>
          <button
            type="button"
            onClick={retrySave}
            className="shrink-0 rounded-full border border-negative/50 px-3 py-1 text-xs font-semibold hover:bg-negative/15"
          >
            Zkusit znovu
          </button>
        </div>
      )}

      {!user ? (
        <SignInGate />
      ) : loading ? (
        <LoadingRows />
      ) : save?.tournament ? (
        <TournamentView
          save={save}
          managerName={user.name ?? null}
          run={save.tournament}
          busy={busy}
          onPlayRound={onTournPlayRound}
          onSimulateToEnd={onTournSimToEnd}
          onPlan={onTournPlan}
          onInstruction={onTournInstruction}
          onEventChoice={onTournEventChoice}
          onFinish={onFinishTournament}
          onReset={onReset}
        />
      ) : !save?.current ? (
        <ManagerHub
          save={save}
          managerName={user.name ?? null}
          onStart={startGame}
          onStartTournament={startTournament}
          onError={setError}
        />
      ) : (
        <GameView
          save={save}
          managerName={user.name ?? null}
          view={view}
          setView={setView}
          busy={busy}
          onPlayRound={onPlayRound}
          onSimulateToEnd={onSimulateToEnd}
          onPlan={onPlan}
          onInstruction={onInstruction}
          onEventChoice={onEventChoice}
          onContinue={onContinue}
          onSwitch={onSwitch}
          onReset={onReset}
          onError={setError}
          hasUnseenAchievement={hasUnseenAchievement}
          onDismissUnseenAchievement={() => setHasUnseenAchievement(false)}
        />
      )}

      <MatchResultToast toast={toast} onClose={() => setToast(null)} />
    </main>
  );
}

/** Popup výsledku po odehraném kole (fixní overlay dole, auto-dismiss ~2.2 s). */
function MatchResultToast({
  toast,
  onClose,
}: {
  toast: ToastData | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 2200);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;
  const outcome =
    toast.yourGoals > toast.oppGoals
      ? { label: "Výhra", cls: "border-positive bg-positive/15 text-positive" }
      : toast.yourGoals < toast.oppGoals
        ? { label: "Prohra", cls: "border-negative bg-negative/15 text-negative" }
        : { label: "Remíza", cls: "border-border bg-surface text-muted" };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={
          "fade-in pointer-events-auto flex items-center gap-3 rounded-full border px-5 py-2.5 shadow-lg backdrop-blur " +
          outcome.cls
        }
        role="status"
      >
        <span className="text-sm font-bold">{outcome.label}</span>
        <span className="tabular-nums text-base font-bold text-foreground">
          {toast.yourGoals}:{toast.oppGoals}
        </span>
        <span className="max-w-[45vw] truncate text-xs text-muted">
          vs {toast.oppName}
        </span>
        {toast.moraleDelta !== 0 && (
          <span
            className={
              "text-xs font-semibold tabular-nums " +
              (toast.moraleDelta > 0 ? "text-positive" : "text-negative")
            }
          >
            {toast.moraleDelta > 0 ? "+" : ""}
            {toast.moraleDelta} morálka
          </span>
        )}
      </div>
    </div>
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

function Stars({ n }: { n: number }) {
  return (
    <span className="text-xs text-warning">
      {"★".repeat(n)}
      <span className="text-muted">{"★".repeat(5 - n)}</span>
    </span>
  );
}

// ───────────────────────── nová hra ─────────────────────────

/**
 * Sdílená datová logika výběru liga→klub (dřív duplikovaná v `NewGameFlow` i
 * `JobMarket`): fetch seznamu lig, fetch týmů zvolené ligy, reset zpět na seznam lig.
 */
function useLeaguePicker(onError: (e: string | null) => void) {
  const [leagues, setLeagues] = useState<LeagueInfo[] | null>(null);
  const [league, setLeague] = useState<LeagueInfo | null>(null);
  const [teams, setTeams] = useState<GameTeam[] | null>(null);
  const [leagueAccess, setLeagueAccess] = useState<LeagueAccess | null>(null);
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
      setLeagueAccess(null);
      setLoadingTeams(true);
      onError(null);
      try {
        const r = await fetch(`/api/game/league?id=${l.id}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Chyba");
        setTeams(d.teams as GameTeam[]);
        setLeagueAccess((d.leagueAccess as LeagueAccess | null) ?? null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Nepodařilo se načíst ligu.");
        setLeague(null);
      } finally {
        setLoadingTeams(false);
      }
    },
    [onError]
  );

  const backToLeagues = useCallback(() => {
    setLeague(null);
    setTeams(null);
  }, []);

  return { leagues, league, teams, leagueAccess, loadingTeams, pickLeague, backToLeagues };
}

/** Seznam lig k výběru (krok 1) – identický v `NewGameFlow` i `JobMarket`. */
function LeagueList({
  leagues,
  onPick,
}: {
  leagues: LeagueInfo[];
  onPick: (l: LeagueInfo) => void;
}) {
  // Nejvyšší soutěže a 2. ligy odděleně – ve 2. lize začíná kariéra „zdola nahoru".
  // Sekce se vykreslí jen když v ní něco je (mock režim má jedinou fiktivní ligu).
  const groups: { label: string; hint?: string; items: LeagueInfo[] }[] = [
    { label: "Nejvyšší ligy", items: leagues.filter((l) => (l.tier ?? 1) === 1) },
    {
      label: "2. ligy",
      hint: "Nižší prestiž — start kariéry s cílem postoupit",
      items: leagues.filter((l) => l.tier === 2),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="mt-3 space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          {groups.length > 1 && (
            <div className="mb-2">
              <h4 className="text-xs font-semibold text-foreground">{g.label}</h4>
              {g.hint && <p className="text-[11px] text-muted">{g.hint}</p>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {g.items.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onPick(l)}
                className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-3 text-left shadow-sm transition hover:border-foreground/30"
              >
                <span className="text-sm font-medium text-foreground">{l.name}</span>
                <span className="text-xs text-muted">{l.country}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewGameFlow({
  onStart,
  onError,
}: {
  onStart: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number,
    leagueAccess: LeagueAccess | null
  ) => void;
  onError: (e: string | null) => void;
}) {
  const { leagues, league, teams, leagueAccess, loadingTeams, pickLeague, backToLeagues } =
    useLeaguePicker(onError);

  if (!leagues) return <LoadingRows />;

  // Krok 2: výběr klubu ve zvolené lize.
  if (league) {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={backToLeagues}
          className="text-xs text-muted hover:text-foreground"
        >
          ← Zpět na ligy
        </button>
        <h2 className="mt-2 text-sm font-semibold text-foreground">
          {league.name} — vyber svůj klub
        </h2>
        <p className="mt-1 text-xs text-muted">
          Jako začínající trenér (reputace {STARTING_REPUTATION}) tě zatím vezmou jen menší
          kluby. K velkým se propracuj úspěchy.
        </p>
        {loadingTeams || !teams ? (
          <LoadingRows />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[...teams]
              .sort(
                (a, b) => leagueStars(b, teams) - leagueStars(a, teams)
              )
              .map((t) => {
                const ok = isHireable(t, league.id, teams, STARTING_REPUTATION);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!ok}
                    onClick={() => onStart(league.id, league.name, teams, t.id, leagueAccess)}
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
                      <Stars n={leagueStars(t, teams)} />
                    </span>
                    {!ok && (
                      <span className="shrink-0 text-[11px] text-negative">
                        🔒 mimo dosah
                      </span>
                    )}
                  </button>
                );
              })}
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
      <LeagueList leagues={leagues} onPick={pickLeague} />
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
  onPlan,
  onInstruction,
  onEventChoice,
  onContinue,
  onSwitch,
  onReset,
  onError,
  hasUnseenAchievement,
  onDismissUnseenAchievement,
}: {
  save: SaveState;
  managerName: string | null;
  view: GameView;
  setView: (v: GameView) => void;
  busy: boolean;
  onPlayRound: () => void;
  onSimulateToEnd: () => void;
  onPlan: (p: Plan) => void;
  onInstruction: (i: Instruction) => void;
  onEventChoice: (choiceIndex: number) => void;
  onContinue: (spend: DevSpend) => void;
  onSwitch: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number,
    leagueAccess: LeagueAccess | null,
    youth?: number
  ) => void;
  onReset: () => void;
  onError: (e: string | null) => void;
  hasUnseenAchievement: boolean;
  onDismissUnseenAchievement: () => void;
}) {
  const s = save.current;
  if (!s) return null; // GameView se renderuje jen s aktivní kariérou
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
        <div className="flex flex-wrap items-center gap-1.5">
          <Segment active={view === "season"} onClick={() => setView("season")}>
            Sezóna
          </Segment>
          <Segment active={view === "history"} onClick={() => setView("history")}>
            Kariéra
          </Segment>
          <Segment
            active={view === "profile"}
            dot={hasUnseenAchievement}
            onClick={() => {
              setView("profile");
              onDismissUnseenAchievement();
            }}
          >
            Profil
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

      {view !== "profile" && (
        <ManagerSummaryBar save={save} managerName={managerName} />
      )}

      {view === "season" && !done && (
        <RoleNote save={save} />
      )}

      {view === "profile" ? (
        <ProfilePanel
          profile={save.profile}
          reputation={save.manager.reputation}
          managerName={managerName}
          activeCareer
        />
      ) : view === "history" ? (
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
          {s.pendingEvent && (
            <EventCard event={s.pendingEvent} onChoice={onEventChoice} />
          )}
          <NextMatch state={s} onPlan={onPlan} onInstruction={onInstruction} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || Boolean(s.pendingEvent)}
              onClick={onPlayRound}
              title={s.pendingEvent ? "Nejdřív vyřeš událost výše" : undefined}
              className="flex-1 rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Simuluje se…" : "Odehrát kolo"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSimulateToEnd}
              className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-50"
            >
              {busy ? "Simuluje se…" : "Dohrát sezónu"}
            </button>
          </div>
          <ClubOverview state={s} />
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
  dot,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Malá tečka signalizující nový obsah (např. neprohlédnutý achievement). */
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "relative rounded-full px-3 py-1.5 text-xs font-medium transition " +
        (active
          ? "bg-foreground text-background"
          : "border border-border bg-surface text-muted hover:text-foreground")
      }
    >
      {children}
      {dot && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-negative" />
      )}
    </button>
  );
}

/** Rychlý přehled nad Sezóna/Kariéra tabem – ne totéž jako typ `ManagerProfile` z types.ts. */
function ManagerSummaryBar({
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
  if (!s) return null;
  const you = teamById(s.teams, s.yourTeamId);
  const prestige = teamPrestige(you, s.leagueId, s.teams);
  const exp = expectedRank(you, s.teams);
  const reach = Math.round(save.manager.reputation) + HIRE_MARGIN;
  return (
    <div className="mt-2 rounded-xl border border-dashed border-border bg-surface/50 px-3 py-2 text-xs text-muted">
      <p>
        Vedeš <strong className="text-foreground">{you.name}</strong> ({s.leagueName}) —
        prestiž klubu <strong className="text-foreground">{prestige}</strong>, očekává se{" "}
        <strong className="text-foreground">{exp}. místo</strong>. S reputací tě teď osloví
        kluby do prestiže ~{reach}.
      </p>
      <p className="mt-1 flex items-center gap-1.5">
        <span aria-hidden>🎯</span>
        <span>
          Cíl sezóny:{" "}
          <strong className="text-foreground">{s.objective.text}</strong>
        </span>
      </p>
    </div>
  );
}

function NextMatch({
  state,
  onPlan,
  onInstruction,
}: {
  state: SeasonState;
  onPlan: (p: Plan) => void;
  onInstruction: (i: Instruction) => void;
}) {
  const next = yourNextMatch(state);
  if (!next) return null;
  const you = teamById(state.teams, state.yourTeamId);

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

      {/* Predikce modelu – domácí vlevo / host vpravo, stejně jako odznaky výše a jako
          v MatchPrediction.tsx (bez ohledu na to, kde hraješ ty). */}
      <div className="mt-3">
        <div className="mb-1 text-center text-xs text-muted">Predikce modelu</div>
        <div className="flex items-center justify-between text-sm font-bold tabular-nums">
          <span className="text-home">{Math.round(next.probs.homeWin * 100)} %</span>
          <span className="text-muted">{Math.round(next.probs.draw * 100)} %</span>
          <span className="text-away">{Math.round(next.probs.awayWin * 100)} %</span>
        </div>
        <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-border/60">
          <div
            className="bar-fill bg-home/80"
            style={{ width: `${next.probs.homeWin * 100}%` }}
          />
          <div
            className="bar-fill bg-muted/50"
            style={{ width: `${next.probs.draw * 100}%` }}
          />
          <div
            className="bar-fill bg-away/80"
            style={{ width: `${next.probs.awayWin * 100}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
          <span className="max-w-[40%] truncate">
            {next.isHome ? you.name : next.opponent.name}
            {next.isHome ? " (ty)" : ""}
          </span>
          <span>Remíza</span>
          <span className="max-w-[40%] truncate text-right">
            {next.isHome ? next.opponent.name : you.name}
            {next.isHome ? "" : " (ty)"}
          </span>
        </div>
      </div>

      {/* Scouting soupeře */}
      <ScoutCard scout={next.scout} oppName={next.opponent.name} />

      {/* Morálka + kondice */}
      <MoraleBar morale={state.morale} />
      <FitnessBar fitness={state.fitness} plan={state.plan} />

      {/* Aktivní dočasné efekty z eventů – jinak jsou pro hráče neviditelné */}
      <ActiveModifiers state={state} />

      {/* Analýza z odehrané sezóny */}
      <AnalysisPanel state={state} youId={you.id} oppId={next.opponent.id} />

      {/* Zápasový plán */}
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-foreground">Zápasový plán</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {PLANS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={state.plan === p}
              onClick={() => onPlan(p)}
              className={
                "rounded-lg px-2 py-1.5 text-xs font-medium transition " +
                (state.plan === p
                  ? "bg-foreground text-background"
                  : "border border-border bg-surface text-muted hover:text-foreground")
              }
            >
              {PLAN_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted">
          {PLAN_HINT[state.plan]}
        </p>

        {/* Vedlejší instrukce – míří na traity soupeře, ne na jeho styl */}
        <InstructionPicker
          value={state.instruction}
          onPick={onInstruction}
          disabled={false}
        />
      </div>
    </div>
  );
}

/**
 * Scouting karta soupeře: HLÁŠENÝ styl + konfidence + traity.
 * Pozor: `scout.style` (pravda) se sem nesmí dostat – protitah by pak byl jistota.
 */
function ScoutCard({ scout, oppName }: { scout: ScoutReport; oppName: string }) {
  const pct = Math.round(scout.confidence * 100);
  const sure = scout.confidence >= 0.9;
  return (
    <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">🔍 Scouting</span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted">
            {sure ? "" : "spíš "}
            {STYLE_LABEL[scout.reportedStyle]}
          </span>
          <span
            className={
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold " +
              (sure ? "bg-positive/15 text-positive" : "bg-warning/15 text-warning")
            }
            title="Spolehlivost hlášení skautů. Zbytek času se mohou splést."
          >
            {pct} %
          </span>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        <span className="text-foreground">{oppName}:</span> {scout.note}
      </p>
    </div>
  );
}

/** Ukazatel morálky/momentum týmu. */
function MoraleBar({ morale }: { morale: number }) {
  const m = Math.round(morale);
  const tone =
    m >= 66 ? "bg-positive" : m >= 40 ? "bg-warning" : "bg-negative";
  const label = m >= 66 ? "Výborná" : m >= 40 ? "Slušná" : "Nízká";
  return (
    <div className="mt-3 flex items-center gap-2 text-xs">
      <span className="text-muted">Morálka</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
        <div className={"bar-fill h-full rounded-full " + tone} style={{ width: `${m}%` }} />
      </div>
      <span className="tabular-nums font-semibold text-foreground">{label}</span>
    </div>
  );
}

/**
 * Ukazatel kondice. Vedle stavu ukazuje i to, jak ji zvolený plán posune za kolo –
 * bez toho by hráč netušil, že `press`/`open` tým dlouhodobě uběhá.
 */
function FitnessBar({ fitness, plan }: { fitness: number; plan: Plan }) {
  const f = Math.round(fitness);
  const tone = f >= 85 ? "bg-positive" : f >= 65 ? "bg-warning" : "bg-negative";
  const delta = fitnessDelta(plan);
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="text-muted">Kondice</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
        <div className={"bar-fill h-full rounded-full " + tone} style={{ width: `${f}%` }} />
      </div>
      <span
        className={
          "tabular-nums text-[10px] font-medium " +
          (delta > 0 ? "text-positive" : delta < 0 ? "text-negative" : "text-muted")
        }
        title={`Zvolený plán mění kondici o ${delta > 0 ? "+" : ""}${delta} za kolo.`}
      >
        {delta > 0 ? "+" : ""}
        {delta}/kolo
      </span>
      <span className="tabular-nums font-semibold text-foreground">{fitnessLabel(f)}</span>
    </div>
  );
}

/** Výběr vedlejší instrukce – funguje proti konkrétním traitům soupeře. */
function InstructionPicker({
  value,
  onPick,
  disabled,
}: {
  value: Instruction;
  onPick: (i: Instruction) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold text-foreground">Vedlejší instrukce</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {INSTRUCTIONS.map((i) => {
          const active = i === value;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onPick(i)}
              title={INSTRUCTION_HINT[i]}
              className={
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 " +
                (active
                  ? "border-foreground/40 bg-foreground/10 text-foreground"
                  : "border-border bg-surface text-muted hover:text-foreground")
              }
            >
              {INSTRUCTION_LABEL[i]}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-muted">{INSTRUCTION_HINT[value]}</p>
    </div>
  );
}

/** Aktivní dočasné modifikátory z eventů (jinak by hráč neviděl, že ještě běží). */
function ActiveModifiers({
  state,
}: {
  state: { modifiers: SeasonState["modifiers"]; round: number };
}) {
  const active = state.modifiers.filter((m) => m.untilRound >= state.round);
  if (active.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      <div className="text-[11px] font-semibold text-foreground">Aktivní efekty</div>
      {active.map((m, i) => {
        const roundsLeft = m.untilRound - state.round + 1;
        const attackUp = m.attack != null && m.attack > 1;
        const attackDown = m.attack != null && m.attack < 1;
        const concedeUp = m.concede != null && m.concede > 1; // víc obdržených = horší
        const concedeDown = m.concede != null && m.concede < 1;
        const positive = attackUp || concedeDown;
        const negative = attackDown || concedeUp;
        const tone = positive && !negative ? "text-positive" : negative && !positive ? "text-negative" : "text-muted";
        return (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-2.5 py-1 text-[11px]"
          >
            <span className={tone}>
              {positive ? "▲ " : negative ? "▼ " : ""}
              {m.label}
            </span>
            <span className="text-muted">
              ještě {roundsLeft} {roundsLeft === 1 ? "kolo" : roundsLeft < 5 ? "kola" : "kol"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Karta náhodného eventu s volbami (nutno zvolit před odehráním kola). */
function EventCard({
  event,
  onChoice,
}: {
  event: NonNullable<SeasonState["pendingEvent"]>;
  onChoice: (choiceIndex: number) => void;
}) {
  const ev = getEvent(event.id);
  if (!ev) return null;
  return (
    <div className="mt-4 rounded-2xl border border-warning/50 bg-warning/10 p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-warning">
        ⚡ Událost
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{ev.title}</div>
      <p className="mt-1 text-xs text-muted">{ev.text}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {ev.choices.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChoice(i)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-left transition hover:border-foreground/30"
          >
            <span className="block text-sm font-medium text-foreground">{c.label}</span>
            <span className="block text-[11px] text-muted">{c.detail}</span>
          </button>
        ))}
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

/** Zóna umístění (postup / pohár / sestup) pro barevné zvýraznění řádku tabulky. */
interface RankZone {
  key: "promo" | "ucl" | "uel" | "uecl" | "releg";
  border: string;
  dot: string;
  label: string;
}

function rankZone(
  rank: number,
  size: number,
  leagueId: number,
  leagueAccess: LeagueAccess | null
): RankZone | null {
  const v = evaluateSeason(rank, size, leagueId, leagueAccess);
  if (v.promoted)
    return { key: "promo", border: "border-l-positive", dot: "bg-positive", label: "Postup" };
  if (v.relegated)
    return { key: "releg", border: "border-l-negative", dot: "bg-negative", label: "Sestup" };
  const e = v.europe;
  if (e === "UCL" || e === "UCL_Q")
    return { key: "ucl", border: "border-l-home", dot: "bg-home", label: EUROPE_LABEL[e] };
  if (e === "UEL" || e === "UEL_Q")
    return { key: "uel", border: "border-l-away", dot: "bg-away", label: EUROPE_LABEL[e] };
  if (e === "UECL" || e === "UECL_Q")
    return { key: "uecl", border: "border-l-positive", dot: "bg-positive", label: EUROPE_LABEL[e] };
  return null;
}

function LeagueTable({ state }: { state: SeasonState }) {
  const table = currentTable(state);
  const size = state.teams.length;
  const zones = table.map((row) =>
    rankZone(row.rank, size, state.leagueId, state.leagueAccess)
  );
  // Legenda jen pro zóny, které v této lize reálně existují. Dedup podle POPISKU, ne
  // klíče: Francie má 1.–2. „Liga mistrů" a 3. „Liga mistrů (předkolo)" – oboje `key: ucl`,
  // takže dedup podle klíče by druhý popisek zahodil.
  const legend = zones
    .filter((z): z is RankZone => Boolean(z))
    .filter((z, i, arr) => arr.findIndex((x) => x.label === z.label) === i);

  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
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
            {table.map((row, i) => {
              const t = teamById(state.teams, row.teamId);
              const mine = row.teamId === state.yourTeamId;
              const zone = zones[i];
              return (
                <tr
                  key={row.teamId}
                  className={
                    "border-t border-border " +
                    (mine ? "bg-positive/10 font-semibold" : "")
                  }
                >
                  <td
                    className={
                      "border-l-4 py-1.5 pl-2 pr-2 tabular-nums text-muted " +
                      (zone ? zone.border : "border-l-transparent")
                    }
                    title={zone?.label}
                  >
                    {row.rank}
                  </td>
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
      {legend.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
          {legend.map((z) => (
            <span key={z.label} className="flex items-center gap-1">
              <span className={"inline-block h-2 w-2 rounded-sm " + z.dot} />
              {z.label}
            </span>
          ))}
        </div>
      )}
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

/** Načte týmy jedné ligy s ratingy (pro přechod sestup/postup). */
async function fetchGameLeagueTeams(
  id: number
): Promise<{ teams: GameTeam[]; leagueAccess: LeagueAccess | null }> {
  const r = await fetch(`/api/game/league?id=${id}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Chyba");
  return {
    teams: d.teams as GameTeam[],
    leagueAccess: (d.leagueAccess as LeagueAccess | null) ?? null,
  };
}

const DEV_AREAS: (keyof DevSpend)[] = ["attack", "defense", "youth", "stadium"];

/**
 * Rozdělení rozvojových bodů mezi sezónami. Body dává výsledek sezóny (umístění, cíl,
 * titul/Evropa, reputace) – strop je `MAX_DEV_POINTS`, takže jedna sezóna z průměrného
 * klubu top tým neudělá. Nevyužité body propadají (nepřenášejí se).
 */
/**
 * Přehled akumulovaného stavu klubu (síla vs liga, stadion, mládež) + co je trvalé a co
 * mezi sezónami regreduje. Čistě čte SeasonState – žádná nová data, jen viditelnost rozvoje.
 */
function ClubOverview({ state }: { state: SeasonState }) {
  const you = teamById(state.teams, state.yourTeamId);
  const n = state.teams.length || 1;
  const avgAttack = state.teams.reduce((s, t) => s + t.attack, 0) / n;
  const avgDefense = state.teams.reduce((s, t) => s + t.defense, 0) / n;
  const stadiumPct = Math.max(
    0,
    Math.min(1, (you.homeBoost - 1) / (HOME_BOOST_CAP - 1))
  );
  const stadiumMaxed = you.homeBoost >= HOME_BOOST_CAP - 1e-9;
  const youthPct = Math.max(0, Math.min(1, state.youth / DEV_YOUTH_MAX));

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">🏟️ Tvůj klub</span>
        <Stars n={leagueStars(you, state.teams)} />
      </div>

      {/* Síla útoku / obrany vs. ⌀ ligy */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <RatingCompare
          label="Útok"
          value={you.attack}
          leagueAvg={avgAttack}
          higherBetter
        />
        <RatingCompare
          label="Obrana"
          value={you.defense}
          leagueAvg={avgDefense}
          higherBetter={false}
        />
      </div>

      {/* Stadion (trvalý) + mládež */}
      <div className="mt-3 space-y-2">
        <DevMeter
          label="Stadion"
          pct={stadiumPct}
          right={stadiumMaxed ? "maximum" : "trvalé"}
          tone="positive"
        />
        <DevMeter
          label="Mládež"
          pct={youthPct}
          right={`${state.youth}/${DEV_YOUTH_MAX}`}
          tone="muted"
        />
      </div>

      <p className="mt-2 text-[10px] leading-tight text-muted">
        Stadion je <strong className="text-foreground">trvalý</strong> (neregreduje). Útok a
        obrana se mezi sezónami mírně vrací k průměru ligy — mládež ten propad tlumí.
      </p>
    </div>
  );
}

/** Hodnota metriky vs. ligový průměr (barevně dle toho, zda jsi nad/pod ⌀). */
function RatingCompare({
  label,
  value,
  leagueAvg,
  higherBetter,
}: {
  label: string;
  value: number;
  leagueAvg: number;
  higherBetter: boolean;
}) {
  const better = higherBetter ? value > leagueAvg : value < leagueAvg;
  const diff = value - leagueAvg;
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-lg font-bold tabular-nums text-foreground">
          {value.toFixed(2)}
        </span>
        <span
          className={
            "text-[10px] font-semibold " + (better ? "text-positive" : "text-negative")
          }
        >
          {diff >= 0 ? "+" : ""}
          {diff.toFixed(2)}
        </span>
      </div>
      <div className="text-[10px] text-muted">⌀ liga {leagueAvg.toFixed(2)}</div>
    </div>
  );
}

/** Progres-bar rozvojové oblasti (stadion / mládež). */
function DevMeter({
  label,
  pct,
  right,
  tone,
}: {
  label: string;
  pct: number;
  right: string;
  tone: "positive" | "muted";
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
        <div
          className={"bar-fill h-full rounded-full " + (tone === "positive" ? "bg-positive" : "bg-muted/60")}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="shrink-0 text-[10px] font-medium text-muted">{right}</span>
    </div>
  );
}

function DevelopmentPanel({
  points,
  spend,
  left,
  youth,
  homeBoost,
  onChange,
}: {
  points: number;
  spend: DevSpend;
  left: number;
  youth: number;
  homeBoost: number;
  onChange: (s: DevSpend) => void;
}) {
  if (points <= 0) {
    return (
      <p className="mt-3 rounded-xl border border-border bg-background/40 px-3 py-2 text-xs text-muted">
        Za tuhle sezónu nemáš žádné rozvojové body. Lepší umístění a splněný cíl je příště přinesou.
      </p>
    );
  }
  // Kolik bodů do stadionu má ještě smysl (`homeBoost` je stropovaný `HOME_BOOST_CAP`).
  const stadiumRoom = Math.max(
    0,
    Math.round((HOME_BOOST_CAP - homeBoost) / DEV_STADIUM_STEP)
  );

  const bump = (area: keyof DevSpend, delta: number) => {
    const next = { ...spend, [area]: Math.max(0, spend[area] + delta) };
    // Nepřekroč přidělený rozpočet.
    if (spendTotal(next) > points) return;
    // Mládež i stadion mají vlastní strop (kumulativní napříč sezónami) – bod nad strop
    // by se tiše ztratil (`applyDevelopment` ho ořízne), tak ho radši nejde ani přidat.
    if (area === "youth" && youth + next.youth > DEV_YOUTH_MAX) return;
    if (area === "stadium" && next.stadium > stadiumRoom) return;
    onChange(next);
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/40 p-3 text-left">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">🏗️ Rozvoj klubu</span>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
            (left > 0 ? "bg-warning/15 text-warning" : "bg-positive/15 text-positive")
          }
        >
          {left} / {points} bodů
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {DEV_AREAS.map((area) => {
          const atYouthCap = area === "youth" && youth + spend.youth >= DEV_YOUTH_MAX;
          const atStadiumCap = area === "stadium" && spend.stadium >= stadiumRoom;
          const atCap = atYouthCap || atStadiumCap;
          const hint = atYouthCap
            ? "Akademie na maximu"
            : atStadiumCap
              ? "Stadion na maximu"
              : DEV_AREA_HINT[area];
          return (
            <div key={area} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-foreground" title={DEV_AREA_HINT[area]}>
                {DEV_AREA_LABEL[area]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-muted">{hint}</span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Ubrat bod: ${DEV_AREA_LABEL[area]}`}
                  disabled={spend[area] === 0}
                  onClick={() => bump(area, -1)}
                  className="h-7 w-7 rounded-lg border border-border bg-surface text-sm font-bold text-muted transition hover:text-foreground disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm font-semibold tabular-nums text-foreground">
                  {spend[area]}
                </span>
                <button
                  type="button"
                  aria-label={`Přidat bod: ${DEV_AREA_LABEL[area]}`}
                  disabled={left === 0 || atCap}
                  onClick={() => bump(area, 1)}
                  className="h-7 w-7 rounded-lg border border-border bg-surface text-sm font-bold text-muted transition hover:text-foreground disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted">
        {left > 0
          ? "Nerozdělené body propadají. Při změně týmu se ztrácí i akademie — patří klubu."
          : "Investice se projeví hned v příští sezóně."}
      </p>
    </div>
  );
}

function SeasonDone({
  save,
  onContinue,
  onSwitch,
  onError,
}: {
  save: SaveState;
  onContinue: (spend: DevSpend) => void;
  onSwitch: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number,
    leagueAccess: LeagueAccess | null,
    youth?: number
  ) => void;
  onError: (e: string | null) => void;
}) {
  const [jobs, setJobs] = useState(false);
  const [moving, setMoving] = useState(false);
  const [spend, setSpend] = useState<DevSpend>(EMPTY_SPEND);
  const s = save.current;
  if (!s) return null;
  const summary = summarizeSeason(s);
  const projectedRep = updateReputation(save.manager.reputation, summary);
  const repDelta = projectedRep - Math.round(save.manager.reputation);
  const champ = teamById(s.teams, summary.championId);
  const tone = seasonTone(summary);
  const transition = nextTransition(summary, s.leagueId);
  // Rozvojové body za sezónu (vč. bonusů/malusů z eventů).
  const devPoints = developmentPoints(summary, projectedRep, s.teams.length, s.devBonus);
  const left = devPoints - spendTotal(spend);

  // Přechod do vyšší/nižší ligy: dotáhni cílovou ligu a vlož svůj klub, pak spusť sezónu.
  // Klub jde s tebou → investice i mládež se přenesou (na rozdíl od „Změnit tým").
  async function moveTo(targetId: number, targetName: string) {
    if (!s) return;
    setMoving(true);
    onError(null);
    try {
      const { teams, leagueAccess } = await fetchGameLeagueTeams(targetId);
      // Investice se počítá vůči LIZE, ve které jsi ji vydělal (strop `DEV_LEAGUE_CEILING`).
      const developed = applyDevelopment(teamById(s.teams, s.yourTeamId), spend, s.teams);
      const roster = injectYourTeam(teams, developed);
      onSwitch(targetId, targetName, roster, s.yourTeamId, leagueAccess, nextYouth(s.youth, spend));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Nepodařilo se načíst ligu.");
      setMoving(false);
    }
  }
  // Náhled nově odemčených achievementů (shodné s tím, co uloží finishAndAdvance).
  const folded = foldSeason(save.profile, summary, projectedRep);
  const earned = newlyEarned(
    save.profile.achievements.map((a) => a.id),
    { allTime: folded.allTime, last: summary, reputation: projectedRep }
  );

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
          {summary.promoted
            ? "🔼"
            : summary.champion
              ? "🏆"
              : summary.relegated
                ? "⚠️"
                : "🏁"}
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
        {earned.length > 0 && (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <div className="text-xs font-semibold text-warning">🏅 Odemčeno</div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {earned.map((a) => (
                <span
                  key={a.id}
                  className="flex items-center gap-1 rounded-full border border-warning/40 bg-surface px-2 py-1 text-[11px] font-medium text-foreground"
                  title={a.desc}
                >
                  <span aria-hidden>{a.icon}</span>
                  {a.title}
                </span>
              ))}
            </div>
          </div>
        )}
        {/* Rozvoj klubu – body dle výsledku sezóny. Po vyhazovu nemá kam jít. */}
        {transition.type !== "sacked" && (
          <DevelopmentPanel
            points={devPoints}
            spend={spend}
            left={left}
            youth={s.youth}
            homeBoost={teamById(s.teams, s.yourTeamId).homeBoost}
            onChange={setSpend}
          />
        )}
        {transition.type === "sacked" && (
          <p className="mt-3 rounded-xl border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
            Vedení tě po sestupu odvolalo. Najdi si nový klub — se sníženou reputací tě vezmou
            spíš menší týmy.
          </p>
        )}
        {transition.type === "down" && (
          <p className="mt-3 text-xs text-muted">
            Klub sestupuje do druhé ligy. Můžeš ho vzít i o patro níž a zabojovat o postup,
            nebo přijmout jinou nabídku.
          </p>
        )}
        {transition.type === "up" && (
          <p className="mt-3 text-xs text-positive">
            Postup! Klub se vrací do nejvyšší soutěže.
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {transition.type === "sacked" ? (
            <button
              type="button"
              onClick={() => setJobs(true)}
              className="rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Najít nový klub →
            </button>
          ) : (
            <>
              {transition.type === "stay" && (
                <button
                  type="button"
                  onClick={() => onContinue(spend)}
                  className="rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Pokračovat s klubem →
                </button>
              )}
              {transition.type === "up" && (
                <button
                  type="button"
                  disabled={moving}
                  onClick={() => moveTo(transition.leagueId, transition.leagueName)}
                  className="rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {moving ? "Načítá se…" : `Postup! Hrát ${transition.leagueName} →`}
                </button>
              )}
              {transition.type === "down" && (
                <button
                  type="button"
                  disabled={moving}
                  onClick={() => moveTo(transition.leagueId, transition.leagueName)}
                  className="rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {moving ? "Načítá se…" : `Hrát 2. ligu (${transition.leagueName}) →`}
                </button>
              )}
              <button
                type="button"
                disabled={moving}
                onClick={() => setJobs(true)}
                className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-50"
              >
                Změnit tým
              </button>
            </>
          )}
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
    teamId: number,
    leagueAccess: LeagueAccess | null
  ) => void;
  onClose: () => void;
  onError: (e: string | null) => void;
}) {
  const { leagues, league, teams, leagueAccess, loadingTeams, pickLeague, backToLeagues } =
    useLeaguePicker(onError);

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
        <LeagueList leagues={leagues} onPick={pickLeague} />
      ) : loadingTeams || !teams ? (
        <LoadingRows />
      ) : (
        <div className="mt-3">
          <button
            type="button"
            onClick={backToLeagues}
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
                    onClick={() => onPick(league.id, league.name, teams, t.id, leagueAccess)}
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
                      <Stars n={leagueStars(t, teams)} />
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

/**
 * Reputační zisk/ztráta za každou sezónu = přehrání od STARTING_REPUTATION
 * (deterministické, shodné s tím, jak reputace reálně narůstala během kariéry).
 */
function reputationDeltas(history: SeasonSummary[]): number[] {
  let rep = STARTING_REPUTATION;
  return history.map((h) => {
    const after = updateReputation(rep, h);
    const d = after - rep;
    rep = after;
    return d;
  });
}

function HistoryView({ save }: { save: SaveState }) {
  const stats = careerStats(save.history);
  const repDeltas = reputationDeltas(save.history);
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
        <StatTile label="Postupy" value={stats.promotions} />
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
        <StatTile label="Ø PPG" value={stats.avgPPG.toFixed(2)} />
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
          const delta = repDeltas[save.history.length - 1 - i];
          return (
            <div
              key={`${h.season}-${h.leagueId}-${h.yourTeamId}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="w-8 shrink-0 text-xs text-muted">S{h.season}</span>
              <span className="w-7 shrink-0 text-xs text-muted">{h.yourRank}.</span>
              {/* Klub jen logem – název je v title/alt, řádek zůstane úzký i na mobilu. */}
              <span className="shrink-0" title={h.yourName}>
                <TeamLogo src={h.yourLogo} alt={h.yourName} size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{h.leagueName}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted" title="Body na zápas">
                {(h.yourPoints / (h.win + h.draw + h.loss)).toFixed(2)} PPG
              </span>
              <RepDelta delta={delta} />
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

/** Reputační zisk/ztráta za sezónu (barevný odznak). */
function RepDelta({ delta }: { delta: number }) {
  const cls =
    delta > 0
      ? "bg-positive/15 text-positive"
      : delta < 0
        ? "bg-negative/15 text-negative"
        : "bg-border/60 text-muted";
  return (
    <span
      className={"shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums " + cls}
      title="Změna reputace za sezónu"
    >
      {delta > 0 ? "+" : ""}
      {delta}
    </span>
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

// ───────────────────────── reprezentační turnaj ─────────────────────────

function TournamentView({
  save,
  run,
  busy,
  onPlayRound,
  onSimulateToEnd,
  onPlan,
  onInstruction,
  onEventChoice,
  onFinish,
  onReset,
}: {
  save: SaveState;
  managerName: string | null;
  run: TournamentRun;
  busy: boolean;
  onPlayRound: () => void;
  onSimulateToEnd: () => void;
  onPlan: (p: Plan) => void;
  onInstruction: (i: Instruction) => void;
  onEventChoice: (choiceIndex: number) => void;
  onFinish: () => void;
  onReset: () => void;
}) {
  const comp = COMPETITIONS[run.competitionId];
  const over = isRunOver(run);
  const active = run.phase === "qualification" ? run.qualification : run.tournament;
  const pendingEvent = active?.pendingEvent ?? null;
  // Vypadl jsi v pavouku, ale turnaj ještě běží (dohrává se, aby byl znám mistr).
  const eliminated = run.phase === "final" && Boolean(run.tournament?.eliminated);
  const phaseLabel =
    run.phase === "qualification"
      ? "Kvalifikace"
      : run.phase === "final" && run.tournament
        ? STAGE_LABEL[run.tournament.yourStage]
        : "Konec";

  return (
    <div className="mt-5">
      {/* pruh: národ + soutěž + fáze + reset */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TeamLogo src={run.yourLogo} alt={run.yourName} size={30} />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-foreground">{run.yourName}</div>
            <div className="text-xs text-muted">
              {comp.emoji} {comp.name} · {phaseLabel}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-negative"
        >
          Nová kariéra
        </button>
      </div>

      {over ? (
        <TournamentDone run={run} save={save} onFinish={onFinish} />
      ) : eliminated ? (
        <>
          <div className="mt-4 rounded-2xl border border-negative/40 bg-negative/10 p-4 text-center text-sm text-negative">
            Tvůj tým vypadl. Turnaj se dohraje, aby byl znám mistr.
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onSimulateToEnd}
            className="mt-3 w-full rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Simuluje se…" : "Dohrát turnaj do konce"}
          </button>
          <TournamentBracket run={run} />
        </>
      ) : (
        <>
          {pendingEvent && <EventCard event={pendingEvent} onChoice={onEventChoice} />}
          <TournamentNextMatch run={run} onPlan={onPlan} onInstruction={onInstruction} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy || Boolean(pendingEvent)}
              onClick={onPlayRound}
              title={pendingEvent ? "Nejdřív vyřeš událost výše" : undefined}
              className="flex-1 rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Simuluje se…" : "Odehrát zápas"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSimulateToEnd}
              className="rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition hover:text-foreground disabled:opacity-50"
            >
              {busy ? "Simuluje se…" : "Dohrát turnaj"}
            </button>
          </div>
          {run.phase === "qualification" ? (
            <QualTable run={run} />
          ) : (
            <TournamentBracket run={run} />
          )}
        </>
      )}
    </div>
  );
}

/** Náhled nejbližšího zápasu turnaje/kvalifikace + agency (obdoba `NextMatch`). */
function TournamentNextMatch({
  run,
  onPlan,
  onInstruction,
}: {
  run: TournamentRun;
  onPlan: (p: Plan) => void;
  onInstruction: (i: Instruction) => void;
}) {
  const preview = runPreview(run);
  const active = run.phase === "qualification" ? run.qualification : run.tournament;
  if (!preview || !active) return null;
  const { you, opponent, isHome, probs } = preview;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        Nejbližší zápas{" "}
        {preview.neutral
          ? "(neutrální půda)"
          : isHome
            ? "(doma)"
            : "(venku)"}
      </div>
      <div className="mt-2 flex items-center justify-center gap-3">
        <TeamBadge team={isHome ? you : opponent} size={30} />
        <span className="max-w-[35%] truncate text-sm font-medium text-foreground">
          {isHome ? you.name : opponent.name}
        </span>
        <span className="text-xs text-muted">vs</span>
        <span className="max-w-[35%] truncate text-sm font-medium text-foreground">
          {isHome ? opponent.name : you.name}
        </span>
        <TeamBadge team={isHome ? opponent : you} size={30} />
      </div>

      <div className="mt-3">
        <div className="mb-1 text-center text-xs text-muted">Predikce modelu</div>
        <div className="flex items-center justify-between text-sm font-bold tabular-nums">
          <span className="text-home">{Math.round(probs.homeWin * 100)} %</span>
          <span className="text-muted">{Math.round(probs.draw * 100)} %</span>
          <span className="text-away">{Math.round(probs.awayWin * 100)} %</span>
        </div>
        <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-border/60">
          <div className="bar-fill bg-home/80" style={{ width: `${probs.homeWin * 100}%` }} />
          <div className="bar-fill bg-muted/50" style={{ width: `${probs.draw * 100}%` }} />
          <div className="bar-fill bg-away/80" style={{ width: `${probs.awayWin * 100}%` }} />
        </div>
      </div>

      <ScoutCard scout={preview.scout} oppName={opponent.name} />
      <MoraleBar morale={active.morale} />
      <FitnessBar fitness={active.fitness} plan={active.plan} />
      <ActiveModifiers state={{ modifiers: active.modifiers, round: active.round }} />

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-foreground">Zápasový plán</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {PLANS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={active.plan === p}
              onClick={() => onPlan(p)}
              className={
                "rounded-lg px-2 py-1.5 text-xs font-medium transition " +
                (active.plan === p
                  ? "bg-foreground text-background"
                  : "border border-border bg-surface text-muted hover:text-foreground")
              }
            >
              {PLAN_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted">{PLAN_HINT[active.plan]}</p>
        <InstructionPicker value={active.instruction} onPick={onInstruction} disabled={false} />
      </div>
    </div>
  );
}

/** Kvalifikační tabulka skupiny hráče (zvýrazní postupovou zónu + tvůj tým). */
function QualTable({ run }: { run: TournamentRun }) {
  const qs = run.qualification;
  const table = qualTable(qs);
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-foreground">Kvalifikační skupina</h3>
      <p className="mt-0.5 text-[11px] text-muted">
        Postupuje prvních {QUAL_ADVANCE} na závěrečný turnaj.
      </p>
      <MiniTable
        rows={table.map((r) => ({
          teamId: r.teamId,
          name: teamById(qs.teams, r.teamId).name,
          played: r.played,
          gd: r.goalsDiff,
          points: r.points,
        }))}
        yourId={run.yourTeamId}
        qualifyTop={QUAL_ADVANCE}
      />
    </div>
  );
}

/** Skupinová tabulka + tvoje cesta pavoukem v závěrečném turnaji. */
function TournamentBracket({ run }: { run: TournamentRun }) {
  const t = run.tournament;
  if (!t) return null;
  const format = COMPETITIONS[run.competitionId].format;

  // Skupinová fáze → tvoje skupina; pak už jen cesta pavoukem.
  const gi = groupIndexOf(t, run.yourTeamId);
  const showGroup = gi >= 0;
  const groupRows =
    showGroup && t.stage !== "done"
      ? groupTableOf(t, gi).map((r) => ({
          teamId: r.teamId,
          name: teamById(t.teams, r.teamId).name,
          played: r.played,
          gd: r.goalsDiff,
          points: r.points,
        }))
      : [];

  // Tvoje vyřazovací zápasy (odehrané) + nejbližší dvojice.
  const yourKo = t.knockout.filter(
    (k) => k.homeId === run.yourTeamId || k.awayId === run.yourTeamId
  );

  return (
    <div className="mt-4 space-y-4">
      {groupRows.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-foreground">
            Skupina · postupují {format.advancePerGroup}
          </h3>
          <MiniTable rows={groupRows} yourId={run.yourTeamId} qualifyTop={format.advancePerGroup} />
        </div>
      )}
      {yourKo.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-foreground">Tvoje cesta pavoukem</h3>
          <div className="mt-2 space-y-1.5">
            {yourKo.map((k, i) => {
              const isHome = k.homeId === run.yourTeamId;
              const oppId = isHome ? k.awayId : k.homeId;
              const yourGoals = isHome ? k.homeGoals : k.awayGoals;
              const oppGoals = isHome ? k.awayGoals : k.homeGoals;
              const won = k.winnerId === run.yourTeamId;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                >
                  <span className="w-24 shrink-0 text-[11px] text-muted">
                    {STAGE_LABEL[k.stage]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {teamById(t.teams, oppId).name}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-foreground">
                    {yourGoals}:{oppGoals}
                    {k.penalties && (
                      <span className="ml-1 text-[10px] text-muted">
                        pen {k.penalties[isHome ? 0 : 1]}:{k.penalties[isHome ? 1 : 0]}
                      </span>
                    )}
                  </span>
                  <span
                    className={
                      "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold " +
                      (won ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative")
                    }
                  >
                    {won ? "✓" : "✗"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Kompaktní tabulka (kvalifikace / skupina): zvýrazní postupovou zónu a tvůj tým. */
function MiniTable({
  rows,
  yourId,
  qualifyTop,
}: {
  rows: { teamId: number; name: string; played: number; gd: number; points: number }[];
  yourId: number;
  qualifyTop: number;
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface text-[11px] uppercase tracking-wide text-muted">
            <th className="px-2 py-1.5 text-left font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">Tým</th>
            <th className="px-2 py-1.5 text-center font-medium">Z</th>
            <th className="px-2 py-1.5 text-center font-medium">R</th>
            <th className="px-2 py-1.5 text-center font-medium">B</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const you = r.teamId === yourId;
            const qualifies = i < qualifyTop;
            return (
              <tr
                key={r.teamId}
                className={
                  "border-t border-border " +
                  (you ? "bg-foreground/10 font-semibold" : i % 2 ? "bg-surface/40" : "")
                }
              >
                <td className="px-2 py-1.5">
                  <span
                    className={
                      "inline-block h-1.5 w-1.5 rounded-full " +
                      (qualifies ? "bg-positive" : "bg-transparent")
                    }
                  />{" "}
                  {i + 1}
                </td>
                <td className="px-2 py-1.5 text-foreground">
                  {r.name}
                  {you && <span className="ml-1 text-[10px] text-muted">(ty)</span>}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted">{r.played}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted">
                  {r.gd > 0 ? "+" : ""}
                  {r.gd}
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums font-semibold text-foreground">
                  {r.points}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Konec reprezentačního běhu: výsledek + reputace + odemčené achievementy. */
function TournamentDone({
  run,
  save,
  onFinish,
}: {
  run: TournamentRun;
  save: SaveState;
  onFinish: () => void;
}) {
  const summary = summarizeRun(run);
  const projectedRep = updateReputationTournament(save.manager.reputation, summary);
  const repDelta = projectedRep - Math.round(save.manager.reputation);
  const folded = foldTournament(save.profile, summary);
  const earned = newlyEarnedTournament(save.profile.achievements.map((a) => a.id), {
    allTime: folded.allTime,
    last: summary,
    reputation: projectedRep,
  });

  const stage = stageReachedOf(run) as Stage;
  const good = summary.champion || summary.stageReached === "final" || summary.stageReached === "sf";
  const headline = summary.champion
    ? "Mistr! 🏆"
    : !summary.qualified
      ? "Neúspěšná kvalifikace"
      : summary.stageReached === "final"
        ? "Finalista 🥈"
        : `Konec ve fázi: ${STAGE_LABEL[stage]}`;
  const emoji = summary.champion ? "🏆" : !summary.qualified ? "⚠️" : good ? "🎉" : "🏁";
  const toneClass = summary.champion || good ? "text-positive" : !summary.qualified ? "text-negative" : "text-foreground";

  return (
    <div className="mt-4">
      <div className="rounded-2xl border border-border bg-surface p-5 text-center shadow-sm">
        <p className="text-3xl">{emoji}</p>
        <p className="mt-2 text-sm font-semibold text-foreground">
          {COMPETITIONS[run.competitionId].name} · {run.yourName}
        </p>
        <p className={"mt-1 text-base font-bold " + toneClass}>{headline}</p>
        <p className="mt-1 text-sm text-muted">
          {summary.win}-{summary.draw}-{summary.loss} · {summary.goalsFor}:{summary.goalsAgainst} ·{" "}
          {summary.played} zápasů
        </p>
        <p className="mt-2 text-xs">
          Reputace{" "}
          <strong className={repDelta >= 0 ? "text-positive" : "text-negative"}>
            {repDelta >= 0 ? "+" : ""}
            {repDelta}
          </strong>{" "}
          → {projectedRep}
        </p>
        {earned.length > 0 && (
          <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <div className="text-xs font-semibold text-warning">🏅 Odemčeno</div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {earned.map((a) => (
                <span
                  key={a.id}
                  className="flex items-center gap-1 rounded-full border border-warning/40 bg-surface px-2 py-1 text-[11px] font-medium text-foreground"
                  title={a.desc}
                >
                  <span aria-hidden>{a.icon}</span>
                  {a.title}
                </span>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onFinish}
          className="mt-4 rounded-full bg-positive px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Dokončit →
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── manažerský profil / hub ─────────────────────────

/** Vstupní rozcestník bez aktivní kariéry: profil + volba režimu (klub / reprezentace). */
function ManagerHub({
  save,
  managerName,
  onStart,
  onStartTournament,
  onError,
}: {
  save: SaveState | null;
  managerName: string | null;
  onStart: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number,
    leagueAccess: LeagueAccess | null
  ) => void;
  onStartTournament: (competitionId: CompetitionId, teamId: number) => void;
  onError: (e: string | null) => void;
}) {
  const [mode, setMode] = useState<null | "club" | "nation">(null);
  const profile = save?.profile ?? emptyProfile();
  // Reputace se sdílí napříč turnaji (buduje se); bez ní start na základní reputaci.
  const reputation = save?.manager.reputation ?? STARTING_REPUTATION;

  if (mode === "club") {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setMode(null)}
          className="text-xs text-muted hover:text-foreground"
        >
          ← Zpět na profil
        </button>
        <NewGameFlow onStart={onStart} onError={onError} />
      </div>
    );
  }

  if (mode === "nation") {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setMode(null)}
          className="text-xs text-muted hover:text-foreground"
        >
          ← Zpět na profil
        </button>
        <NationPicker reputation={reputation} onStart={onStartTournament} />
      </div>
    );
  }

  return (
    <div>
      <ProfilePanel
        profile={profile}
        reputation={null}
        managerName={managerName}
        activeCareer={false}
      />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("club")}
          className="rounded-2xl border border-border bg-surface px-4 py-4 text-left shadow-sm transition hover:border-foreground/30"
        >
          <div className="text-sm font-semibold text-foreground">🏟️ Klubová kariéra</div>
          <div className="mt-0.5 text-[11px] text-muted">
            Veď reálný klub ligou i napříč sezónami (postup, sestup, job market).
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMode("nation")}
          className="rounded-2xl border border-border bg-surface px-4 py-4 text-left shadow-sm transition hover:border-foreground/30"
        >
          <div className="text-sm font-semibold text-foreground">🌐 Reprezentace</div>
          <div className="mt-0.5 text-[11px] text-muted">
            Proveď národ kvalifikací až na Euro nebo mistrovství světa.
          </div>
        </button>
      </div>
    </div>
  );
}

/** Výběr soutěže + reprezentace (gated reputací, jako job market u klubů). */
function NationPicker({
  reputation,
  onStart,
}: {
  reputation: number;
  onStart: (competitionId: CompetitionId, teamId: number) => void;
}) {
  const [competition, setCompetition] = useState<CompetitionId>("EURO");
  const comp = COMPETITIONS[competition];
  // U Eura dává smysl vybírat jen z UEFA (jinak by národ neměl kvalifikaci); u MS všechny.
  const options = nationOptions(reputation).filter(
    (o) => competition === "WC" || o.confed === "UEFA"
  );

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-foreground">Vyber soutěž</h2>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(Object.keys(COMPETITIONS) as CompetitionId[]).map((id) => {
          const c = COMPETITIONS[id];
          const active = competition === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setCompetition(id)}
              className={
                "rounded-xl border px-3 py-2.5 text-left transition " +
                (active
                  ? "border-foreground/40 bg-foreground/10"
                  : "border-border bg-surface hover:border-foreground/30")
              }
            >
              <div className="text-sm font-semibold text-foreground">
                {c.emoji} {c.name}
              </div>
              <div className="text-[11px] text-muted">
                {c.format.groups * c.format.groupSize} týmů
              </div>
            </button>
          );
        })}
      </div>

      <h2 className="mt-4 text-sm font-semibold text-foreground">
        Vyber reprezentaci — {comp.name}
      </h2>
      <p className="mt-1 text-xs text-muted">
        Zvučnější národy tě vezmou jen s dost vysokou reputací (aktuálně {reputation}). Buduj ji
        úspěchy na turnajích. Pořadatel se kvalifikuje automaticky.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const isHost = o.id === comp.hostId;
          return (
            <button
              key={o.id}
              type="button"
              disabled={!o.hireable}
              onClick={() => onStart(competition, o.id)}
              className={
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left shadow-sm transition " +
                (o.hireable
                  ? "border-border bg-surface hover:border-foreground/30"
                  : "border-border/60 bg-surface/40 opacity-60")
              }
            >
              <TeamLogo src={o.logo} alt={o.name} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {o.name}
                  {isHost && <span className="ml-1 text-[10px] text-positive">pořadatel</span>}
                </span>
                <span className="text-[11px] text-muted">prestiž {o.prestige}</span>
              </span>
              {!o.hireable && (
                <span className="shrink-0 text-[11px] text-negative">🔒 mimo dosah</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Manažerský profil: hlavička + kariérní rekordy + klub/repre + achievementy. */
function ProfilePanel({
  profile,
  reputation,
  managerName,
  activeCareer,
}: {
  profile: ManagerProfile;
  reputation: number | null;
  managerName: string | null;
  activeCareer: boolean;
}) {
  const a = profile.allTime;
  const rep = reputation != null ? Math.round(reputation) : null;
  return (
    <div className="mt-3 space-y-4">
      {/* Hlavička */}
      <div className="rounded-xl border border-border bg-surface px-3 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-foreground">
              👔 {managerName || "Trenér"}
            </div>
            <div className="text-xs text-muted">
              {activeCareer && rep != null
                ? `${repTier(rep)} · reputace ${rep}/100`
                : "Bez aktivní kariéry"}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-bold tabular-nums text-warning">{a.titles}</div>
            <div className="text-[10px] text-muted">titulů celkem</div>
          </div>
        </div>
        {activeCareer && rep != null && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted">Reputace</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60">
              <div
                className="bar-fill h-full rounded-full bg-positive"
                style={{ width: `${rep}%` }}
              />
            </div>
            <span className="tabular-nums font-semibold text-foreground">{rep}/100</span>
          </div>
        )}
      </div>

      {/* Kariérní rekordy */}
      <div>
        <h3 className="text-xs font-semibold text-foreground">Kariérní rekordy</h3>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          <StatTile label="Kariér" value={a.careers} />
          <StatTile label="Sezón" value={a.seasons} />
          <StatTile label="Titulů" value={a.titles} accent={a.titles > 0} />
          <StatTile label="Evr. účastí" value={a.europeanQualifs} />
          <StatTile label="Sestupy" value={a.relegations} />
          <StatTile label="Nejlepší" value={a.bestRank ? `${a.bestRank}.` : "—"} />
          <StatTile label="Max bodů" value={a.bestSeasonPoints || "—"} />
          <StatTile label="Max gólů" value={a.mostGoalsSeason || "—"} />
          <StatTile label="Max reputace" value={a.bestReputation || "—"} />
          <StatTile label="Neporažen" value={a.invincibleSeasons} />
        </div>
      </div>

      {/* Klubová vs reprezentační scéna */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs font-semibold text-foreground">🏟️ Klubová scéna</div>
          <p className="mt-1 text-[11px] text-muted">
            {a.seasons > 0
              ? `${a.titles} titulů · ${a.europeanQualifs}× Evropa · ${a.relegations} sestupů`
              : "Zatím žádná odehraná sezóna."}
          </p>
          {a.leaguesCoached.length > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              Ligy: {a.leaguesCoached.map((id) => leagueNameFor(id)).join(", ")}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
          <div className="text-xs font-semibold text-foreground">🌐 Reprezentační scéna</div>
          <p className="mt-1 text-[11px] text-muted">
            {(a.tournamentsPlayed ?? 0) > 0
              ? `${a.majorTitles ?? 0}× velký titul · ${a.finalsReached ?? 0}× finále · ${
                  a.tournamentsPlayed ?? 0
                } turnajů`
              : "Zatím žádný reprezentační turnaj."}
          </p>
          {(a.nationsCoached?.length ?? 0) > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              Vedeno reprezentací: {a.nationsCoached!.length}
            </p>
          )}
        </div>
      </div>

      {/* Achievementy */}
      <AchievementsGrid earned={profile.achievements} />
    </div>
  );
}

function tierClass(tier: AchievementTier): string {
  return tier === "gold"
    ? "border-warning/50 bg-warning/10"
    : tier === "silver"
      ? "border-border bg-surface"
      : "border-away/40 bg-away/10"; // bronze
}

/** Mřížka achievementů: odemčené barevně dle tier, zamčené šedé s popisem. */
function AchievementsGrid({ earned }: { earned: EarnedAchievement[] }) {
  const owned = new Set(earned.map((e) => e.id));
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">Achievementy</h3>
        <span className="text-[11px] text-muted">
          {owned.size}/{ALL_ACHIEVEMENTS.length}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ALL_ACHIEVEMENTS.map((ach) => {
          const has = owned.has(ach.id);
          return (
            <div
              key={ach.id}
              title={ach.desc}
              className={
                "rounded-xl border p-2.5 " +
                (has
                  ? tierClass(ach.tier)
                  : "border-dashed border-border bg-surface/40 opacity-70")
              }
            >
              <div className="flex items-center gap-1.5">
                <span className={"text-lg " + (has ? "" : "grayscale")} aria-hidden>
                  {has ? ach.icon : "🔒"}
                </span>
                <span
                  className={
                    "text-xs font-semibold " + (has ? "text-foreground" : "text-muted")
                  }
                >
                  {ach.title}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-tight text-muted">{ach.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
