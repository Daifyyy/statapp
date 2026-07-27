import { describe, expect, it } from "vitest";
import {
  CLUB_LEAGUES,
  PROGRAM_CLUB_LEAGUE_IDS,
  dayOfYear,
  rotateLeagues,
} from "./catalog";

describe("rotateLeagues", () => {
  const ids = [1, 2, 3, 4, 5];

  it("nultý den nemění pořadí", () => {
    expect(rotateLeagues(ids, 0)).toEqual(ids);
  });

  it("posouvá začátek podle dne a nic neztrácí", () => {
    expect(rotateLeagues(ids, 2)).toEqual([3, 4, 5, 1, 2]);
    expect(rotateLeagues(ids, 7)).toEqual([3, 4, 5, 1, 2]); // 7 % 5 === 2
    for (let d = 0; d < 12; d++) {
      expect([...rotateLeagues(ids, d)].sort()).toEqual([...ids].sort());
    }
  });

  it("za jeden cyklus dní dostane každá liga první místo", () => {
    const first = new Set(ids.map((_, d) => rotateLeagues(ids, d)[0]));
    expect(first).toEqual(new Set(ids));
  });

  it("zvládne prázdný seznam i záporný den", () => {
    expect(rotateLeagues([], 3)).toEqual([]);
    expect(rotateLeagues(ids, -1)).toEqual([5, 1, 2, 3, 4]);
  });
});

describe("dayOfYear", () => {
  it("počítá od 1", () => {
    expect(dayOfYear(new Date("2026-01-01T12:00:00Z"))).toBe(1);
    expect(dayOfYear(new Date("2026-02-01T00:00:00Z"))).toBe(32);
  });

  it("sousední dny se liší o 1 (jinak by rotace přeskakovala)", () => {
    const a = dayOfYear(new Date("2026-07-26T23:59:00Z"));
    const b = dayOfYear(new Date("2026-07-27T00:01:00Z"));
    expect(b - a).toBe(1);
  });
});

describe("rozsahy lig", () => {
  // Program staví deep-linky do Porovnání, které umí jen ligy z katalogu.
  it("PROGRAM_CLUB_LEAGUE_IDS je podmnožina CLUB_LEAGUES", () => {
    const known = new Set(CLUB_LEAGUES.map((l) => l.id));
    for (const id of PROGRAM_CLUB_LEAGUE_IDS) expect(known.has(id)).toBe(true);
  });
});
