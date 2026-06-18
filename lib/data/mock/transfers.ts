import type { ClubTransferBalance, Transfer } from "@/lib/types";
import { computeBalances, type BalanceInput } from "../transferStore";
import { buildTeams } from "./seed";

/**
 * Deterministické mock přestupy, aby záložka Přestupy + bilance fungovaly bez DB/API.
 * Staví je z mock klubů (ligy 39/140). Řádky drží perspektivu klubu (`clubId`) stejně
 * jako real pipeline → bilanci počítá tatáž `computeBalances`.
 */

type MockRow = BalanceInput & {
  playerId: number;
  playerName: string;
  date: string;
  feeEur: number | null;
  season: number;
};

const DAY = 24 * 60 * 60 * 1000;

/** Pár pseudonáhodných, ale stabilních hodnot dle seedu (bez závislosti na RNG modulu). */
function seeded(n: number): number {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}

const FEE_TYPES = ["€ 25M", "Transfer", "Loan", "Back from Loan", "Free", "N/A"];

function mockRows(leagueIds: number[]): MockRow[] {
  const clubs = buildTeams().filter(
    (t) => t.entityType === "CLUB" && leagueIds.includes(t.leagueId)
  );
  const rows: MockRow[] = [];
  clubs.forEach((club, ci) => {
    // 2 příchody + 2 odchody na klub; protistrana = jiný klub téže ligy (cyklicky).
    const peers = clubs.filter((c) => c.leagueId === club.leagueId && c.id !== club.id);
    for (let i = 0; i < 4; i++) {
      const peer = peers[(ci + i) % Math.max(peers.length, 1)] ?? club;
      const isIn = i < 2;
      const type = FEE_TYPES[Math.floor(seeded(club.id + i) * FEE_TYPES.length)];
      const feeMatch = type.match(/(\d+)\s*([MK])?/);
      const feeEur = type.includes("Free")
        ? 0
        : !feeMatch || type.includes("Loan") || type.includes("N/A")
          ? null
          : Number(feeMatch[1]) * (feeMatch[2] === "M" ? 1e6 : feeMatch[2] === "K" ? 1e3 : 1);
      rows.push({
        clubId: club.id,
        clubLeagueId: club.leagueId,
        season: 2025,
        playerId: club.id * 10 + i,
        playerName: `${isIn ? "Příchozí" : "Odchozí"} hráč ${i + 1} (${club.name})`,
        date: new Date(Date.now() - (ci * 4 + i) * DAY).toISOString(),
        type,
        feeEur,
        inTeamId: isIn ? club.id : peer.id,
        inTeamName: isIn ? club.name : peer.name,
        inTeamLogo: isIn ? club.logoUrl : peer.logoUrl,
        outTeamId: isIn ? peer.id : club.id,
        outTeamName: isIn ? peer.name : club.name,
        outTeamLogo: isIn ? peer.logoUrl : club.logoUrl,
      });
    }
  });
  return rows;
}

export function mockLeagueTransfers(leagueIds: number[]): Transfer[] {
  return mockRows(leagueIds)
    .map((r) => ({
      playerId: r.playerId,
      playerName: r.playerName,
      date: r.date,
      type: r.type,
      feeEur: r.feeEur,
      inTeamId: r.inTeamId,
      inTeamName: r.inTeamName,
      inTeamLogo: r.inTeamLogo,
      outTeamId: r.outTeamId,
      outTeamName: r.outTeamName,
      outTeamLogo: r.outTeamLogo,
      leagueId: r.clubLeagueId,
      season: r.season,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function mockClubBalances(leagueIds: number[]): ClubTransferBalance[] {
  return computeBalances(mockRows(leagueIds));
}
