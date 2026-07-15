"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { TeamLogo } from "./TeamLogo";
import type { SessionUser } from "./sessionUser";
import { HistoryView, ManagerHub, NationPicker, ProfilePanel } from "./hra/Profile";
import { shareOrCopy } from "./share";
import { teamById, injectYourTeam } from "@/lib/game/teams";
import { randomSeed } from "@/lib/game/rng";
import {
  CLUB_CUP_FORMAT,
  CLUB_CUP_NAME,
  clubQualifies,
  cupPreview,
  isCupRunOver,
  playCupRunRound,
  setCupInstruction,
  setCupPlan,
  simulateCupRunToEnd,
  startCupRun,
  summarizeCupRun,
} from "@/lib/game/clubCup";
import type { CupRun } from "@/lib/game/clubCup";
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
import { summarizeSeason, startNextSeason } from "@/lib/game/career";
import { updateReputation, isHireable } from "@/lib/game/reputation";
import {
  teamPrestige,
  seasonHeadline,
  seasonTone,
  leagueStars,
  evaluateSeason,
  nextTransition,
  EUROPE_LABEL,
} from "@/lib/game/leagues";
import { PLANS, PLAN_LABEL, PLAN_HINT } from "@/lib/game/plans";
import {
  INSTRUCTIONS,
  INSTRUCTION_HINT,
  INSTRUCTION_LABEL,
} from "@/lib/game/instructions";
import { getEvent, applyEventChoice, describeEffect } from "@/lib/game/events";
import { fitnessDelta, fitnessLabel } from "@/lib/game/fitness";
import {
  DEV_AREA_HINT,
  DEV_AREA_LABEL,
  EMPTY_SPEND,
  applyDevelopment,
  developmentPoints,
  nextScouting,
  nextYouth,
  spendTotal,
} from "@/lib/game/development";
import type { DevSpend } from "@/lib/game/development";
import { leagueGoalsPerTeamGame, teamSeasonStats, venueStats } from "@/lib/game/analysis";
import { STYLE_LABEL } from "@/lib/game/scouting";
import type { ScoutReport } from "@/lib/game/scouting";
import type { OppStyle } from "@/lib/game/types";
import { emptyProfile, startCareer, foldSeason, foldTournament, foldCup } from "@/lib/game/profile";
import { newlyEarned, newlyEarnedTournament, newlyEarnedCup } from "@/lib/game/achievements";
import { updateReputationTournament, updateReputationCup } from "@/lib/game/reputation";
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
  STAGE_LABEL,
} from "@/lib/game/nationalCompetitions";
import type { CompetitionId, TournamentRun } from "@/lib/game/nationalCompetitions";
import { groupIndexOf, groupTableOf } from "@/lib/game/tournament";
import type { Stage, TournamentFormat, TournamentState } from "@/lib/game/tournament";
import { SAVE_VERSION } from "@/lib/game/types";
import {
  DEV_STADIUM_STEP,
  DEV_YOUTH_MAX,
  HOME_BOOST_CAP,
  QUAL_ADVANCE,
  SCOUT_LEVEL_MAX,
  STARTING_FITNESS,
  STARTING_REPUTATION,
} from "@/lib/game/balance";
import type {
  GameTeam,
  Instruction,
  LeagueAccess,
  LeagueInfo,
  ManagerProfile,
  Plan,
  SaveState,
  SeasonState,
} from "@/lib/game/types";

type GameView = "season" | "history" | "profile" | "cup";

