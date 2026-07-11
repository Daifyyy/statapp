import { describe, it, expect } from "vitest";
import {
  deriveLeagueAccess,
  normalizeLeagueTable,
  pickTeamStanding,
  zoneFromDescription,
} from "./standings";
import type { ApiStandingRow } from "./apiFootball";

function row(
  id: number,
  rank: number,
  over: Partial<ApiStandingRow> = {}
): ApiStandingRow {
  return {
    rank,
    team: { id, name: `T${id}`, logo: "" },
    points: rank === 1 ? 40 : 20,
    goalsDiff: 5,
    form: "WWDLW",
    all: { played: 10, win: 6, draw: 2, lose: 2, goals: { for: 18, against: 10 } },
    home: { played: 5, win: 4, draw: 1, lose: 0, goals: { for: 12, against: 4 } },
    away: { played: 5, win: 2, draw: 1, lose: 2, goals: { for: 6, against: 6 } },
    ...over,
  };
}

describe("pickTeamStanding", () => {
  it("vybere řádek daného týmu a normalizuje splity", () => {
    const out = pickTeamStanding([row(1, 1), row(2, 5)], 2);
    expect(out).toEqual({
      rank: 5,
      points: 20,
      goalsDiff: 5,
      form: "WWDLW",
      all: { played: 10, win: 6, draw: 2, lose: 2, goalsFor: 18, goalsAgainst: 10 },
      home: { played: 5, win: 4, draw: 1, lose: 0, goalsFor: 12, goalsAgainst: 4 },
      away: { played: 5, win: 2, draw: 1, lose: 2, goalsFor: 6, goalsAgainst: 6 },
    });
  });

  it("tým mimo tabulku → null", () => {
    expect(pickTeamStanding([row(1, 1)], 99)).toBeNull();
  });

  it("chybějící číselná pole i splity doplní na 0 / null form", () => {
    const bare: ApiStandingRow = { rank: 3, team: { id: 7, name: "T7", logo: "" } };
    const out = pickTeamStanding([bare], 7);
    expect(out).toEqual({
      rank: 3,
      points: 0,
      goalsDiff: 0,
      form: null,
      all: { played: 0, win: 0, draw: 0, lose: 0, goalsFor: 0, goalsAgainst: 0 },
      home: { played: 0, win: 0, draw: 0, lose: 0, goalsFor: 0, goalsAgainst: 0 },
      away: { played: 0, win: 0, draw: 0, lose: 0, goalsFor: 0, goalsAgainst: 0 },
    });
  });
});

describe("zoneFromDescription", () => {
  it("klasifikuje evropské poháry, postup a sestup podle popisu", () => {
    expect(zoneFromDescription("Promotion - Champions League (Group Stage)")).toBe("champions");
    expect(zoneFromDescription("Promotion - Europa League (Qualification)")).toBe("europa");
    expect(zoneFromDescription("Promotion - Conference League (Play Offs)")).toBe("conference");
    expect(zoneFromDescription("Promotion - Championship")).toBe("promotion");
    expect(zoneFromDescription("Relegation - Championship")).toBe("relegation");
  });

  it("baráž, fázový split a domácí play-off o Evropu nejsou zóna (null)", () => {
    // Baráž (ne jistý sestup) + fázový split nadstavby.
    expect(zoneFromDescription("Relegation Play-offs")).toBeNull();
    expect(zoneFromDescription("Relegation Round")).toBeNull();
    // Soutěž se hledá jen před závorkou – domácí play-off o Evropu nese vlastní ligu.
    expect(zoneFromDescription("Promotion - Eredivisie (Conference League - Play Offs)")).toBe(
      "promotion"
    );
    expect(zoneFromDescription(null)).toBeNull();
    expect(zoneFromDescription("Something unexpected")).toBeNull();
  });
});

