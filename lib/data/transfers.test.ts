import { describe, it, expect } from "vitest";
import { parseTransferFee, buildClubTransferRows } from "./transfers";
import { computeBalances, type BalanceInput } from "./transferStore";
import type { ApiTransferPlayer } from "./apiFootball";

describe("parseTransferFee", () => {
  it("parsuje miliony a tisíce", () => {
    expect(parseTransferFee("€ 20M")).toBe(20_000_000);
    expect(parseTransferFee("€20M")).toBe(20_000_000);
    expect(parseTransferFee("€ 500K")).toBe(500_000);
    expect(parseTransferFee("12.5M")).toBe(12_500_000);
  });
  it("Free = 0, Loan/N/A/null = neznámé", () => {
    expect(parseTransferFee("Free")).toBe(0);
    expect(parseTransferFee("Loan")).toBeNull();
    expect(parseTransferFee("N/A")).toBeNull();
    expect(parseTransferFee(null)).toBeNull();
    expect(parseTransferFee("")).toBeNull();
  });
});

describe("buildClubTransferRows", () => {
  const player: ApiTransferPlayer = {
    player: { id: 7, name: "Hráč" },
    transfers: [
      {
        date: "2025-08-01",
        type: "€ 10M",
        teams: {
          in: { id: 100, name: "Klub A", logo: "a.png" },
          out: { id: 200, name: "Klub B", logo: "b.png" },
        },
      },
      {
        // mimo okno (před startem sezóny 2025 = 2025-07-01)
        date: "2024-01-01",
        type: "€ 5M",
        teams: { in: { id: 100, name: "Klub A" }, out: { id: 300, name: "Klub C" } },
      },
      {
        // netýká se klubu 100
        date: "2025-09-01",
        type: "€ 1M",
        teams: { in: { id: 400, name: "X" }, out: { id: 500, name: "Y" } },
      },
    ],
  };

  it("vybere jen přestupy v okně, kterých se klub účastní", () => {
    const rows = buildClubTransferRows(100, 39, 2025, [player]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clubId: 100,
      clubLeagueId: 39,
      playerId: 7,
      feeEur: 10_000_000,
      inTeamId: 100,
      outTeamId: 200,
    });
  });
});

describe("computeBalances", () => {
  const rows: BalanceInput[] = [
    // Klub 100: 1 příchod za 10M
    {
      clubId: 100,
      clubLeagueId: 39,
      feeEur: 10_000_000,
      inTeamId: 100,
      inTeamName: "Klub A",
      inTeamLogo: "a.png",
      outTeamId: 200,
      outTeamName: "Klub B",
      outTeamLogo: "b.png",
    },
    // Klub 100: 1 odchod za 4M
    {
      clubId: 100,
      clubLeagueId: 39,
      feeEur: 4_000_000,
      inTeamId: 300,
      inTeamName: "Klub C",
      inTeamLogo: null,
      outTeamId: 100,
      outTeamName: "Klub A",
      outTeamLogo: "a.png",
    },
    // Klub 100: 1 příchod s neznámou částkou (loan)
    {
      clubId: 100,
      clubLeagueId: 39,
      feeEur: null,
      inTeamId: 100,
      inTeamName: "Klub A",
      inTeamLogo: "a.png",
      outTeamId: 600,
      outTeamName: "Klub D",
      outTeamLogo: null,
    },
  ];

  it("agreguje počty a částky per klub z perspektivy clubId", () => {
    const [b] = computeBalances(rows);
    expect(b).toMatchObject({
      teamId: 100,
      teamName: "Klub A",
      inCount: 2,
      outCount: 1,
      spendEur: 10_000_000,
      earnEur: 4_000_000,
      netEur: -6_000_000,
      knownFeeCount: 2, // loan se do známých nepočítá
    });
  });
});
