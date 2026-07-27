import { describe, expect, it } from "vitest";
import { oddsSchema } from "./apiFootball";

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
