// Rozhraní, na kterém stojí celá manažerská agency (plán × counter × instrukce × morálka ×
// kondice × eventy). Záměrně NEZNÁ ligu: žádný rozpis, tabulka, sezónní cíl ani rozvoj klubu.
//
// Díky tomu jde tatáž agency použít i mimo ligovou sezónu (reprezentační turnaj: skupiny +
// pavouk). `SeasonState` je strukturálně nadmnožina `AgencyState`, takže ligový kód se
// nemění a `resolveAdjust(state, …)` funguje dál beze změny.
//
// Pozn. k názvu: `MatchContext` je už obsazený v `lib/data/cache.ts`
// (`"league" | "euro" | "national"`), proto `Agency*`.

import type {
  GameTeam,
  Instruction,
  MatchResult,
  Modifier,
  PendingEvent,
  Plan,
} from "./types";

/**
 * Oddělené RNG proudy pro režimy hry – jinak by turnaj se stejným `seed` a `round` dostal
 * identické eventy i scoutské omyly jako liga.
 */
export const RNG_SALT_LEAGUE = 0;
export const RNG_SALT_TOURNAMENT = 1_000_000;
/**
 * Kvalifikace běží pod stejným `seed` jako závěrečný turnaj (jeden `TournamentRun`), ale
 * je to samostatný `AgencyState` s vlastními koly 0…N. Bez odděleného proudu by kvalifikační
 * kolo 0 a turnajové kolo 0 dostaly identický RNG (eventy i výsledky by korelovaly).
 */
export const RNG_SALT_QUALIFICATION = 2_000_000;

/** Všechno, co agency potřebuje ke stanovení λ tvého týmu a k losu eventů. */
export interface AgencyState {
  seed: number;
  /**
   * GLOBÁLNĚ monotonní index odehraného zápasu. Nesmí se resetovat mezi fázemi (skupina →
   * pavouk), jinak by `modifiers[].untilRound` z poslední skupinové fáze přežily celý pavouk
   * a `scoutBoostUntilRound` by se znovu „zapnul".
   */
  round: number;
  /** `RNG_SALT_LEAGUE` / `RNG_SALT_TOURNAMENT`. */
  rngSalt: number;

  /** Referenční populace pro normalizaci stylu soupeře (liga = 20 klubů, turnaj = pole). */
  teams: GameTeam[];
  yourTeamId: number;
  /** Odehrané zápasy – zdroj formy a čistých kont (`form.ts`). */
  results: MatchResult[];

  morale: number;
  fitness: number;
  modifiers: Modifier[];
  scoutBoostUntilRound: number | null;
  plan: Plan;
  instruction: Instruction;
  pendingEvent: PendingEvent | null;

  /** Kariérní pole – v turnaji chybí, eventy a scouting je čtou přes `?? 0`. */
  youth?: number;
  devBonus?: number;
  /** Investice do skautského oddělení – zvedá konfidenci hlášení (`scoutConfidence`). */
  scouting?: number;
}

/**
 * Kontext pro podmínky eventů. Přidává jedinou informaci, kterou agency potřebuje z rozpisu:
 * kdo je příští soupeř.
 *
 * `nextOpponentId` se **záměrně neukládá do stavu** – je odvozený (liga ze `schedule[round]`,
 * turnaj z pavouka) a uložená kopie by se mohla rozejít. Skládá ho volající (`maybeEvent`).
 */
export interface EventContext extends AgencyState {
  nextOpponentId: number | null;
}
