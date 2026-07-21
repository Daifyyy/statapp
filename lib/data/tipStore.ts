import type { UserTip } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TipMarket, TipRow, TipSelection } from "@/lib/tips/types";

/**
 * Úložiště osobních tipů nad tabulkou `UserTip` (real DB, funguje kdykoli je
 * DATABASE_URL – nezávisí na mock/real API režimu, stejně jako `GameSave`/oblíbené).
 * Vkládá route `/api/tips` (se snapshotem kurzu), výsledek doplní cron `settle-tips`.
 */

function toRow(t: UserTip): TipRow {
  return {
    id: t.id,
    fixtureId: t.fixtureId,
    leagueId: t.leagueId,
    leagueName: t.leagueName,
    kickoff: t.kickoff.toISOString(),
    homeTeamId: t.homeTeamId,
    awayTeamId: t.awayTeamId,
    homeName: t.homeName,
    awayName: t.awayName,
    homeLogo: t.homeLogo,
    awayLogo: t.awayLogo,
    national: t.national,
    market: t.market as TipMarket,
    selection: t.selection as TipSelection,
    line: t.line,
    stake: t.stake,
    note: t.note,
    odds: t.odds,
    oddsBook: t.oddsBook,
    status: t.status,
    homeGoals: t.homeGoals,
    awayGoals: t.awayGoals,
    hit: t.hit,
    placedAt: t.placedAt.toISOString(),
    settledAt: t.settledAt?.toISOString() ?? null,
  };
}

/**
 * Všechny tipy uživatele (nejnovější dle vložení první). Vlastnictví běží přes **e-mail**
 * (stabilní přes re-login i reset `User` řádku), ne přes `userId`.
 */
export async function getUserTips(email: string): Promise<TipRow[]> {
  const rows = await prisma.userTip.findMany({
    where: { email },
    orderBy: { placedAt: "desc" },
  });
  return rows.map(toRow);
}

/** Snapshot zápasu + příležitosti pro vložení tipu (kurz se dotahuje v route). */
export interface TipInput {
  fixtureId: number;
  leagueId: number;
  leagueName: string;
  kickoff: string; // ISO
  homeTeamId: number;
  awayTeamId: number;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  national: boolean;
  market: TipMarket;
  selection: TipSelection;
  line: number | null;
  note: string | null;
  odds: number | null;
  oddsBook: string | null;
}

/**
 * Vloží/přepíše tip uživatele na daný trh a zápas (upsert dle
 * `@@unique([email, fixtureId, market])` → jeden tip na trh a zápas). Vlastnictví je
 * `email`; `userId` je jen volitelná reference na aktuální účet (obnoví se při re-tipu).
 */
export async function upsertTip(
  email: string,
  userId: string | null,
  input: TipInput
): Promise<TipRow> {
  const data = {
    userId,
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    kickoff: new Date(input.kickoff),
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    homeName: input.homeName,
    awayName: input.awayName,
    homeLogo: input.homeLogo,
    awayLogo: input.awayLogo,
    national: input.national,
    selection: input.selection,
    line: input.line,
    note: input.note,
    odds: input.odds,
    oddsBook: input.oddsBook,
    oddsAt: input.odds != null ? new Date() : null,
  };
  const row = await prisma.userTip.upsert({
    where: {
      email_fixtureId_market: { email, fixtureId: input.fixtureId, market: input.market },
    },
    create: { email, fixtureId: input.fixtureId, market: input.market, ...data },
    // Přepíše jen predikční část; výsledek (status/goals/hit) necháváme být.
    update: data,
  });
  return toRow(row);
}

/** Počet otevřených (nevyhodnocených) tipů uživatele – strop proti spamu. */
export async function countOpenTips(email: string): Promise<number> {
  return prisma.userTip.count({ where: { email, status: "NS" } });
}

/** Smaže vlastní NEvyhodnocený tip. Vrací true, když se něco smazalo. */
export async function deleteOpenTip(email: string, id: string): Promise<boolean> {
  const res = await prisma.userTip.deleteMany({
    where: { id, email, status: "NS" },
  });
  return res.count > 0;
}

/**
 * Modelový 1X2 tip (argmax pravděpodobnosti) pro dané zápasy z `FixturePrediction` –
 * pro srovnání „ty vs model" u vyhodnocených tipů. Jen zápasy, kde model predikci má.
 */
export async function getModelPickMap(
  fixtureIds: number[]
): Promise<Map<number, "home" | "draw" | "away">> {
  const map = new Map<number, "home" | "draw" | "away">();
  if (fixtureIds.length === 0) return map;
  const rows = await prisma.fixturePrediction.findMany({
    where: { fixtureId: { in: fixtureIds }, available: true },
    select: { fixtureId: true, homeWin: true, draw: true, awayWin: true },
  });
  for (const r of rows) {
    const pick =
      r.homeWin >= r.draw && r.homeWin >= r.awayWin
        ? "home"
        : r.awayWin >= r.draw
          ? "away"
          : "draw";
    map.set(r.fixtureId, pick);
  }
  return map;
}