const NAV = [
  { href: "/", label: "Zápasy", emoji: "📅" },
  { href: "/predikce", label: "Tipy", emoji: "📈" },
  { href: "/tipovacka", label: "Tipovačka", emoji: "🎲" },
  { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
  { href: "/tabulky", label: "Tabulky", emoji: "📊" },
];

/** Data pro popup výsledku po odehraném kole. */
interface ToastData {
  oppName: string;
  yourGoals: number;
  oppGoals: number;
  /** Změna morálky za tento zápas (±), aby efekt výsledku nebyl jen tichá aktualizace baru. */
  moraleDelta: number;
}

/** Data pro potvrzovací dialog destruktivní akce (náhrada za nativní `confirm()`). */
interface ConfirmDialogData {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
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
  // Migrace se řetězí (5 → 6 → 7 → 8 → 9 → 10), ať starý save nezůstane viset na mezikroku.
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
  if (save.version === 8) {
    // v9 přidal skauting jako 5. rozvojovou oblast (kumulativní investice klubu).
    save = {
      ...save,
      version: 9,
      current: save.current ? { ...save.current, scouting: 0 } : null,
    };
  }
  if (save.version === 9) {
    // v10 přidal klubový pohár (paralelní k reprezentačnímu turnaji) – čistě aditivní.
    save = { ...save, version: 10, cup: save.cup ?? null, cupHistory: save.cupHistory ?? [] };
  }
  if (save.version === SAVE_VERSION) return save;
  return null;
}

export function HraApp({ user }: { user: SessionUser | null }) {
  const [loading, setLoading] = useState(Boolean(user));
  const [save, setSave] = useState<SaveState | null>(null);
  const [view, setView] = useState<GameView>("season");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  /** Roste s každým novým výsledkem → `key` remountuje toast (odhalení začne od zapečetěno). */
  const [toastSeq, setToastSeq] = useState(0);
  const showToast = useCallback((d: ToastData) => {
    setToast(d);
    setToastSeq((n) => n + 1);
  }, []);
  const [hasUnseenAchievement, setHasUnseenAchievement] = useState(false);
  /** Který režim se zobrazuje, když běží klub i reprezentace paralelně. */
  const [careerMode, setCareerMode] = useState<"club" | "nation">("club");
  /** Overlay výběru nového týmu (klub / reprezentace) – i s aktivní druhou kariérou. */
  const [picking, setPicking] = useState<null | "club" | "nation">(null);
  /** Stav, který se nepodařilo uložit na server – zůstává, dokud "Zkusit znovu" neuspěje. */
  const [saveError, setSaveError] = useState<SaveState | null>(null);

  /**
   * Fronta pro ukládání: nejvýš jeden PUT rozjetý najednou, vždy se posílá jen
   * nejnovější stav. Bez tohohle by rychlé po sobě jdoucí akce (dvojklik, dva
   * otevřené taby) mohly poslat dva požadavky souběžně a starší odpověď by mohla
   * dorazit později a tiše přepsat novější rozehraný stav v DB.
   */
  const pendingSaveRef = useRef<SaveState | null>(null);
  const savingRef = useRef(false);

  const flushSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    // Smyčka (ne rekurze): dokud mezitím dorazí novější stav, pošli i ten – vždy
    // nejvýš jeden PUT rozjetý najednou, žádné souběžné/přeskakující se požadavky.
    while (pendingSaveRef.current) {
      const state = pendingSaveRef.current;
      pendingSaveRef.current = null;
      const ok = await saveEndpoint(state);
      setSaveError(ok ? null : state);
    }
    savingRef.current = false;
  }, []);

  const trackSave = useCallback(
    (next: SaveState) => {
      pendingSaveRef.current = next;
      void flushSave();
    },
    [flushSave]
  );

  const retrySave = useCallback(() => {
    if (saveError) trackSave(saveError);
  }, [saveError, trackSave]);

  /** Náhrada za nativní `confirm()` u destruktivních akcí – konzistentní vzhled s toastem. */
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogData | null>(null);

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
          // Reputace se SDÍLÍ (buduje se napříč klubem i reprezentací); převzetí klubu ji
          // neresetuje. Gate výběru řeší strop reputace dle prestiže (REP_CEILING_MARGIN).
          manager: { reputation: prev?.manager.reputation ?? STARTING_REPUTATION },
          current,
          history: [],
          // Paralelní reprezentační běh zůstává (invariant XOR zrušen).
          tournament: prev?.tournament ?? null,
          tournamentHistory: prev?.tournamentHistory ?? [],
          // Nová klubová kariéra = žádný rozjetý pohár (patřil starému klubu); síň slávy zůstává.
          cup: null,
          cupHistory: prev?.cupHistory ?? [],
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

  const mutateCup = useCallback((fn: (r: CupRun) => CupRun) => {
    setSave((prev) => {
      if (!prev || !prev.cup) return prev;
      const next = { ...prev, cup: fn(prev.cup) };
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
          // Klubová kariéra zůstává (invariant XOR zrušen) – běží paralelně.
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
          queueMicrotask(() => showToast(data));
        }
        return next;
      });
      setBusy(false);
    }, 0);
  }, [trackSave, showToast]);

  const onTournSimToEnd = useCallback(() => {
    setConfirmDialog({
      message:
        "Dohrát celý turnaj s aktuálním plánem? Zbývající zápasy se odehrají najednou, události se přeskočí a akci nejde vrátit.",
      confirmLabel: "Dohrát turnaj",
      onConfirm: () => {
        setBusy(true);
        setTimeout(() => {
          mutateRun((r) => simulateRunToEnd(r));
          setBusy(false);
        }, 0);
      },
    });
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

  // ── Klubový pohár (paralelní k sezóně, viz `finishAndAdvance`) ──
  const onCupPlayRound = useCallback(() => {
    setBusy(true);
    setTimeout(() => {
      setSave((prev) => {
        if (!prev || !prev.cup || isCupRunOver(prev.cup)) return prev;
        const before = prev.cup;
        const prevMorale = before.tournament.morale;
        const after = playCupRunRound(before);
        const next = { ...prev, cup: after };
        trackSave(next);
        const yourLast = [...after.tournament.results]
          .reverse()
          .find((r) => r.homeId === before.yourTeamId || r.awayId === before.yourTeamId);
        if (yourLast) {
          const isHome = yourLast.homeId === before.yourTeamId;
          const opp = teamById(after.tournament.teams, isHome ? yourLast.awayId : yourLast.homeId);
          const data: ToastData = {
            oppName: opp.name,
            yourGoals: isHome ? yourLast.homeGoals : yourLast.awayGoals,
            oppGoals: isHome ? yourLast.awayGoals : yourLast.homeGoals,
            moraleDelta: after.tournament.morale - prevMorale,
          };
          queueMicrotask(() => showToast(data));
        }
        return next;
      });
      setBusy(false);
    }, 0);
  }, [trackSave, showToast]);

  const onCupSimToEnd = useCallback(() => {
    setConfirmDialog({
      message:
        "Dohrát celý pohár s aktuálním plánem? Zbývající zápasy se odehrají najednou, události se přeskočí a akci nejde vrátit.",
      confirmLabel: "Dohrát pohár",
      onConfirm: () => {
        setBusy(true);
        setTimeout(() => {
          mutateCup((r) => simulateCupRunToEnd(r));
          setBusy(false);
        }, 0);
      },
    });
  }, [mutateCup]);

  const onCupPlan = useCallback((p: Plan) => mutateCup((r) => setCupPlan(r, p)), [mutateCup]);
  const onCupInstruction = useCallback(
    (i: Instruction) => mutateCup((r) => setCupInstruction(r, i)),
    [mutateCup]
  );
  const onCupEventChoice = useCallback(
    (choiceIndex: number) =>
      mutateCup((r) => ({ ...r, tournament: applyEventChoice(r.tournament, choiceIndex) })),
    [mutateCup]
  );

  // Uzavře pohár: souhrn + reputace + fold do profilu + achievementy, pak zpět do sezóny.
  const onFinishCup = useCallback(() => {
    setSave((prev) => {
      if (!prev || !prev.cup) return prev;
      const summary = summarizeCupRun(prev.cup);
      const reputation = updateReputationCup(prev.manager.reputation, summary);
      const folded = foldCup(prev.profile, summary);
      const earned = newlyEarnedCup(prev.profile.achievements.map((a) => a.id), {
        allTime: folded.allTime,
        last: summary,
        reputation,
      });
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
        cup: null,
        cupHistory: [...(prev.cupHistory ?? []), summary],
      };
      trackSave(next);
      if (earned.length > 0) setHasUnseenAchievement(true);
      return next;
    });
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
          queueMicrotask(() => showToast(data));
        }
        return next;
      });
      setBusy(false);
    }, 0);
  }, [trackSave, showToast]);

  const onSimulateToEnd = useCallback(() => {
    const planLabel = save?.current ? PLAN_LABEL[save.current.plan] : "";
    setConfirmDialog({
      message: `Dohrát celou sezónu s aktuálně zvoleným plánem (${planLabel})? Zbývající zápasy se odehrají najednou se stejným plánem, náhodné události se přeskočí a akci nejde vrátit zpět.`,
      confirmLabel: "Dohrát sezónu",
      onConfirm: () => {
        setBusy(true);
        setTimeout(() => {
          mutateSeason((s) => simulateToEnd(s));
          setBusy(false);
        }, 0);
      },
    });
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
        const nextSeason = buildNext(prev, prev.current);
        // Klubový pohár se sestaví hned na konci sezóny (ne líně při dalším vstupu), ať
        // hráč uvidí "postup do poháru" rovnou v souhrnu sezóny. Nerozjetý pohár se nikdy
        // nepřepíše (dohrát/uzavřít ho řeší samostatná akce) – ANI když bys tuhle sezónou
        // do Evropy nepostoupil, běžící pohár z dřívějška zůstává. Kvalifikace patří KLUBU,
        // ne trenérovi: job market na jiný klub (`onSwitch` s jiným `yourTeamId`) ji nebere
        // s sebou, stejně jako se nebere akademie/skauting – jen postup/sestup se STEJNÝM
        // klubem (`s.yourTeamId` beze změny) kvalifikaci zachová. Odchod k jinému klubu
        // (`!sameClub`) i rozjetý pohár zahodí – vedeš teď jiný klub, dohrávat cizí pohár
        // by nedávalo smysl. Fáze bez UI: reálně na to hráč zatím nenarazí (ke ztrátě
        // rozjetého poháru přes job market dojde, až Fáze 3 UI umožní pohár vidět/hrát).
        const sameClub = nextSeason.yourTeamId === prev.current.yourTeamId;
        const cup = !sameClub
          ? null
          : (prev.cup ??
            (clubQualifies(summary.europe)
              ? startCupRun(
                  randomSeed(),
                  teamById(nextSeason.teams, nextSeason.yourTeamId),
                  nextSeason.season,
                  (prev.cupHistory?.length ?? 0) + 1,
                  summary.yourPrestige
                )
              : null));
        const next: SaveState = {
          ...prev,
          profile,
          manager: { reputation },
          current: nextSeason,
          history: [...prev.history, summary],
          cup,
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
      // Postup/sestup si klub bereš s sebou → akademie i skauti jdou s ním.
      // Job market = nový klub → obojí od nuly (patří klubu, ne trenérovi).
      youth = 0,
      scouting = 0
    ) =>
      finishAndAdvance((_prev, current) =>
        newSeason(randomSeed(), teamId, {
          teams,
          leagueId,
          leagueName,
          leagueAccess,
          season: current.season + 1,
          youth,
          scouting,
        })
      ),
    [finishAndAdvance]
  );

  // Úplný restart „od nuly": smaže obě kariéry i reputaci (síň slávy zůstává).
  const onReset = useCallback(() => {
    setConfirmDialog({
      message:
        "Nová kariéra od nuly? Rozehraný klub i reprezentace, jejich historie a reputace se smažou. Síň slávy (rekordy + achievementy) zůstane.",
      confirmLabel: "Začít od nuly",
      onConfirm: () => {
        setSave((prev) => {
          if (!prev) return prev;
          const next: SaveState = {
            ...prev,
            manager: { reputation: STARTING_REPUTATION },
            current: null,
            history: [],
            tournament: null,
            tournamentHistory: [],
            cup: null,
            cupHistory: [],
          };
          trackSave(next);
          return next;
        });
        setView("season");
        setCareerMode("club");
        setHasUnseenAchievement(false);
      },
    });
  }, [trackSave]);

  // Ukončí JEN klubovou kariéru (reprezentace i sdílená reputace zůstávají).
  const onEndClub = useCallback(() => {
    setConfirmDialog({
      message:
        "Ukončit klubovou kariéru? Rozehraná sezóna a její historie se smažou; reputace, síň slávy i případná reprezentace zůstanou.",
      confirmLabel: "Ukončit klub",
      onConfirm: () => {
        setSave((prev) => {
          if (!prev) return prev;
          // Pohár patří klubu (viz `finishAndAdvance`) → ukončení klubu ho zahodí spolu s ním.
          const next: SaveState = { ...prev, current: null, history: [], cup: null, cupHistory: [] };
          trackSave(next);
          return next;
        });
        setCareerMode("nation");
      },
    });
  }, [trackSave]);

  // Ukončí JEN reprezentační běh (klub i sdílená reputace zůstávají). Bez foldu (opuštění).
  const onEndNation = useCallback(() => {
    setConfirmDialog({
      message:
        "Ukončit reprezentaci? Rozehraný turnaj se zahodí (nezapíše se do síně slávy); klub a reputace zůstanou.",
      confirmLabel: "Ukončit reprezentaci",
      onConfirm: () => {
        setSave((prev) => {
          if (!prev) return prev;
          const next: SaveState = { ...prev, tournament: null };
          trackSave(next);
          return next;
        });
        setCareerMode("club");
      },
    });
  }, [trackSave]);

  // Wrappery výběru: po startu zavřou overlay a přepnou na nově převzatý režim.
  const takeClub = useCallback(
    (
      leagueId: number,
      leagueName: string,
      teams: GameTeam[],
      teamId: number,
      leagueAccess: LeagueAccess | null
    ) => {
      startGame(leagueId, leagueName, teams, teamId, leagueAccess);
      setPicking(null);
      setCareerMode("club");
    },
    [startGame]
  );

  const takeNation = useCallback(
    (competitionId: CompetitionId, teamId: number) => {
      startTournament(competitionId, teamId);
      setPicking(null);
      setCareerMode("nation");
    },
    [startTournament]
  );

  const hasClub = Boolean(save?.current);
  const hasNation = Boolean(save?.tournament);
  // Když běží obě, řídí zobrazení `careerMode`; jinak se ukáže ta existující.
  const mode: "club" | "nation" = hasClub && hasNation ? careerMode : hasNation ? "nation" : "club";
  const sharedReputation = save?.manager.reputation ?? STARTING_REPUTATION;

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
      ) : picking ? (
        <PickerScreen
          mode={picking}
          reputation={sharedReputation}
          onBack={() => setPicking(null)}
          onStartClub={takeClub}
          onStartTournament={takeNation}
          onError={setError}
        />
      ) : !hasClub && !hasNation ? (
        <ManagerHub
          save={save}
          managerName={user.name ?? null}
          onPickClub={() => setPicking("club")}
          onPickNation={() => setPicking("nation")}
        />
      ) : (
        <>
          {hasClub && hasNation && <ModeBar mode={mode} onMode={setCareerMode} />}
          {mode === "nation" && save?.tournament ? (
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
              onEnd={onEndNation}
              onReset={onReset}
              onTakeClub={hasClub ? undefined : () => setPicking("club")}
            />
          ) : save?.current ? (
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
              onEndClub={onEndClub}
              onTakeNation={hasNation ? undefined : () => setPicking("nation")}
              onError={setError}
              hasUnseenAchievement={hasUnseenAchievement}
              onDismissUnseenAchievement={() => setHasUnseenAchievement(false)}
              cup={save.cup ?? null}
              onCupPlayRound={onCupPlayRound}
              onCupSimulateToEnd={onCupSimToEnd}
              onCupPlan={onCupPlan}
              onCupInstruction={onCupInstruction}
              onCupEventChoice={onCupEventChoice}
              onCupFinish={onFinishCup}
            />
          ) : null}
        </>
      )}

      <MatchResultToast key={toastSeq} toast={toast} onClose={() => setToast(null)} />
      <ConfirmDialog data={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </main>
  );
}