describe("normalizeLeagueTable", () => {
  it("normalizuje řádky, dopočítá rozdíl skóre a řadí podle pozice", () => {
    const raw = [
      row(2, 2, { description: "Promotion - Europa League (Group Stage)" }),
      row(1, 1, { points: 40, goalsDiff: 8, description: "Promotion - Champions League" }),
    ];
    const table = normalizeLeagueTable(raw);
    expect(table.map((r) => r.rank)).toEqual([1, 2]);
    expect(table[0]).toMatchObject({
      rank: 1,
      teamId: 1,
      name: "T1",
      played: 10,
      win: 6,
      draw: 2,
      lose: 2,
      goalsFor: 18,
      goalsAgainst: 10,
      goalsDiff: 8,
      points: 40,
      form: "WWDLW",
      zone: "champions",
    });
    expect(table[1].zone).toBe("europa");
  });

  it("chybějící pole → 0 / null form / žádná zóna a rozdíl skóre z gólů", () => {
    const bare: ApiStandingRow = { rank: 5, team: { id: 9, name: "T9", logo: "" } };
    expect(normalizeLeagueTable([bare])[0]).toMatchObject({
      rank: 5,
      teamId: 9,
      played: 0,
      goalsDiff: 0,
      points: 0,
      form: null,
      zone: null,
    });
  });
});

