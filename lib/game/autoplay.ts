import {
  AUTOPLAY_FINALE_ROUNDS,
  AUTOPLAY_FITNESS_FLOOR,
  AUTOPLAY_MAX_ROUNDS,
  AUTOPLAY_RIVAL_RANKS,
  AUTOPLAY_TABLE_WARMUP,
} from "./balance";
import { isSeasonOver, nextOpponentOf, playRound } from "./engine";
import { matchStakes } from "./stakes";
import { buildTable } from "./standings";
import type { SeasonState } from "./types";

/**
 * **Kolo přestává být jednotkou rozhodnutí.**
 *
 * Sezóna má 38 kol a hráč v každém udělá tutéž věc: přečte scouting, klikne plán, klikne
 * instrukci, odehraje. Událost padne jen ve čtvrtině kol, takže tři čtvrtiny jsou čistá
 * obsluha. Appka na to dosud měla jen dvě krajnosti — „Odehrát kolo" (38 kliků) a „Dohrát
 * sezónu" (nula kliků, ale i nula rozhodnutí a přeskočené události).
 *
 * Tohle je ten chybějící střed: **hraj dál, dokud tě hra nepotřebuje.** Zastaví se před
 * kolem, které si o rozhodnutí opravdu říká — a co to je, se pozná z týchž sázek zápasu,
 * které řídí doporučení plánu (`stakes.ts`).
 *
 * **Automatická kola jedou se STÁVAJÍCÍM plánem a instrukcí**, ne s doporučením skautů.
 * Dva důvody:
 * - Kdyby autoplay volil `recommendPlan` z hlášeného stylu, hráč by si jedním klikem
 *   přečetl radu, kterou má jinak až za investici do skautingu (`detailed`) — stačilo by
 *   se podívat, co se v přepínači vybralo.
 * - Takhle je volba poctivý obchod: ušetříš kliky, ale zaplatíš tím, že se protitah
 *   nepřizpůsobí soupeři. Ruční hra zůstává silnější, ne slabší.
 */
export type StopReason =
  | "event" // nevyřešená událost – bez tvé volby se hrát nedá
  | "must_win" // sázky se přiostřily, remíza už nestačí
  | "rival" // přímý konkurent v tabulce, šestibodový zápas
  | "finale" // závěr sezóny, kde se rozhoduje
  | "fitness" // tým je vyčerpaný, stávající plán ho ubíjí
  | "cap" // nic se neděje, jen došel strop kol na jeden klik
  | "season_over"; // není co hrát

export interface AutoplayResult {
  state: SeasonState;
  /** Kolik kol se odehrálo (nejméně 1, nejvýš `AUTOPLAY_MAX_ROUNDS`). */
  rounds: number;
  /** Proč se to zastavilo – UI to hráči řekne, ať neví jen „něco se stalo". */
  reason: StopReason;
}

/** Krátký důvod pro UI. */
export const STOP_REASON_LABEL: Record<StopReason, string> = {
  event: "Čeká na tebe událost",
  must_win: "Přituhuje — tenhle zápas musíš zvládnout",
  rival: "Souboj s přímým konkurentem",
  finale: "Závěr sezóny",
  fitness: "Tým je vyčerpaný — zvaž šetrnější plán",
  cap: "Klidný úsek — zkontroluj plán a pokračuj",
  season_over: "Sezóna je dohraná",
};

/**
 * Potřebuje nadcházející kolo tvoje rozhodnutí? `null` = klidně se odehraje samo.
 *
 * Pořadí je záměrné: událost je blokující (bez volby se hrát nedá), pak přituhující
 * sázky, pak souboj o příčku, závěr sezóny a nakonec kondice.
 */
export function needsYou(state: SeasonState): StopReason | null {
  if (isSeasonOver(state)) return "season_over";
  if (state.pendingEvent) return "event";

  const oppId = nextOpponentOf(state);
  if (oppId === null) return null;

  if (matchStakes(state, oppId).kind === "must_win") return "must_win";

  const roundsLeft = state.schedule.length - state.round;
  if (roundsLeft <= AUTOPLAY_FINALE_ROUNDS) return "finale";

  // Šestibodový zápas: soused v tabulce. Dřív než po pár kolech nemá tabulka výpovědní
  // hodnotu (na nule je pořadí dané id týmu), proto rozjezdové okno.
  if (state.round >= AUTOPLAY_TABLE_WARMUP) {
    const table = buildTable(
      state.teams.map((t) => t.id),
      state.results
    );
    const you = table.find((r) => r.teamId === state.yourTeamId);
    const opp = table.find((r) => r.teamId === oppId);
    if (you && opp && Math.abs(you.rank - opp.rank) <= AUTOPLAY_RIVAL_RANKS) {
      return "rival";
    }
  }

  if (state.fitness < AUTOPLAY_FITNESS_FLOOR) return "fitness";

  return null;
}

/**
 * Odehraje kola stávajícím plánem, dokud si další neřekne o tvé rozhodnutí.
 *
 * Vždycky odehraje **aspoň jedno** kolo (jinak by tlačítko nedělalo nic, když je stop
 * podmínka splněná už teď – tu právě hráč obsluhuje) a nejvýš `AUTOPLAY_MAX_ROUNDS`
 * (aby se hráči neztratila půlka sezóny naslepo).
 *
 * Volající musí mít vyřešenou událost – s `pendingEvent` `playRound` sice funguje, ale
 * hráč by o volbu přišel. UI proto tlačítko při čekající události blokuje, stejně jako
 * u „Odehrát kolo".
 */
export function playUntilDecision(
  state: SeasonState,
  maxRounds: number = AUTOPLAY_MAX_ROUNDS
): AutoplayResult {
  if (isSeasonOver(state)) return { state, rounds: 0, reason: "season_over" };

  let s = playRound(state);
  let rounds = 1;
  let reason = needsYou(s);

  while (reason === null && rounds < maxRounds) {
    s = playRound(s);
    rounds++;
    reason = needsYou(s);
  }

  // Došel strop, ale nic konkrétního se neděje. Vlastní důvod, ať UI nelže o tom,
  // že se něco stalo – hráč jen dostane kontrolní bod.
  return { state: s, rounds, reason: reason ?? "cap" };
}