/** Potvrzovací modal pro destruktivní akce – nahrazuje nativní `confirm()`. */
function ConfirmDialog({
  data,
  onClose,
}: {
  data: ConfirmDialogData | null;
  onClose: () => void;
}) {
  if (!data) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-foreground">{data.message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-border/40"
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={() => {
              data.onConfirm();
              onClose();
            }}
            className="flex-1 rounded-full bg-negative px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            {data.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tlačítko „Sdílet výsledek" pro dohranou sezónu/turnaj. Sestaví veřejnou URL
 * na `/hra/vysledek` (query-string driven, žádný DB lookup na druhé straně, viz
 * `app/hra/vysledek/page.tsx`) a spustí nativní share sheet / clipboard fallback
 * (`shareOrCopy`, sdílené s `AppHeader`'s `ShareButton`).
 */
function ShareResultButton({
  club,
  headline,
  context,
  titles,
}: {
  club: string;
  headline: string;
  context: string;
  titles?: number;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function share() {
    const params = new URLSearchParams({ club, headline, context });
    if (titles) params.set("titles", String(titles));
    const url = `${window.location.origin}/hra/vysledek?${params.toString()}`;
    const outcome = await shareOrCopy(url, `${club} — ${headline}`);
    if (outcome === "copied") {
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } else if (outcome === "error") {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  const label = state === "copied" ? "Zkopírováno" : state === "error" ? "Nešlo zkopírovat" : "Sdílet výsledek";
  return (
    <button
      type="button"
      onClick={share}
      className="mt-3 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-muted transition hover:text-foreground"
    >
      <span aria-hidden>🔗</span> {label}
    </button>
  );
}

/**
 * Popup výsledku po odehraném kole. Napínavější na odhalení: nejdřív se ukáže „zapečetěná"
 * obálka (soupeř + tlukoucí `?–?`, bez barvy výsledku, ať nic neprozradí), pak se skóre
 * po krátké prodlevě samo odhalí `pop` animací — nebo hráč klepne a odhalí ho hned.
 */
function MatchResultToast({
  toast,
  onClose,
}: {
  toast: ToastData | null;
  onClose: () => void;
}) {
  // Komponenta se remountuje na každý nový výsledek (`key` v HraApp) → `revealed` startuje
  // false bez resetu ve `useEffect` (ten by porušil react-hooks/set-state-in-effect).
  const [revealed, setRevealed] = useState(false);

  // Po krátké prodlevě se skóre samo odhalí (klepnutí ho odhalí dřív).
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setRevealed(true), 1100);
    return () => clearTimeout(t);
  }, [toast]);

  // Po odhalení chvíli počkej a zavři.
  useEffect(() => {
    if (!toast || !revealed) return;
    const t = setTimeout(onClose, 2600);
    return () => clearTimeout(t);
  }, [toast, revealed, onClose]);

  if (!toast) return null;

  const outcome =
    toast.yourGoals > toast.oppGoals
      ? { label: "Výhra 🎉", cls: "border-positive bg-positive/15 text-positive" }
      : toast.yourGoals < toast.oppGoals
        ? { label: "Prohra 😞", cls: "border-negative bg-negative/15 text-negative" }
        : { label: "Remíza 😐", cls: "border-border bg-surface text-muted" };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="fade-in pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-surface/90 px-5 py-2.5 shadow-lg backdrop-blur transition hover:border-foreground/30"
          aria-label="Odhalit výsledek zápasu"
        >
          <span className="text-sm font-bold text-foreground">⚽ Konec zápasu</span>
          <span className="animate-pulse tabular-nums text-base font-bold text-muted">?–?</span>
          <span className="max-w-[35vw] truncate text-xs text-muted">vs {toast.oppName}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted">klepni</span>
        </button>
      ) : (
        <div
          className={
            "fade-in pointer-events-auto flex items-center gap-3 rounded-full border px-5 py-2.5 shadow-lg backdrop-blur " +
            outcome.cls
          }
          role="status"
        >
          <span className="text-sm font-bold">{outcome.label}</span>
          <span className="reveal-pop tabular-nums text-lg font-bold text-foreground">
            {toast.yourGoals}:{toast.oppGoals}
          </span>
          <span className="max-w-[40vw] truncate text-xs text-muted">vs {toast.oppName}</span>
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
      )}
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
  onEndClub,
  onTakeNation,
  onError,
  hasUnseenAchievement,
  onDismissUnseenAchievement,
  cup,
  onCupPlayRound,
  onCupSimulateToEnd,
  onCupPlan,
  onCupInstruction,
  onCupEventChoice,
  onCupFinish,
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
    youth?: number,
    scouting?: number
  ) => void;
  onReset: () => void;
  /** Ukončí jen klubovou kariéru (reprezentace zůstane). */
  onEndClub: () => void;
  /** Otevře výběr reprezentace (jen když ještě žádná neběží). */
  onTakeNation?: () => void;
  onError: (e: string | null) => void;
  hasUnseenAchievement: boolean;
  onDismissUnseenAchievement: () => void;
  /** Probíhající klubový pohár, nebo null (tab se ukáže jen když existuje). */
  cup: CupRun | null;
  onCupPlayRound: () => void;
  onCupSimulateToEnd: () => void;
  onCupPlan: (p: Plan) => void;
  onCupInstruction: (i: Instruction) => void;
  onCupEventChoice: (choiceIndex: number) => void;
  onCupFinish: () => void;
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
          {cup && (
            <Segment active={view === "cup"} onClick={() => setView("cup")}>
              🏆 Pohár
            </Segment>
          )}
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
          {onTakeNation && (
            <button
              type="button"
              onClick={onTakeNation}
              title="Převezmi navíc reprezentaci — poběží paralelně s klubem"
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-foreground"
            >
              🌐 Repre
            </button>
          )}
        </div>
      </div>

      {/* Přehled manažera (jméno, reputace, rekordy) žije v Profilu – tady by byl duplicita.
          V Sezóně zůstává jen sezónní cíl; kontext angažmá je taky v Profilu. */}
      {view === "season" && !done && <RoleNote state={s} />}

      {view === "profile" ? (
        <>
          <ProfilePanel
            profile={save.profile}
            reputation={save.manager.reputation}
            managerName={managerName}
            activeCareer
            current={s}
            history={save.history}
            tournamentHistory={save.tournamentHistory ?? []}
            cupHistory={save.cupHistory ?? []}
          />
          <CareerManagement endLabel="klubovou kariéru" onEnd={onEndClub} onReset={onReset} />
        </>
      ) : view === "history" ? (
        <HistoryView save={save} />
      ) : view === "cup" && cup ? (
        <CupView
          cup={cup}
          save={save}
          busy={busy}
          onPlayRound={onCupPlayRound}
          onSimulateToEnd={onCupSimulateToEnd}
          onPlan={onCupPlan}
          onInstruction={onCupInstruction}
          onEventChoice={onCupEventChoice}
          onFinish={onCupFinish}
        />
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
/**
 * Jediné, co musí být vidět nad zápasem: co po tobě vedení chce. Prestiž klubu, očekávané
 * umístění a dosah reputace se nemění během sezóny → patří do Profilu (`EngagementNote`),
 * ne nad každý zápas.
 */
function RoleNote({ state }: { state: SeasonState }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface/50 px-3 py-2 text-xs text-muted">
      <span aria-hidden>🎯</span>
      <span>
        Cíl sezóny: <strong className="text-foreground">{state.objective.text}</strong>
      </span>
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

      {/* Objektivní čísla, kterými si hráč ověří skautovo hlášení */}
      <EvidencePanel
        state={state}
        youId={you.id}
        oppId={next.opponent.id}
        isHome={next.isHome}
      />

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
 * Scouting karta soupeře: HLÁŠENÝ styl + konfidence + odhalené traity (+ doporučení
 * u detailního hlášení). Pozor: `scout.style` ani `scout.traits` (pravda) se sem nesmí
 * dostat – protitah by pak byl jistota. Karta ukazuje jen `reported*`.
 */
function ScoutCard({ scout, oppName }: { scout: ScoutReport; oppName: string }) {
  const pct = Math.round(scout.confidence * 100);
  const q = scout.quality;
  const confTone =
    q === "detailed"
      ? "bg-positive/15 text-positive"
      : q === "standard"
        ? "bg-border/60 text-muted"
        : "bg-warning/15 text-warning";
  return (
    <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">🔍 Scouting</span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted">
            {scout.reportedStyle === null
              ? "styl neznámý"
              : (q === "detailed" ? "" : "spíš ") + STYLE_LABEL[scout.reportedStyle]}
          </span>
          <span
            className={"rounded-full px-1.5 py-0.5 text-[10px] font-semibold " + confTone}
            title={`Spolehlivost hlášení. Roste s tím, kolik toho soupeř odehrál (zatím ${scout.sample} zápasů), jestli jste se už potkali, a s investicí do skautingu.`}
          >
            {pct} %
          </span>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        <span className="text-foreground">{oppName}:</span> {scout.note}
      </p>
      <StyleCompass reportedStyle={scout.reportedStyle} confidence={scout.confidence} />
      {q !== "detailed" && (
        <p className="mt-1 text-[10px] italic text-muted">
          Skauti nemuseli vidět všechno — soupeř může mít i rysy, které nehlásí.
        </p>
      )}
      {scout.suggestion && (
        <p className="mt-2 rounded-lg bg-positive/10 px-2 py-1 text-[11px] text-foreground">
          🎯 Skauti radí: <strong>{scout.suggestion.text}</strong>
        </p>
      )}
    </div>
  );
}

const COMPASS_ZONES: { key: OppStyle; label: string; pos: number }[] = [
  { key: "attacking", label: "Útočný", pos: 16.7 },
  { key: "balanced", label: "Vyrovnaný", pos: 50 },
  { key: "defensive", label: "Defenzivní", pos: 83.3 },
];

/**
 * Vizuální "kompas" HLÁŠENÉHO stylu soupeře. Ukazuje jen `reportedStyle`/`confidence`
 * (nikdy pravdu, viz komentář u `ScoutCard`) – nejistota se řeší vizuálně (rozmazaná,
 * širší "skvrna" místo přesného bodu), ne skrytím čísla. `reportedStyle === null`
 * (kvalita `vague`) = žádná značka, jen spektrum bez odpovědi.
 */
function StyleCompass({
  reportedStyle,
  confidence,
}: {
  reportedStyle: OppStyle | null;
  confidence: number;
}) {
  const pos = reportedStyle ? COMPASS_ZONES.find((z) => z.key === reportedStyle)!.pos : 50;
  // Nízká spolehlivost → větší, průhlednější "skvrna" nejistoty; vysoká → těsný bod.
  const halo = 10 + (1 - confidence) * 34;
  return (
    <div className="mt-2">
      <div className="relative h-3 overflow-hidden rounded-full bg-border/40">
        <div className="absolute inset-0 flex">
          {COMPASS_ZONES.map((z) => (
            <div key={z.key} className="flex-1 border-r border-background/60 last:border-r-0" />
          ))}
        </div>
        {reportedStyle && (
          <>
            <div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warning"
              style={{ left: `${pos}%`, width: halo, height: halo, opacity: 0.12 }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warning"
              style={{ left: `${pos}%`, opacity: 0.35 + confidence * 0.65 }}
            />
          </>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted">
        {COMPASS_ZONES.map((z) => (
          <span key={z.key}>{z.label}</span>
        ))}
      </div>
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
const EventCard = memo(function EventCard({
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
        {ev.choices.map((c, i) => {
          const chips = describeEffect(c.effect);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChoice(i)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-left transition hover:border-foreground/30"
            >
              <span className="block text-sm font-medium text-foreground">{c.label}</span>
              <span className="block text-[11px] text-muted">{c.detail}</span>
              {chips.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {chips.map((ch, j) => (
                    <span
                      key={j}
                      className={
                        "rounded-md px-1.5 py-0.5 text-[10px] font-semibold " +
                        (ch.tone === "good"
                          ? "bg-positive/15 text-positive"
                          : ch.tone === "bad"
                            ? "bg-negative/15 text-negative"
                            : "bg-border/60 text-muted")
                      }
                    >
                      {ch.text}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/**
 * Objektivní čísla, ze kterých `scoutOpponent` odvozuje styl soupeře — aby si hráč mohl
 * skautovo (zašuměné) hlášení ověřit sám. Proto se ukazuje jen to, co s volbou taktiky
 * souvisí, a **venue-specificky**: pro nadcházející zápas platí tvoje domácí čísla proti
 * jeho venkovním, ne celkové průměry. Pozice/body/čistá konta jsou v tabulce, ne tady.
 */
const EvidencePanel = memo(function EvidencePanel({
  state,
  youId,
  oppId,
  isHome,
}: {
  state: SeasonState;
  youId: number;
  oppId: number;
  /** Hraješ tenhle zápas doma? Řídí, která polovina statistik je relevantní. */
  isHome: boolean;
}) {
  const a = teamSeasonStats(state, youId);
  const b = teamSeasonStats(state, oppId);
  if (a.played === 0 && b.played === 0) {
    return (
      <p className="mt-3 text-center text-[11px] text-muted">
        Čísla soupeře naskočí po prvních odehraných kolech.
      </p>
    );
  }
  const you = venueStats(a, isHome);
  const opp = venueStats(b, !isHome);
  const leagueAvg = leagueGoalsPerTeamGame(state.results);
  const rows: { label: string; a: number; b: number; lowerIsBetter?: boolean }[] = [
    { label: "Ø vstřelené", a: you.avgFor, b: opp.avgFor },
    { label: "Ø obdržené", a: you.avgAgainst, b: opp.avgAgainst, lowerIsBetter: true },
  ];

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-0.5 text-center text-xs font-semibold text-foreground">
        Čísla soupeře
      </div>
      <div className="mb-2 text-center text-[10px] text-muted">
        {isHome ? "ty doma · soupeř venku" : "ty venku · soupeř doma"} · ⌀ liga{" "}
        {leagueAvg.toFixed(2)} gólu/zápas
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          // „Lepší" se poměřuje vůči LIZE, ne vůči soupeři – přesně tak, jak styl
          // odvozuje scouting (útok/obrana proti ligovému průměru).
          const aGood = r.lowerIsBetter ? r.a < leagueAvg : r.a > leagueAvg;
          const bGood = r.lowerIsBetter ? r.b < leagueAvg : r.b > leagueAvg;
          // Relativní pruh ty-vs-soupeř: u "lower is better" metrik se poměr počítá
          // z převrácených hodnot, ať širší úsek vždy znamená "lepší", ne "vyšší číslo".
          const va = r.lowerIsBetter ? 1 / (r.a + 0.05) : r.a;
          const vb = r.lowerIsBetter ? 1 / (r.b + 0.05) : r.b;
          const total = va + vb;
          const ratio = total > 0 ? va / total : 0.5;
          return (
            <div key={r.label}>
              <div className="grid grid-cols-3 items-center text-xs">
                <span
                  className={
                    "text-left tabular-nums " + (aGood ? "font-bold text-positive" : "text-muted")
                  }
                >
                  {r.a.toFixed(2)}
                </span>
                <span className="text-center text-[11px] text-muted">{r.label}</span>
                <span
                  className={
                    "text-right tabular-nums " + (bGood ? "font-bold text-positive" : "text-muted")
                  }
                >
                  {r.b.toFixed(2)}
                </span>
              </div>
              <div className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-border/40">
                <div
                  className={"bar-fill " + (aGood ? "bg-positive" : "bg-muted/40")}
                  style={{ width: `${ratio * 100}%` }}
                />
                <div
                  className={"bar-fill " + (bGood ? "bg-positive" : "bg-muted/40")}
                  style={{ width: `${(1 - ratio) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
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
      <p className="mt-2 text-center text-[10px] text-muted">
        Soupeř odehrál {b.played}{" "}
        {b.played === 1 ? "zápas" : b.played < 5 ? "zápasy" : "zápasů"}
        {opp.played !== b.played
          ? ` (z toho ${opp.played} ${isHome ? "venku" : "doma"})`
          : ""}
        .
      </p>
    </div>
  );
});

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

const LeagueTable = memo(function LeagueTable({ state }: { state: SeasonState }) {
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
});

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

const DEV_AREAS: (keyof DevSpend)[] = [
  "attack",
  "defense",
  "youth",
  "stadium",
  "scouting",
];

/**
 * Rozdělení rozvojových bodů mezi sezónami. Body dává výsledek sezóny (umístění, cíl,
 * titul/Evropa, reputace) – strop je `MAX_DEV_POINTS`, takže jedna sezóna z průměrného
 * klubu top tým neudělá. Nevyužité body propadají (nepřenášejí se).
 */
/**
 * Přehled akumulovaného stavu klubu (síla vs liga, stadion, mládež) + co je trvalé a co
 * mezi sezónami regreduje. Čistě čte SeasonState – žádná nová data, jen viditelnost rozvoje.
 */
const ClubOverview = memo(function ClubOverview({ state }: { state: SeasonState }) {
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
  const scoutPct = Math.max(0, Math.min(1, state.scouting / SCOUT_LEVEL_MAX));

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
        <DevMeter
          label="Skauting"
          pct={scoutPct}
          right={`${state.scouting}/${SCOUT_LEVEL_MAX}`}
          tone="muted"
        />
      </div>

      <p className="mt-2 text-[10px] leading-tight text-muted">
        Stadion je <strong className="text-foreground">trvalý</strong> (neregreduje). Útok a
        obrana se mezi sezónami mírně vrací k průměru ligy — mládež ten propad tlumí.
        Skauting sílu nezvyšuje, jen zpřesňuje hlášení o soupeři.
      </p>
    </div>
  );
});

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

const DevelopmentPanel = memo(function DevelopmentPanel({
  points,
  spend,
  left,
  youth,
  scouting,
  homeBoost,
  onChange,
}: {
  points: number;
  spend: DevSpend;
  left: number;
  youth: number;
  scouting: number;
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
    // Mládež, stadion i skauting mají vlastní strop (kumulativní napříč sezónami) – bod nad
    // strop by se tiše ztratil (`applyDevelopment`/`nextScouting` ho ořízne), tak ho radši
    // nejde ani přidat.
    if (area === "youth" && youth + next.youth > DEV_YOUTH_MAX) return;
    if (area === "stadium" && next.stadium > stadiumRoom) return;
    if (area === "scouting" && scouting + next.scouting > SCOUT_LEVEL_MAX) return;
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
          const atScoutCap =
            area === "scouting" && scouting + spend.scouting >= SCOUT_LEVEL_MAX;
          const atCap = atYouthCap || atStadiumCap || atScoutCap;
          const hint = atYouthCap
            ? "Akademie na maximu"
            : atStadiumCap
              ? "Stadion na maximu"
              : atScoutCap
                ? "Skauti na maximu"
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
});

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
    youth?: number,
    scouting?: number
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
      onSwitch(
        targetId,
        targetName,
        roster,
        s.yourTeamId,
        leagueAccess,
        nextYouth(s.youth, spend),
        nextScouting(s.scouting, spend)
      );
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
        {clubQualifies(summary.europe) && (
          <p className="mt-2 rounded-lg bg-positive/10 px-2 py-1 text-xs font-semibold text-positive">
            🎟️ Postup do {CLUB_CUP_NAME}! (Pokud pokračuješ se stejným klubem.)
          </p>
        )}
        <p className="mt-2 text-xs">
          Reputace{" "}
          <strong className={repDelta >= 0 ? "text-positive" : "text-negative"}>
            {repDelta >= 0 ? "+" : ""}
            {repDelta}
          </strong>{" "}
          → {projectedRep}
        </p>
        <ShareResultButton
          club={teamById(s.teams, s.yourTeamId).name}
          headline={seasonHeadline(summary)}
          context={`Sezóna ${summary.season} · ${s.leagueName}`}
          titles={folded.allTime.titles}
        />
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
            scouting={s.scouting}
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

// ───────────────────────── reprezentační turnaj ─────────────────────────

function TournamentView({
  save,
  managerName,
  run,
  busy,
  onPlayRound,
  onSimulateToEnd,
  onPlan,
  onInstruction,
  onEventChoice,
  onFinish,
  onEnd,
  onReset,
  onTakeClub,
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
  /** Opustí reprezentační běh (klub zůstane). */
  onEnd: () => void;
  onReset: () => void;
  /** Otevře výběr klubu (jen když žádný neběží). */
  onTakeClub?: () => void;
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
  const [showProfile, setShowProfile] = useState(false);

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
        <div className="flex flex-wrap items-center gap-1.5">
          <Segment active={showProfile} onClick={() => setShowProfile((v) => !v)}>
            Profil
          </Segment>
          {onTakeClub && (
            <button
              type="button"
              onClick={onTakeClub}
              title="Převezmi navíc klub — poběží paralelně s reprezentací"
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-foreground"
            >
              🏟️ Klub
            </button>
          )}
          <button
            type="button"
            onClick={onEnd}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-negative"
          >
            Ukončit
          </button>
          <button
            type="button"
            onClick={onReset}
            title="Nová kariéra od nuly (smaže klub i reprezentaci a reputaci)"
            className="rounded-full border border-negative/40 bg-negative/10 px-3 py-1.5 text-xs font-medium text-negative transition hover:bg-negative/15"
          >
            Od nuly
          </button>
        </div>
      </div>

      {showProfile ? (
        <ProfilePanel
          profile={save.profile}
          reputation={save.manager.reputation}
          managerName={managerName}
          activeCareer
          // Blok „Aktuální angažmá" se ukáže jen když paralelně běží i klubová kariéra.
          current={save.current}
          history={save.history}
          tournamentHistory={save.tournamentHistory ?? []}
          cupHistory={save.cupHistory ?? []}
        />
      ) : over ? (
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
          <TournamentBracket
            tournament={run.tournament!}
            yourTeamId={run.yourTeamId}
            format={comp.format}
          />
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
            <TournamentBracket
              tournament={run.tournament!}
              yourTeamId={run.yourTeamId}
              format={comp.format}
            />
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
/**
 * Skupina + pavouk z libovolného `TournamentState` (reprezentační turnaj i klubový pohár
 * sdílejí stejný typ, viz `tournament.ts`) – sdílené mezi `TournamentView` a `CupView`.
 */
const TournamentBracket = memo(function TournamentBracket({
  tournament: t,
  yourTeamId,
  format,
}: {
  tournament: TournamentState;
  yourTeamId: number;
  format: TournamentFormat;
}) {
  // Skupinová fáze → tvoje skupina; pak už jen cesta pavoukem.
  const gi = groupIndexOf(t, yourTeamId);
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
    (k) => k.homeId === yourTeamId || k.awayId === yourTeamId
  );

  return (
    <div className="mt-4 space-y-4">
      {groupRows.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-foreground">
            Skupina · postupují {format.advancePerGroup}
          </h3>
          <MiniTable rows={groupRows} yourId={yourTeamId} qualifyTop={format.advancePerGroup} />
        </div>
      )}
      {yourKo.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-foreground">Tvoje cesta pavoukem</h3>
          <div className="mt-2 space-y-1.5">
            {yourKo.map((k, i) => {
              const isHome = k.homeId === yourTeamId;
              const oppId = isHome ? k.awayId : k.homeId;
              const yourGoals = isHome ? k.homeGoals : k.awayGoals;
              const oppGoals = isHome ? k.awayGoals : k.homeGoals;
              const won = k.winnerId === yourTeamId;
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
});

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
        <ShareResultButton
          club={run.yourName}
          headline={headline}
          context={COMPETITIONS[run.competitionId].name}
          titles={folded.allTime.majorTitles}
        />
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

// ───────────────────────── klubový pohár (UI) ─────────────────────────

/** Sub-tab uvnitř klubového režimu (vedle Sezóna/Kariéra/Profil) – jen když `cup` existuje. */
function CupView({
  cup,
  save,
  busy,
  onPlayRound,
  onSimulateToEnd,
  onPlan,
  onInstruction,
  onEventChoice,
  onFinish,
}: {
  cup: CupRun;
  save: SaveState;
  busy: boolean;
  onPlayRound: () => void;
  onSimulateToEnd: () => void;
  onPlan: (p: Plan) => void;
  onInstruction: (i: Instruction) => void;
  onEventChoice: (choiceIndex: number) => void;
  onFinish: () => void;
}) {
  const t = cup.tournament;
  const over = isCupRunOver(cup);
  // Vypadl jsi v pavouku, ale pohár ještě běží (dohrává se, aby byl znám vítěz).
  const eliminated = !over && t.eliminated;
  const pendingEvent = t.pendingEvent;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <TeamLogo src={cup.yourLogo} alt={cup.yourName} size={30} />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-foreground">{cup.yourName}</div>
          <div className="text-xs text-muted">
            🏆 {CLUB_CUP_NAME} · {STAGE_LABEL[t.yourStage]}
          </div>
        </div>
      </div>

      {over ? (
        <CupDone cup={cup} save={save} onFinish={onFinish} />
      ) : eliminated ? (
        <>
          <div className="mt-4 rounded-2xl border border-negative/40 bg-negative/10 p-4 text-center text-sm text-negative">
            Tvůj klub v poháru vypadl. Pohár se dohraje, aby byl znám vítěz.
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onSimulateToEnd}
            className="mt-3 w-full rounded-full bg-positive px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Simuluje se…" : "Dohrát pohár do konce"}
          </button>
          <TournamentBracket tournament={t} yourTeamId={cup.yourTeamId} format={CLUB_CUP_FORMAT} />
        </>
      ) : (
        <>
          {pendingEvent && <EventCard event={pendingEvent} onChoice={onEventChoice} />}
          <CupNextMatch cup={cup} onPlan={onPlan} onInstruction={onInstruction} />
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
              {busy ? "Simuluje se…" : "Dohrát pohár"}
            </button>
          </div>
          <TournamentBracket tournament={t} yourTeamId={cup.yourTeamId} format={CLUB_CUP_FORMAT} />
        </>
      )}
    </div>
  );
}

/** Náhled nejbližšího zápasu poháru + agency (obdoba `TournamentNextMatch`/`NextMatch`). */
function CupNextMatch({
  cup,
  onPlan,
  onInstruction,
}: {
  cup: CupRun;
  onPlan: (p: Plan) => void;
  onInstruction: (i: Instruction) => void;
}) {
  const preview = cupPreview(cup);
  const t = cup.tournament;
  if (!preview) return null;
  const { you, opponent, isHome, probs } = preview;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">
        Nejbližší zápas {isHome ? "(doma)" : "(venku)"}
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
      <MoraleBar morale={t.morale} />
      <FitnessBar fitness={t.fitness} plan={t.plan} />
      <ActiveModifiers state={{ modifiers: t.modifiers, round: t.round }} />

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-foreground">Zápasový plán</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {PLANS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={t.plan === p}
              onClick={() => onPlan(p)}
              className={
                "rounded-lg px-2 py-1.5 text-xs font-medium transition " +
                (t.plan === p
                  ? "bg-foreground text-background"
                  : "border border-border bg-surface text-muted hover:text-foreground")
              }
            >
              {PLAN_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted">{PLAN_HINT[t.plan]}</p>
        <InstructionPicker value={t.instruction} onPick={onInstruction} disabled={false} />
      </div>
    </div>
  );
}

/** Souhrn dohraného poháru (obdoba `TournamentDone`). */
function CupDone({
  cup,
  save,
  onFinish,
}: {
  cup: CupRun;
  save: SaveState;
  onFinish: () => void;
}) {
  const summary = summarizeCupRun(cup);
  const projectedRep = updateReputationCup(save.manager.reputation, summary);
  const repDelta = projectedRep - Math.round(save.manager.reputation);
  const folded = foldCup(save.profile, summary);
  const earned = newlyEarnedCup(save.profile.achievements.map((a) => a.id), {
    allTime: folded.allTime,
    last: summary,
    reputation: projectedRep,
  });

  const good = summary.champion || summary.stageReached === "final" || summary.stageReached === "sf";
  const headline = summary.champion
    ? "Mistr! 🏆"
    : summary.stageReached === "final"
      ? "Finalista 🥈"
      : `Konec ve fázi: ${STAGE_LABEL[summary.stageReached as Stage]}`;
  const emoji = summary.champion ? "🏆" : good ? "🎉" : "🏁";
  const toneClass = summary.champion || good ? "text-positive" : "text-foreground";

  return (
    <div className="mt-4">
      <div className="rounded-2xl border border-border bg-surface p-5 text-center shadow-sm">
        <p className="text-3xl">{emoji}</p>
        <p className="mt-2 text-sm font-semibold text-foreground">
          {CLUB_CUP_NAME} · {cup.yourName}
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
        <ShareResultButton
          club={cup.yourName}
          headline={headline}
          context={CLUB_CUP_NAME}
          titles={folded.allTime.cupTitles}
        />
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

/** Přepínač mezi paralelně běžícím klubem a reprezentací. */
function ModeBar({
  mode,
  onMode,
}: {
  mode: "club" | "nation";
  onMode: (m: "club" | "nation") => void;
}) {
  return (
    <div className="mt-5 flex gap-1.5">
      <Segment active={mode === "club"} onClick={() => onMode("club")}>
        🏟️ Klub
      </Segment>
      <Segment active={mode === "nation"} onClick={() => onMode("nation")}>
        🌐 Reprezentace
      </Segment>
    </div>
  );
}

/** Správa aktivní kariéry: ukončit jen ji, nebo úplný restart od nuly. */
function CareerManagement({
  endLabel,
  onEnd,
  onReset,
}: {
  endLabel: string;
  onEnd: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-3">
      <div className="text-xs font-semibold text-foreground">Správa kariéry</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEnd}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-negative"
        >
          Ukončit {endLabel}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-negative/40 bg-negative/10 px-3 py-1.5 text-xs font-medium text-negative transition hover:bg-negative/15"
        >
          Nová kariéra od nuly
        </button>
      </div>
    </div>
  );
}

/** Overlay výběru nového týmu (klub / reprezentace) – i s aktivní druhou kariérou. */
function PickerScreen({
  mode,
  reputation,
  onBack,
  onStartClub,
  onStartTournament,
  onError,
}: {
  mode: "club" | "nation";
  reputation: number;
  onBack: () => void;
  onStartClub: (
    leagueId: number,
    leagueName: string,
    teams: GameTeam[],
    teamId: number,
    leagueAccess: LeagueAccess | null
  ) => void;
  onStartTournament: (competitionId: CompetitionId, teamId: number) => void;
  onError: (e: string | null) => void;
}) {
  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-muted hover:text-foreground"
      >
        ← Zpět
      </button>
      {mode === "club" ? (
        <NewGameFlow onStart={onStartClub} onError={onError} />
      ) : (
        <NationPicker reputation={reputation} onStart={onStartTournament} />
      )}
    </div>
  );
}
