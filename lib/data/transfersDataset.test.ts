import { describe, it, expect } from "vitest";
import { parseCsv, rowsFromCsv } from "./transfersDataset";

describe("parseCsv (RFC4180)", () => {
  it("parsuje běžné řádky", () => {
    const out = parseCsv("a,b,c\n1,2,3\n");
    expect(out).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });
  it("zvládne uvozovky, čárky a uvozovky uvnitř", () => {
    const out = parseCsv('name,note\n"Doe, John","say ""hi"""\n');
    expect(out[1]).toEqual(["Doe, John", 'say "hi"']);
  });
  it("zvládne nové řádky uvnitř pole", () => {
    const out = parseCsv('x\n"line1\nline2"\n');
    expect(out[1]).toEqual(["line1\nline2"]);
  });
});

describe("rowsFromCsv", () => {
  // hlavička dle TM datasetu
  const header = [
    "player_id",
    "transfer_date",
    "transfer_season",
    "from_club_id",
    "to_club_id",
    "from_club_name",
    "to_club_name",
    "transfer_fee",
    "market_value_in_eur",
    "player_name",
  ];
  const idx: Record<string, number> = {};
  header.forEach((h, i) => (idx[h] = i));

  // Arsenal (TM 11 → api 42), Real Madrid (TM 418 → api 541); cizí klub TM 9999.
  it("vytvoří řádek z perspektivy našeho klubu (příchod) s cenou", () => {
    // Real Madrid (418) prodává hráče do Arsenalu (11) za 50M
    const cols = [
      "7",
      "2026-01-15",
      "25/26",
      "418",
      "11",
      "Real Madrid",
      "Arsenal",
      "50000000.000",
      "60000000.000",
      "Test Player",
    ];
    const out = rowsFromCsv(cols, idx);
    // oba kluby jsou naše → dva řádky (perspektiva Arsenalu i Realu)
    expect(out).toHaveLength(2);
    const arsenal = out.find((r) => r.clubId === 42)!;
    expect(arsenal.clubLeagueId).toBe(39);
    expect(arsenal.feeEur).toBe(50_000_000);
    expect(arsenal.marketValueEur).toBe(60_000_000);
    expect(arsenal.inTeamId).toBe(42); // přišel do Arsenalu
    expect(arsenal.type).toBe("Transfer"); // fee>0 → permanent
  });

  it("ignoruje přestup bez našeho klubu", () => {
    const cols = ["7", "2026-01-15", "25/26", "9999", "8888", "X", "Y", "0.000", "", "P"];
    expect(rowsFromCsv(cols, idx)).toHaveLength(0);
  });

  it("fee 0 → feeEur null a type null (other)", () => {
    const cols = ["7", "2026-01-15", "25/26", "9999", "11", "X", "Arsenal", "0.000", "", "P"];
    const [r] = rowsFromCsv(cols, idx);
    expect(r.feeEur).toBeNull();
    expect(r.type).toBeNull();
  });
});
