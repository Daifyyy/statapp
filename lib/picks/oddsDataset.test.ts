import { describe, expect, it } from "vitest";
import type { HistoryMatch } from "./backtest";
import {
  matchOdds,
  nameSimilarity,
  normalizeTeamName,
  parseCsvDate,
  parseExtraCsv,
  parseMainCsv,
} from "./oddsDataset";

function hm(over: Partial<HistoryMatch> = {}): HistoryMatch {
  return {
    fixtureId: 1,
    date: "2024-08-16T19:00:00+00:00",
    season: 2024,
    leagueId: 39,
    homeId: 33,
    awayId: 36,
    homeName: "Manchester United",
    awayName: "Fulham",
    homeLogo: "",
    awayLogo: "",
    homeGoals: 1,
    awayGoals: 0,
    ...over,
  };
}

const MAIN_CSV = [
  "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,Referee,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,PSCH,PSCD,PSCA,MaxCH,MaxCD,MaxCA,AvgCH,AvgCD,AvgCA,PC>2.5,PC<2.5,MaxC>2.5,MaxC<2.5,AvgC>2.5,AvgC<2.5,AHCh,PCAHH,PCAHA,MaxCAHH,MaxCAHA,AvgCAHH,AvgCAHA",
  "E0,16/08/2024,20:00,Man United,Fulham,1,0,H,1,0,M Oliver,14,9,5,3,11,8,7,3,2,1,0,0,1.60,4.20,5.25,1.65,4.40,5.60,1.60,4.15,5.20,1.85,2.05,1.90,2.10,1.83,2.02,-1,1.98,1.92,2.02,1.96,1.96,1.90",
  "E0,17/08/2024,15:00,Ipswich,Liverpool,0,2,A,0,1,A Taylor,6,18,2,7,9,10,4,8,3,1,0,0,7.50,4.80,1.45,7.90,5.00,1.48,7.20,4.70,1.44,1.75,2.15,1.80,2.20,1.73,2.10,1.25,1.95,1.95,2.00,1.99,1.93,1.92",
].join("\n");

/** Starý tvar souboru: jen 1X2 a rohy, žádný hendikep ani karty. */
const MINIMAL_CSV = [
  "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HC,AC,PSCH,PSCD,PSCA",
  "E0,16/08/2024,20:00,Man United,Fulham,1,0,H,7,3,1.60,4.20,5.25",
].join("\n");

const EXTRA_CSV = [
  "Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,PSCD,PSCA,MaxCH,MaxCD,MaxCA,AvgCH,AvgCD,AvgCA",
  "Austria,Bundesliga,2024/2025,03/08/2024,17:00,Altach,Tirol,1,2,A,2.40,3.50,2.90,2.50,3.60,3.00,2.35,3.45,2.85",
  "Austria,Bundesliga,2012/2013,21/07/2012,15:00,Sturm Graz,Salzburg,0,2,A,3.26,3.34,2.40,3.26,3.40,2.50,2.96,3.20,2.33",
].join("\n");

describe("parseCsvDate", () => {
  it("čte dd/mm/yyyy i dd/mm/yy jako půlnoc UTC", () => {
    expect(parseCsvDate("16/08/2024")).toBe(Date.UTC(2024, 7, 16));
    expect(parseCsvDate("16/08/24")).toBe(Date.UTC(2024, 7, 16));
    expect(Number.isNaN(parseCsvDate("2024-08-16"))).toBe(true);
  });
});

describe("normalizeTeamName / nameSimilarity", () => {
  it("odstraní diakritiku, interpunkci a klubové zkratky", () => {
    expect(normalizeTeamName("FC Bayern München")).toBe("bayern munchen");
    expect(normalizeTeamName("1. FC Köln")).toBe("1 koln");
  });

  it("zvládne zkrácený název (tokeny)", () => {
    expect(nameSimilarity("Manchester United", "Man United")).toBe(1);
    expect(nameSimilarity("Olympiakos Piraeus", "Olympiakos")).toBeGreaterThan(0.4);
  });

  it("zvládne jiný přepis jména (bigramy)", () => {
    expect(nameSimilarity("Levadiakos", "Levadeiakos")).toBeGreaterThan(0.8);
  });

  it("alias pokryje klub s úplně jiným názvem", () => {
    expect(nameSimilarity("WSG Wattens", "Tirol")).toBe(1);
  });

  it("dva různé kluby zůstanou nepodobné", () => {
    expect(nameSimilarity("Arsenal", "Aston Villa")).toBeLessThan(0.34);
    expect(nameSimilarity("Sturm Graz", "Rapid Vienna")).toBeLessThan(0.34);
  });
});

