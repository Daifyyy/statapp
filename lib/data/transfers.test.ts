import { describe, it, expect } from "vitest";
import { parseTransferFee, buildClubTransferRows } from "./transfers";
import { computeBalances, classifyTransfer, type BalanceInput } from "./transferStore";
import { transferWindowStart } from "./catalog";
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
    // explicitní start okna (1. 7. 2025) → 2024 mimo, 2025-09 jiný klub
    const windowStart = Date.UTC(2025, 6, 1);
    const rows = buildClubTransferRows(100, 39, 2025, [player], windowStart);
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
      feeEur: null,
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
    row({ type: "Transfer", feeEur: 10_000_000 }), // příchod placený
    row({ type: "Loan", feeEur: null }), // příchod bez ceny
    // odchod placený (klub 100 je out)
    row({
      type: "Transfer",
      feeEur: 4_000_000,
      inTeamId: 300,
      inTeamName: "Klub C",
      outTeamId: 100,
      outTeamName: "Klub A",
    }),
  ];

  it("agreguje počty IN/OUT i peněžní bilanci z perspektivy clubId", () => {
    const [b] = computeBalances(rows);
    expect(b).toMatchObject({
      teamId: 100,
      teamName: "Klub A",
      inCount: 2,
      outCount: 1,
      spendEur: 10_000_000,
      earnEur: 4_000_000,
      netEur: -6_000_000,
      knownFeeCount: 2, // loan bez ceny se nepočítá
    });
    // kategorie se počítají dál (dead code pro návrat)
    expect(b.inByCategory.permanent).toBe(1);
    expect(b.inByCategory.loan).toBe(1);
  });
});

describe("transferWindowStart", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  it("zima (leden–červen) → 1. 1. téhož roku", () => {
    expect(iso(transferWindowStart(new Date("2026-06-18T12:00:00Z")))).toBe("2026-01-01");
    expect(iso(transferWindowStart(new Date("2026-02-15T00:00:00Z")))).toBe("2026-01-01");
  });
  it("léto (červenec–prosinec) → 1. 7. téhož roku", () => {
    expect(iso(transferWindowStart(new Date("2026-07-01T00:00:00Z")))).toBe("2026-07-01");
    expect(iso(transferWindowStart(new Date("2026-09-10T00:00:00Z")))).toBe("2026-07-01");
    expect(iso(transferWindowStart(new Date("2026-12-31T23:00:00Z")))).toBe("2026-07-01");
  });
});