describe("deriveLeagueAccess", () => {
  it("odvodí evropské příčky a sestupový blok z reálných description řetězců", () => {
    const raw = [
      row(1, 1, { description: "Promotion - Champions League (Group Stage)" }),
      row(2, 2, { description: "Promotion - Champions League (Group Stage)" }),
      row(3, 3, { description: "Promotion - Champions League (Qualification)" }),
      row(4, 4, { description: "Promotion - Europa League (Play Offs)" }),
      row(5, 5, { description: "Promotion - Conference League (Qualification)" }),
      row(6, 6, { description: null }),
      row(7, 7, { description: null }),
      row(8, 8, { description: "Relegation - Relegation Play-offs" }),
      row(9, 9, { description: "Relegation" }),
      row(10, 10, { description: "Relegation" }),
    ];
    expect(deriveLeagueAccess(raw)).toEqual({
      slots: [
        { rank: 1, spot: "UCL" },
        { rank: 2, spot: "UCL" },
        { rank: 3, spot: "UCL_Q" },
        { rank: 4, spot: "UEL_Q" },
        { rank: 5, spot: "UECL_Q" },
      ],
      // 8. je baráž (nepočítá se), jistý sestup mají jen 9. a 10.
      relegBottom: 2,
    });
  });

  it("fázový split (nadstavba) se nepočítá jako sestup – jen skutečné sestupové příčky", () => {
    // Ligy s nadstavbou (ČR/Skotsko/…) vrací víc skupin: základní tabulku s fázovými
    // labely ("Championship round"/"Relegation Round") + evropskou a sestupovou podtabulku.
    // Sestup smí počítat jen "Relegation"/"Relegation Playoffs", ne "Relegation Round".
    const raw = [
      // Základní 12týmová tabulka – jen fázový split, ŽÁDNÝ skutečný sestup.
      ...Array.from({ length: 6 }, (_, i) =>
        row(100 + i, i + 1, { description: "Championship round" })
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        row(200 + i, i + 7, { description: "Relegation Round" })
      ),
      // Evropská podtabulka.
      row(1, 1, { description: "Champions League Qualification" }),
      row(2, 2, { description: "Conference League Qualification" }),
      // Sestupová podtabulka – baráž se nepočítá, jistý sestup má jen poslední.
      row(3, 5, { description: "Relegation Playoffs" }),
      row(4, 6, { description: "Relegation" }),
    ];
    expect(deriveLeagueAccess(raw)?.relegBottom).toBe(1);
  });

  // Regrese: dřív se vracelo `relegBottom: 0`, což je non-null override, který v
  // `accessFor` zkratoval kurátorovaný fallback → `rank > size - 0` → nikdo nesestoupil.
  it("nadstavba bez sestupové podtabulky → relegBottom null (ne 0), sloty zůstanou", () => {
    const raw = [
      row(1, 1, { description: "Champions League Qualification" }),
      row(2, 2, { description: "Promotion - Conference League (Qualification)" }),
      row(3, 3, { description: "Relegation Round" }),
      row(4, 4, { description: "Relegation Group" }),
    ];
    const access = deriveLeagueAccess(raw);
    expect(access).not.toBeNull();
    expect(access?.relegBottom).toBeNull();
    expect(access?.slots).toEqual([
      { rank: 1, spot: "UCL_Q" },
      { rank: 2, spot: "UECL_Q" },
    ]);
  });

  // Reálná Premier League 2025/26: 15. místo = vítěz FA Cupu → Evropská liga. Hra domácí
  // pohár nemodeluje, takže osamocený slot mimo souvislou řadu se musí zahodit (jinak by
  // se v tabulce rozsvítil evropský pruh u 15. místa).
  it("nesouvislý slot z domácího poháru se zahodí – zůstane jen řada od 1. místa", () => {
    const raw = [
      ...Array.from({ length: 5 }, (_, i) =>
        row(i + 1, i + 1, { description: "Promotion - Champions League (League phase)" })
      ),
      row(6, 6, { description: "Promotion - Europa League (League phase)" }),
      row(7, 7, { description: "Promotion - Conference League (Qualification)" }),
      row(8, 8, { description: null }),
      row(15, 15, { description: "Promotion - Europa League (League phase)" }), // vítěz poháru
      row(20, 20, { description: "Relegation - Championship" }),
    ];
    const access = deriveLeagueAccess(raw);
    expect(access?.slots.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(access?.slots.at(-1)).toEqual({ rank: 7, spot: "UECL_Q" });
    expect(access?.relegBottom).toBe(1);
  });

  // Reálná Eredivisie 2025/26: 5.–9. místo hraje domácí play-off O Evropu. Popisek nese
  // jméno domácí ligy před závorkou → není to postupové místo do Evropy.
  it("domácí play-off o Evropu není evropský slot (soutěž se hledá před závorkou)", () => {
    const raw = [
      row(1, 1, { description: "Promotion - Champions League (League phase)" }),
      row(2, 2, { description: "Promotion - Champions League (Qualification)" }),
      row(3, 3, { description: "Promotion - Europa League (Qualification)" }),
      row(4, 4, { description: "Promotion - Eredivisie (Conference League - Play Offs)" }),
      row(5, 5, { description: "Promotion - Eredivisie (Conference League - Play Offs)" }),
    ];
    expect(deriveLeagueAccess(raw)?.slots).toEqual([
      { rank: 1, spot: "UCL" },
      { rank: 2, spot: "UCL_Q" },
      { rank: 3, spot: "UEL_Q" },
    ]);
  });

  // Reálná Primeira Liga / Eredivisie / 2. Bundesliga: barážová příčka je "<Liga> (Relegation)",
  // jistý sestup je "Relegation - <nižší liga>". Dřív se baráž počítala jako jistý pád.
  it("baráž ve tvaru '<Liga> (Relegation)' se nepočítá jako jistý sestup", () => {
    const raw = [
      row(1, 16, { description: "Liga Portugal (Relegation)" }),
      row(2, 17, { description: "Relegation - Liga Portugal 2" }),
      row(3, 18, { description: "Relegation - Liga Portugal 2" }),
    ];
    expect(deriveLeagueAccess(raw)?.relegBottom).toBe(2);
  });

  it("duplicitní ranky z podtabulek nadstavby se dedupují (první vyhrává)", () => {
    const raw = [
      row(1, 1, { description: "Champions League" }),
      row(2, 2, { description: "UEFA Europa League Qualification" }),
      // Sestupová podtabulka – ranky začínají znovu od 1.
      row(3, 1, { description: "Relegation Playoffs" }),
      row(4, 2, { description: "Relegation" }),
    ];
    const access = deriveLeagueAccess(raw);
    expect(access?.slots).toEqual([
      { rank: 1, spot: "UCL" },
      { rank: 2, spot: "UEL_Q" },
    ]);
    expect(access?.relegBottom).toBe(1);
  });

  it("žádný řádek s rozpoznatelným popisem → null (fallback na kurátorovanou tabulku)", () => {
    const raw = [row(1, 1, { description: null }), row(2, 2, { description: undefined })];
    expect(deriveLeagueAccess(raw)).toBeNull();
  });

  it("neznámý/neparsovatelný popis se ignoruje, ale nerozbije ostatní řádky", () => {
    const raw = [
      row(1, 1, { description: "Promotion - Champions League (Group Stage)" }),
      row(2, 2, { description: "Something unexpected" }),
    ];
    expect(deriveLeagueAccess(raw)).toEqual({
      slots: [{ rank: 1, spot: "UCL" }],
      relegBottom: null,
    });
  });
});
