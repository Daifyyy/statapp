import { describe, it, expect } from "vitest";
import { parseTransferFee, buildClubTransferRows } from "./transfers";
import { computeBalances, classifyTransfer, type BalanceInput } from "./transferStore";
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

describe("classifyTransfer", () => {
  it("zařadí typy do kategorií (pořadí: návrat > loan > free > permanent)", () => {
    expect(classifyTransfer("Transfer")).toBe("permanent");
    expect(classifyTransfer("€ 2.8M")).toBe("permanent");
    expect(classifyTransfer("Loan")).toBe("loan");
    expect(classifyTransfer("Back from Loan")).toBe("loanReturn");
    expect(classifyTransfer("Return from loan")).toBe("loanReturn");
    expect(classifyTransfer("Free agent")).toBe("free");
    expect(classifyTransfer("Free Transfer")).toBe("free"); // free před transfer
    expect(classifyTransfer("N/A")).toBe("other");
    expect(classifyTransfer("-")).toBe("other");
    expect(classifyTransfer(null)).toBe("other");
  });
});

describe("computeBalances", () => {
  function row(over: Partial<BalanceInput> & Pick<BalanceInput, "type">): BalanceInput {
    return {
      clubId: 100,
      clubLeagueId: 39,
      inTeamId: 100,
      inTeamName: "Klub A",
      inTeamLogo: "a.png",
      outTeamId: 200,
      outTeamName: "Klub B",
      outTeamLogo: "b.png",
      ...over,
    };
  }
  const rows: BalanceInput[] = [
    row({ type: "Transfer" }), // příchod trvalý
    row({ type: "Loan" }), // příchod hostování
    // odchod trvalý (klub 100 je out)
    row({ type: "Transfer", inTeamId: 300, inTeamName: "Klub C", outTeamId: 100, outTeamName: "Klub A" }),
  ];

  it("agreguje počty IN/OUT i kategorie z perspektivy clubId", () => {
    const [b] = computeBalances(rows);
    expect(b).toMatchObject({
      teamId: 100,
      teamName: "Klub A",
      inCount: 2,
      outCount: 1,
    });
    expect(b.inByCategory.permanent).toBe(1);
    expect(b.inByCategory.loan).toBe(1);
    expect(b.outByCategory.permanent).toBe(1);
  });
});
