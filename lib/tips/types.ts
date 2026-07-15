import type { PickMarket } from "@/lib/types";

/**
 * Tvary pro záložku „Tipovačka" – osobní tréninkový deník tipů (paper-trading).
 * Na zdroji nezávislé (jako `lib/picks/`): DB řádek `UserTip` i mock tečou stejným
 * jádrem (`settleTip`, `computeTipStats`).
 */

/** Trh tipu (sdílený slovník s predikčními tipy). */
export type TipMarket = PickMarket; // "win" | "over25" | "btts"

/** Strana tipu. Relevantní hodnoty dle trhu:
 *  win → home|draw|away, over25 → over|under, btts → yes|no. */
export type TipSelection =
  | "home"
  | "draw"
  | "away"
  | "over"
  | "under"
  | "yes"
  | "no";

/** Source-agnostic tvar jednoho uloženého tipu (DB `UserTip` → tenhle tvar). */
export interface TipRow {
  id: string;
  fixtureId: number;
  leagueId: number;
  leagueName: string;
  kickoff: string; // ISO 8601
  homeTeamId: number;
  awayTeamId: number;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  national: boolean;
  market: TipMarket;
  selection: TipSelection;
  line: number | null; // pro over/under (MVP vždy 2.5)
  stake: number; // jednotky (flat = 1)
  note: string | null;
  // Kurz je při tipování SKRYTÝ; snapshotuje se na pozadí a odhalí se u vyhodnocení.
  odds: number | null; // null = kurz nebyl k dispozici → tip se počítá do úspěšnosti, ne do ROI
  oddsBook: string | null;
  // Výsledek (doplní settle po odehrání)
  status: string; // "NS" | "FT" | "AET" | "PEN" | …
  homeGoals: number | null;
  awayGoals: number | null;
  hit: boolean | null; // null = zatím nevyhodnoceno
  placedAt: string; // ISO 8601
  settledAt: string | null; // ISO 8601
}