describe("parseMainCsv", () => {
  it("načte tři cenové hladiny, totaly i rohy", () => {
    const rows = parseMainCsv(MAIN_CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ home: "Man United", away: "Fulham", homeGoals: 1, awayGoals: 0 });
    expect(rows[0].odds.pinnacle).toEqual({ home: 1.6, draw: 4.2, away: 5.25 });
    expect(rows[0].odds.best).toEqual({ home: 1.65, draw: 4.4, away: 5.6 });
    expect(rows[0].odds.ou25?.pinnacle).toEqual({ over: 1.85, under: 2.05 });
    expect(rows[0].odds.corners).toEqual({ home: 7, away: 3 });
  });

  it("načte ZAVÍRACÍ asijský hendikep včetně znaménka a čtvrtinových linek", () => {
    const rows = parseMainCsv(MAIN_CSV);
    // Domácí favorit → záporná linka (dávají gól náskoku).
    expect(rows[0].odds.ah).toEqual({
      line: -1,
      pinnacle: { home: 1.98, away: 1.92 },
      average: { home: 1.96, away: 1.9 },
      best: { home: 2.02, away: 1.96 },
    });
    // Host favorit → kladná linka pro domácí; čtvrtinová se nesmí zaokrouhlit.
    expect(rows[1].odds.ah?.line).toBe(1.25);
  });

  it("načte karty, fauly, střely, poločas i rozhodčího", () => {
    const rows = parseMainCsv(MAIN_CSV);
    expect(rows[0].odds.facts).toEqual({
      referee: "M Oliver",
      cards: { homeYellow: 2, awayYellow: 1, homeRed: 0, awayRed: 0 },
      fouls: { home: 11, away: 8 },
      shots: { home: 14, away: 9, homeOn: 5, awayOn: 3 },
      halfTime: { home: 1, away: 0 },
    });
  });

  it("chybějící sloupce nic nerozbijí (starý tvar souboru)", () => {
    const rows = parseMainCsv(MINIMAL_CSV);
    expect(rows).toHaveLength(1);
    expect(rows[0].odds.pinnacle).toEqual({ home: 1.6, draw: 4.2, away: 5.25 });
    expect(rows[0].odds.ah).toBeUndefined();
    expect(rows[0].odds.facts).toBeUndefined();
    expect(rows[0].odds.corners).toEqual({ home: 7, away: 3 });
  });
});

describe("parseExtraCsv", () => {
  it("načte 1X2 a sezónu jako rok začátku; totaly ani rohy tam nejsou", () => {
    const rows = parseExtraCsv(EXTRA_CSV);
    expect(rows[0]).toMatchObject({ home: "Altach", away: "Tirol", season: 2024 });
    expect(rows[0].odds.pinnacle).toEqual({ home: 2.4, draw: 3.5, away: 2.9 });
    expect(rows[0].odds.ou25).toBeUndefined();
    expect(rows[0].odds.corners).toBeUndefined();
    expect(rows[0].odds.ah).toBeUndefined();
    expect(rows[0].odds.facts).toBeUndefined();
    expect(rows[1].season).toBe(2012);
  });
});

describe("matchOdds", () => {
  const source = parseMainCsv(MAIN_CSV);

  it("spáruje přes datum, skóre a podobnost jmen", () => {
    const res = matchOdds([hm()], source);
    expect(res.matched).toBe(1);
    expect(res.odds[1].pinnacle).toEqual({ home: 1.6, draw: 4.2, away: 5.25 });
  });

  it("toleruje posun data o den (časové zóny, večerní výkopy)", () => {
    const res = matchOdds([hm({ date: "2024-08-15T22:00:00+00:00" })], source);
    expect(res.matched).toBe(1);
  });

  // Nejdůležitější pojistka: cizí kurzy jsou horší než žádné kurzy.
  it("nespáruje zápas se stejným datem, ale jiným skóre", () => {
    const res = matchOdds([hm({ homeGoals: 3, awayGoals: 3 })], source);
    expect(res.matched).toBe(0);
    expect(res.unmatched).toHaveLength(1);
  });

  it("nespáruje jiné týmy, i když datum a skóre sedí", () => {
    const res = matchOdds([hm({ homeName: "Arsenal", awayName: "Everton" })], source);
    expect(res.matched).toBe(0);
  });

  it("jeden zdrojový zápas se nepoužije dvakrát", () => {
    const res = matchOdds([hm(), hm({ fixtureId: 2 })], source);
    expect(res.matched).toBe(1);
  });

  it("u extra souboru filtruje podle sezóny", () => {
    const extra = parseExtraCsv(EXTRA_CSV);
    const match = hm({
      leagueId: 218,
      season: 2024,
      date: "2024-08-03T17:00:00+00:00",
      homeName: "SCR Altach",
      awayName: "WSG Wattens",
      homeGoals: 1,
      awayGoals: 2,
    });
    expect(matchOdds([match], extra, 2024).matched).toBe(1);
    expect(matchOdds([match], extra, 2023).matched).toBe(0);
  });
});
