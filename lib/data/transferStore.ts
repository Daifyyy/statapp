import type { Transfer as DbTransfer } from "@prisma/client";
import type {
  ClubTransferBalance,
  Transfer,
  TransferCategory,
  TransferCategoryCounts,
} from "@/lib/types";
import { prisma } from "@/lib/db";
import { transferWindowStart } from "./catalog";

/**
 * Úložiště přestupů nad tabulkou `Transfer` (real DB). Plní ho cron na pozadí
 * (refresh-transfers); záložka i bilance odsud jen ČTOU. Řádek je uložen z perspektivy
 * dotazovaného klubu (`clubId`/`clubLeagueId`) – viz transfers.ts.
 */

/** Payload k upsertu (bez `id`/`fetchedAt`, ty se dopočítají). */
export type TransferUpsert = {
  clubId: number;
  clubLeagueId: number;
  season: number;
  playerId: number;
  playerName: string;
  date: string; // ISO
  type: string | null;
  feeEur: number | null;
  inTeamId: number | null;
  inTeamName: string | null;
  inTeamLogo: string | null;
  outTeamId: number | null;
  outTeamName: string | null;
  outTeamLogo: string | null;
};

/** Deterministické id (přirozený klíč z perspektivy klubu) – idempotentní upsert. */
function transferId(r: TransferUpsert): string {
  return `${r.clubId}:${r.playerId}:${r.date}:${r.inTeamId ?? 0}:${r.outTeamId ?? 0}`;
}

export async function upsertTransfer(row: TransferUpsert): Promise<void> {
  const data = { ...row, date: new Date(row.date), fetchedAt: new Date() };
  const id = transferId(row);
  await prisma.transfer.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
}

function toTransfer(p: DbTransfer): Transfer {
  return {
    playerId: p.playerId,
    playerName: p.playerName,
    date: p.date.toISOString(),
    type: p.type,
    category: classifyTransfer(p.type),
    feeEur: p.feeEur,
    inTeamId: p.inTeamId,
    inTeamName: p.inTeamName,
    inTeamLogo: p.inTeamLogo,
    outTeamId: p.outTeamId,
    outTeamName: p.outTeamName,
    outTeamLogo: p.outTeamLogo,
    leagueId: p.clubLeagueId,
    season: p.season,
  };
}

/** Klíč pro dedup řádků uložených z více perspektiv (přestup mezi dvěma top-5 kluby). */
function naturalKey(t: Transfer): string {
  return `${t.playerId}:${t.date}:${t.inTeamId ?? 0}:${t.outTeamId ?? 0}`;
}

/** Aktuální přestupy vybraných lig (řazeno nejnovější první, deduplikováno pro zobrazení). */
export async function getLeagueTransfers(
  leagueIds: number[],
  limit = 200
): Promise<Transfer[]> {
  const rows = await prisma.transfer.findMany({
    where: {
      clubLeagueId: { in: leagueIds },
      date: { gte: transferWindowStart() }, // jen aktuální přestupové okno
    },
    orderBy: { date: "desc" },
  });
  const seen = new Set<string>();
  const out: Transfer[] = [];
  for (const r of rows) {
    const t = toTransfer(r);
    const k = naturalKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Zařadí přestup do kategorie z volného textu `type` (API peněžní částky prakticky nedává).
 * Pořadí kontrol je důležité: návrat z hostování dřív než hostování; „free" dřív než
 * „transfer" (kvůli „Free Transfer"). Čistá funkce – testovaná.
 */
export function classifyTransfer(type: string | null | undefined): TransferCategory {
  if (!type) return "other";
  const s = type.toLowerCase();
  if (s.includes("back from loan") || s.includes("return") || s.includes("end of loan"))
    return "loanReturn";
  if (s.includes("loan")) return "loan";
  if (s.includes("free")) return "free";
  if (s.includes("transfer") || /[€$£]|\d/.test(s)) return "permanent";
  return "other";
}

function emptyCounts(): TransferCategoryCounts {
  return { permanent: 0, loan: 0, loanReturn: 0, free: 0, other: 0 };
}

/** Minimální tvar řádku pro agregaci bilance (kvůli čisté funkci / testu). */
export type BalanceInput = Pick<
  DbTransfer,
  | "clubId"
  | "clubLeagueId"
  | "type"
  | "inTeamId"
  | "inTeamName"
  | "inTeamLogo"
  | "outTeamId"
  | "outTeamName"
  | "outTeamLogo"
>;

/**
 * Agregace bilance per klub z řádků (perspektiva klubu: každý řádek patří `clubId`).
 * in-strana = příchod, out-strana = odchod; navíc rozpad po kategoriích (`classifyTransfer`).
 * Čistá funkce. Řadí dle celkové aktivity (nejvíc přestupů první).
 */
export function computeBalances(rows: BalanceInput[]): ClubTransferBalance[] {
  const byClub = new Map<number, ClubTransferBalance>();
  for (const r of rows) {
    const isIn = r.inTeamId === r.clubId;
    const name = (isIn ? r.inTeamName : r.outTeamName) ?? `Tým ${r.clubId}`;
    const logo = (isIn ? r.inTeamLogo : r.outTeamLogo) ?? null;
    let b = byClub.get(r.clubId);
    if (!b) {
      b = {
        teamId: r.clubId,
        teamName: name,
        teamLogo: logo,
        leagueId: r.clubLeagueId,
        inCount: 0,
        outCount: 0,
        inByCategory: emptyCounts(),
        outByCategory: emptyCounts(),
      };
      byClub.set(r.clubId, b);
    }
    const cat = classifyTransfer(r.type);
    if (isIn) {
      b.inCount++;
      b.inByCategory[cat]++;
    } else {
      b.outCount++;
      b.outByCategory[cat]++;
    }
  }
  return [...byClub.values()].sort(
    (a, b) => b.inCount + b.outCount - (a.inCount + a.outCount)
  );
}

/** Bilance přestupů klubů vybraných lig (čte DB, agreguje přes computeBalances). */
export async function getClubBalances(
  leagueIds: number[]
): Promise<ClubTransferBalance[]> {
  const rows = await prisma.transfer.findMany({
    where: {
      clubLeagueId: { in: leagueIds },
      date: { gte: transferWindowStart() }, // jen aktuální přestupové okno
    },
    select: {
      clubId: true,
      clubLeagueId: true,
      type: true,
      inTeamId: true,
      inTeamName: true,
      inTeamLogo: true,
      outTeamId: true,
      outTeamName: true,
      outTeamLogo: true,
    },
  });
  return computeBalances(rows);
}

/** Smaže přestupy starší než dané datum (předchozí okna) – „nahrazení" po startu okna. */
export async function pruneTransfersBefore(windowStartMs: number): Promise<number> {
  const res = await prisma.transfer.deleteMany({
    where: { date: { lt: new Date(windowStartMs) } },
  });
  return res.count;
}
