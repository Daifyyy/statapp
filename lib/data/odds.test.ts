import { describe, expect, it } from "vitest";
import { bookOddsOf, isCardBet, isCornerBet, oddsSchema, teamTotalSide } from "./apiFootball";

/**
 * Regrese: `/odds` vrací u některých trhů (Exact Score, handicapy) `value` jako **číslo**.
 * Schéma dřív trvalo na řetězci, takže jediný takový trh shodil parsování celé odpovědi –
 * a protože je fetch kurzů best-effort, selhání bylo tiché: value tipy, digest ani
 * `MarketPanel` nikdy nedostaly data.
 */
describe("oddsSchema", () => {
  const response = [
    {
      bookmakers: [
        {
          id: 11,
          name: "Pinnacle",
          bets: [
            {
              id: 1,
              name: "Match Winner",
              values: [
                { value: "Home", odd: "1.70" },
                { value: "Draw", odd: "3.96" },
                { value: "Away", odd: "4.76" },
              ],
            },
            {
              // Trh s numerickým `value` – tenhle tvar dřív shodil celou odpověď.
              id: 27,
              name: "Exact Score",
              values: [
                { value: 1, odd: "8.50" },
                { value: 2, odd: 9 },
              ],
            },
          ],
        },
      ],
    },
  ];

  it("numerické `value`/`odd` projde a normalizuje se na řetězec", () => {
    const parsed = oddsSchema.parse(response);
    const bets = parsed[0].bookmakers[0].bets;
    expect(bets[1].values).toEqual([
      { value: "1", odd: "8.50" },
      { value: "2", odd: "9" },
    ]);
  });

  it("1X2 trh zůstane čitelný vedle exotického trhu", () => {
    const parsed = oddsSchema.parse(response);
    const mw = parsed[0].bookmakers[0].bets.find((b) => b.id === 1);
    expect(mw?.values.find((v) => v.value === "Home")?.odd).toBe("1.70");
  });

  it("prázdná odpověď (zápas bez sázkovek) je validní", () => {
    expect(oddsSchema.parse([])).toEqual([]);
    expect(oddsSchema.parse([{ bookmakers: [] }])).toEqual([{ bookmakers: [] }]);
  });
});

/**
 * Matchery trhů. Hledají se podle **názvu**, protože id se mezi knihami liší – tím pádem
 * je jediná pojistka proti záměně veličin právě tenhle test. Záměna by nespadla: model
 * by tiše porovnával λ v jedné jednotce s cenou v jiné.
 */
describe("matchery trhů", () => {
  const bet = (name: string) => ({ id: 0, name });

  it("chytí karty celkem v zápase", () => {
    expect(isCardBet(bet("Total Cards"))).toBe(true);
    expect(isCardBet(bet("Cards Over/Under"))).toBe(true);
    expect(isCardBet(bet("CARDS"))).toBe(true);
  });

  it("NECHYTÍ trhy s kartami v jiné jednotce nebo jiném rozsahu", () => {
    // Booking points váží červenou 2–2.5× → jiná stupnice než `cardCount`.
    expect(isCardBet(bet("Booking Points"))).toBe(false);
    expect(isCardBet(bet("Cards Booking Points"))).toBe(false);
    // Jedna barva = jiná veličina než žluté + červené.
    expect(isCardBet(bet("Total Yellow Cards"))).toBe(false);
    expect(isCardBet(bet("Red Cards"))).toBe(false);
    // Týmové, ne total zápasu.
    expect(isCardBet(bet("Home Team Total Cards"))).toBe(false);
    expect(isCardBet(bet("Away Team Cards"))).toBe(false);
    // Jiný jev než počet za celý zápas.
    expect(isCardBet(bet("First Half Cards"))).toBe(false);
    expect(isCardBet(bet("Time of First Card"))).toBe(false);
  });

  it("tři matchery se VZÁJEMNĚ VYLUČUJÍ", () => {
    // Kdyby se překrývaly, model by porovnal gólovou λ s cenou na rohy a nic by
    // nekřičelo – proto je to invariant, ne detail.
    for (const name of [
      "Total Cards",
      "Total Corners",
      "Corners Over/Under",
      "Total - Home",
      "Total - Away",
      "Goals Over/Under",
      "Booking Points",
      "Match Winner",
    ]) {
      const b = bet(name);
      const hits = [isCornerBet(b), isCardBet(b), teamTotalSide(b) != null].filter(Boolean);
      expect(hits.length, `„${name}" spadlo do ${hits.length} trhů`).toBeLessThanOrEqual(1);
    }
  });

  it("týmový total nechytí rohy ani karty", () => {
    expect(teamTotalSide(bet("Total Corners - Home"))).toBeNull();
    expect(teamTotalSide(bet("Home Team Total Cards"))).toBeNull();
    expect(teamTotalSide(bet("Total - Home"))).toBe("home");
    expect(teamTotalSide(bet("Total - Away"))).toBe("away");
    // Total celého zápasu není týmový.
    expect(teamTotalSide(bet("Goals Over/Under"))).toBeNull();
  });
});

