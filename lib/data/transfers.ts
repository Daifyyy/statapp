import { getTeamsByLeague } from "./repository";
import { fetchTeamTransfers, type ApiTransferPlayer } from "./apiFootball";
import { CURRENT_SEASON } from "./catalog";
import { upsertTransfer, type TransferUpsert } from "./transferStore";
import { logError } from "@/lib/logError";

/**
 * Orchestrace přestupů (běží jen na pozadí / cron, real data). `/transfers` neumí
 * filtr podle ligy → iterujeme přes všechny týmy top-5 lig (~20×5 ≈ 100 volání), proto
 * NIKDY ne živě per request. Záložka i bilance jen ČTOU z DB (transferStore).
 *
 * Řádek se ukládá **z perspektivy dotazovaného klubu** (`clubId`/`clubLeagueId`): tím je
 * agregace bilance per klub jednoznačná a filtr podle ligy spolehlivý i u přestupů mezi
 * dvěma top-5 kluby (uloží se z obou perspektiv, list se dedupuje při zobrazení).
 */

/** Sledované klubové ligy pro přestupy (Top-5; sdílí seznam s predikcemi). */
export const TRANSFER_LEAGUES = [39, 140, 135, 78, 61];

/** Začátek aktuálního přestupního okna = start aktuální sezóny (API: season = rok startu). */
function seasonStartMs(season: number): number {
  return Date.UTC(season, 6, 1); // 1. července
}

/**
 * Best-effort převod volného textu `type` z API na částku v EUR.
 * `"€ 20M"→20_000_000`, `"€500K"→500_000`, `"Free"→0`, `"Loan"/"N/A"/null/nečíselné → null`.
 * Čistá funkce – testovaná samostatně. Měna se ignoruje (API uvádí převážně €).
 */
export function parseTransferFee(type: string | null | undefined): number | null {
  if (!type) return null;
  const s = type.trim().toLowerCase();
  if (!s || s === "n/a" || s === "-" || s === "?") return null;
  if (s.includes("free")) return 0; // přestup zdarma = známá nula
  if (s.includes("loan")) return null; // hostování – částka pro bilanci neznámá
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*([mk])?/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(num)) return null;
  const mult = m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1;
  return num * mult;
}

/**
 * Z odpovědi `/transfers` pro jeden klub vybere přestupy v aktuálním okně, kterých se
 * klub účastní (přišel/odešel), a převede na řádky k upsertu (perspektiva klubu).
 */
export function buildClubTransferRows(
  clubId: number,
  clubLeagueId: number,
  season: number,
  players: ApiTransferPlayer[],
  windowStartMs = seasonStartMs(season)
): TransferUpsert[] {
  const rows: TransferUpsert[] = [];
  for (const p of players) {
    for (const t of p.transfers) {
      const ts = t.date ? Date.parse(t.date) : NaN;
      if (!Number.isFinite(ts) || ts < windowStartMs) continue;
      const inId = t.teams?.in?.id ?? null;
      const outId = t.teams?.out?.id ?? null;
      if (inId !== clubId && outId !== clubId) continue; // přestup jiných klubů
      rows.push({
        clubId,
        clubLeagueId,
        season,
        playerId: p.player.id,
        playerName: p.player.name,
        date: new Date(ts).toISOString(),
        type: t.type ?? null,
        feeEur: parseTransferFee(t.type),
        inTeamId: inId,
        inTeamName: t.teams?.in?.name ?? null,
        inTeamLogo: t.teams?.in?.logo ?? null,
        outTeamId: outId,
        outTeamName: t.teams?.out?.name ?? null,
        outTeamLogo: t.teams?.out?.logo ?? null,
      });
    }
  }
  return rows;
}

/**
 * Stáhne a uloží přestupy top-5 lig (idempotentní upsert). `leagueIds` umožní ruční/dávkový
 * běh jedné ligy (`?league=ID`). Výpadek jednoho klubu/ligy nezastaví ostatní.
 */
export async function runRefreshTransfers(
  leagueIds: number[] = TRANSFER_LEAGUES
): Promise<{ leagues: number; clubs: number; transfers: number }> {
  const season = CURRENT_SEASON;
  let clubs = 0;
  let transfers = 0;
  for (const leagueId of leagueIds) {
    let teams;
    try {
      teams = await getTeamsByLeague(leagueId);
    } catch {
      continue;
    }
    for (const team of teams) {
      clubs++;
      try {
        const players = await fetchTeamTransfers(team.id);
        const rows = buildClubTransferRows(team.id, leagueId, season, players);
        for (const row of rows) {
          await upsertTransfer(row);
          transfers++;
        }
      } catch (e) {
        logError("transfers/refresh", e, { team: team.id, leagueId });
        // přeskoč problémový klub, pokračuj dál
      }
    }
  }
  return { leagues: leagueIds.length, clubs, transfers };
}