/**
 * End-to-end parse jedné knihy. Sem míří celý řetěz snímání kurzů: co tahle funkce
 * nevrátí, to se nikdy neuloží (`saveOdds` ukládá `books` jako JSON vcelku), a protože
 * je fetch kurzů best-effort, selhalo by to **tiše**. Přesně tak se rok neuložil ani
 * jeden kurz, když zod schéma padalo na numerickém `value`.
 */
describe("bookOddsOf – trhy z jedné odpovědi", () => {
  const book = {
    id: 8,
    name: "Bet365",
    bets: [
      {
        id: 1,
        name: "Match Winner",
        values: [
          { value: "Home", odd: "2.10" },
          { value: "Draw", odd: "3.40" },
          { value: "Away", odd: "3.60" },
        ],
      },
      {
        id: 5,
        name: "Goals Over/Under",
        values: [
          { value: "Over 2.5", odd: "1.90" },
          { value: "Under 2.5", odd: "1.95" },
        ],
      },
      {
        id: 45,
        name: "Corners Over Under",
        values: [
          { value: "Over 10.5", odd: "2.05" },
          { value: "Under 10.5", odd: "1.80" },
        ],
      },
      {
        id: 80,
        name: "Cards Over/Under",
        values: [
          { value: "Over 3.5", odd: "1.57" },
          { value: "Under 3.5", odd: "2.40" },
          { value: "Over 4.5", odd: "2.25" },
          { value: "Under 4.5", odd: "1.65" },
        ],
      },
      {
        // Jiná jednotka – nesmí se dostat mezi karty.
        id: 81,
        name: "Booking Points Over/Under",
        values: [
          { value: "Over 45.5", odd: "1.90" },
          { value: "Under 45.5", odd: "1.90" },
        ],
      },
      {
        id: 16,
        name: "Total - Home",
        values: [
          { value: "Over 1.5", odd: "2.00" },
          { value: "Under 1.5", odd: "1.85" },
        ],
      },
    ],
  };

  it("vytáhne karty jako linie, obě strany", () => {
    const parsed = bookOddsOf(book);
    expect(parsed.cards).toEqual([
      { line: 3.5, over: 1.57, under: 2.4 },
      { line: 4.5, over: 2.25, under: 1.65 },
    ]);
  });

  it("booking points se mezi karty NEDOSTANOU", () => {
    const parsed = bookOddsOf(book);
    // Linie 45.5 by v kartách byla nesmysl, ale model by ji nepoznal – proto test.
    expect(parsed.cards?.some((c) => c.line > 10)).toBe(false);
  });

  it("ostatní trhy zůstanou oddělené a nedotčené", () => {
    const parsed = bookOddsOf(book);
    expect(parsed.home).toBe(2.1);
    expect(parsed.over25).toBe(1.9);
    expect(parsed.corners).toEqual([{ line: 10.5, over: 2.05, under: 1.8 }]);
    expect(parsed.totalHome).toEqual([{ line: 1.5, over: 2, under: 1.85 }]);
    expect(parsed.totalAway).toBeUndefined();
  });

  it("kniha bez karet je pořád platná (pole prostě chybí)", () => {
    const parsed = bookOddsOf({ ...book, bets: book.bets.filter((b) => b.id !== 80) });
    expect(parsed.cards).toBeUndefined();
    expect(parsed.corners).toBeDefined();
  });
});
