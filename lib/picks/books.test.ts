import { describe, expect, it } from "vitest";
import type { BookOdds } from "@/lib/data/apiFootball";
import {
  bestCornerPrice,
  bestLinePrice,
  bestOverround,
  bestPrice,
  cornerLines,
  mainCornerLine,
  mainLine,
  marketLines,
  overroundOf,
  parseBooks,
  sharpCornerFair,
  sharpFair,
  sharpFairTotal,
  sharpLineFair,
} from "./books";

/** Kniha s vyplněnými poli (nevyplněná = null). */
function book(name: string, o: Partial<BookOdds>): BookOdds {
  return {
    id: 0,
    name,
    home: null,
    draw: null,
    away: null,
    over25: null,
    under25: null,
    btts: null,
    bttsNo: null,
    ...o,
  };
}

/**
 * Tři knihy jako v realitě: **sharp** (nejnižší marže, 4.8 %), **líná** (13.3 %) a
 * **akční** – ta má nejlepší cenu na hosty (3.95), ale jinak vysokou marži (7.9 %).
 * Přesně tahle kombinace odděluje „kde vsadit" od „čemu věřit": nejlepší cena je
 * u třetí knihy, nejlepší odhad pravděpodobnosti u první.
 */
const BOOKS: BookOdds[] = [
  book("Pinnacle", { home: 2.05, draw: 3.45, away: 3.7, over25: 1.95, under25: 1.95 }),
  book("Líná", { home: 1.9, draw: 3.2, away: 3.4, over25: 1.8, under25: 1.9 }),
  book("Akční", { home: 1.95, draw: 3.2, away: 3.95 }),
];

describe("bestPrice", () => {
  it("vybere nejvyšší kurz a řekne kdo ho dává", () => {
    const b = bestPrice(BOOKS, "away");
    expect(b).not.toBeNull();
    expect(b!.odds).toBe(3.95);
    expect(b!.bookmaker).toBe("Akční");
  });

  it("hlásí, kolik knih stranu vůbec kotovalo", () => {
    expect(bestPrice(BOOKS, "home")!.books).toBe(3);
    // Total nabízejí jen dvě z nich – malý vzorek je potřeba poznat.
    expect(bestPrice(BOOKS, "over25")!.books).toBe(2);
  });

  it("stranu, kterou nikdo nekotuje, vrátí jako null", () => {
    expect(bestPrice(BOOKS, "btts")).toBeNull();
  });

  it("prázdný seznam nespadne", () => {
    expect(bestPrice([], "home")).toBeNull();
  });
});

describe("overroundOf / bestOverround", () => {
  it("spočítá marži jedné knihy", () => {
    const o = overroundOf(BOOKS[1])!;
    expect(o).toBeCloseTo(1 / 1.9 + 1 / 3.2 + 1 / 3.4 - 1, 9);
    expect(o).toBeGreaterThan(0.05); // líná kniha = vysoká marže
  });

  it("bez kompletního 1X2 vrací null", () => {
    expect(overroundOf(book("X", { home: 2 }))).toBeNull();
  });

  it("nejlepší cena napříč knihami má NIŽŠÍ marži než kterákoli z nich", () => {
    const best = bestOverround(BOOKS)!;
    for (const b of BOOKS) {
      const o = overroundOf(b);
      if (o != null) expect(best).toBeLessThan(o);
    }
  });

  it("nejlepší cena může dát i zápornou marži (arbitráž)", () => {
    const arb = [
      book("A", { home: 2.2, draw: 3.6, away: 3.6 }),
      book("B", { home: 2.4, draw: 3.9, away: 4.2 }),
    ];
    expect(bestOverround(arb)!).toBeLessThan(0);
  });
});

describe("sharpFair", () => {
  it("bere knihu s NEJNIŽŠÍ marží, ne nejvyšší kurz", () => {
    const f = sharpFair(BOOKS)!;
    expect(f.bookmaker).toBe("Pinnacle");
  });

  it("vrací odmaržované pravděpodobnosti (součet 1)", () => {
    const f = sharpFair(BOOKS)!;
    expect(f.home + f.draw + f.away).toBeCloseTo(1, 9);
    expect(f.home).toBeGreaterThan(f.draw);
  });

  it("nejlepší ceny NEJSOU pravděpodobnosti – proto jsou to dvě různé funkce", () => {
    // Součet 1/nejlepší cena nedá 1 (zbytková marže, u arbitráže dokonce < 1), takže
    // se z nich pravděpodobnost přímo číst nedá.
    const naive =
      1 / bestPrice(BOOKS, "home")!.odds +
      1 / bestPrice(BOOKS, "draw")!.odds +
      1 / bestPrice(BOOKS, "away")!.odds;
    expect(Math.abs(naive - 1)).toBeGreaterThan(0.01);
    expect(sharpFair(BOOKS)!.home + sharpFair(BOOKS)!.draw + sharpFair(BOOKS)!.away).toBeCloseTo(1, 9);
  });

  it("i po normalizaci jsou nejlepší ceny VYCHÝLENÉ proti sharp odhadu", () => {
    // Strana s výjimečně štědrou cenou (hosté 3.95 u „Akční") vyjde po normalizaci
    // jako MÉNĚ pravděpodobná, než říká sharp kniha – vyšší kurz = nižší implikovaná
    // pravděpodobnost. Kdyby se nejlepší cena použila jako měřítko (CLV, benchmark),
    // tahle chyba by se do něj promítla celá.
    const f = sharpFair(BOOKS)!;
    const inv = (s: "home" | "draw" | "away") => 1 / bestPrice(BOOKS, s)!.odds;
    const sum = inv("home") + inv("draw") + inv("away");
    expect(inv("away") / sum).toBeLessThan(f.away);
  });

  it("bez použitelné knihy vrací null", () => {
    expect(sharpFair([book("X", { over25: 1.9 })])).toBeNull();
  });
});

describe("sharpFairTotal", () => {
  it("odmaržuje total 2.5 z knihy s nejnižší marží", () => {
    const f = sharpFairTotal(BOOKS)!;
    expect(f.bookmaker).toBe("Pinnacle");
    expect(f.over25 + f.under25).toBeCloseTo(1, 9);
    expect(f.over25).toBeCloseTo(0.5, 6); // 1.95/1.95 = férová 50/50
  });

  it("kniha jen s jednou stranou se ignoruje (nejde odmaržovat)", () => {
    expect(sharpFairTotal([book("X", { over25: 1.8 })])).toBeNull();
  });
});

describe("rohy (různé linie napříč knihami)", () => {
  // Realita: každá kniha nabízí jinou linii. Porovnat kurz na 10.5 s kurzem na 11.5
  // by dalo zdánlivě obrovskou hranu, a byl by to jen artefakt.
  const CORNER_BOOKS: BookOdds[] = [
    book("Pinnacle", {
      corners: [
        { line: 9.5, over: 1.62, under: 2.32 },
        { line: 10.5, over: 2.02, under: 1.85 },
      ],
    }),
    book("Líná", { corners: [{ line: 10.5, over: 1.9, under: 1.8 }] }),
    book("Akční", {
      corners: [
        { line: 10.5, over: 2.15, under: 1.72 },
        { line: 11.5, over: 2.65, under: 1.48 },
      ],
    }),
  ];

  it("najde nabízené linie a spočítá jejich pokrytí", () => {
    const lines = cornerLines(CORNER_BOOKS);
    expect(lines[0]).toEqual({ line: 10.5, books: 3 }); // nejlépe pokrytá první
    expect(lines.map((l) => l.line).sort((a, b) => a - b)).toEqual([9.5, 10.5, 11.5]);
  });

  it("hlavní linie = ta nejšířeji kotovaná", () => {
    expect(mainCornerLine(CORNER_BOOKS)).toBe(10.5);
    expect(mainCornerLine([])).toBeNull();
  });

  it("nejlepší cena se hledá JEN uvnitř jedné linie", () => {
    const b = bestCornerPrice(CORNER_BOOKS, 10.5, "over")!;
    expect(b.odds).toBe(2.15);
    expect(b.bookmaker).toBe("Akční");
    expect(b.books).toBe(3);
    // Kurz 2.65 na lince 11.5 je vyšší, ale je to JINÁ sázka – nesmí se přimíchat.
    expect(b.odds).toBeLessThan(2.65);
  });

  it("linie, kterou nikdo nekotuje, vrátí null", () => {
    expect(bestCornerPrice(CORNER_BOOKS, 12.5, "over")).toBeNull();
  });

  it("sharp férová cena rohů bere knihu s nejnižší marží na TÉ lince", () => {
    const f = sharpCornerFair(CORNER_BOOKS, 10.5)!;
    expect(f.over + f.under).toBeCloseTo(1, 9);
    // Pinnacle: 1/2.02 + 1/1.85 = 1.0357; Líná: 1.0819; Akční: 1.0466 → Pinnacle.
    expect(f.bookmaker).toBe("Pinnacle");
    expect(f.overround).toBeLessThan(0.04);
  });

  it("kniha jen s jednou stranou linie se pro férovou cenu ignoruje", () => {
    const oneSided = [book("X", { corners: [{ line: 10.5, over: 1.9, under: null }] })];
    expect(sharpCornerFair(oneSided, 10.5)).toBeNull();
    // …ale na nejlepší cenu se použít dá (na tu protistranu nepotřebuješ).
    expect(bestCornerPrice(oneSided, 10.5, "over")!.odds).toBe(1.9);
  });

  it("projde kolečkem přes JSON beze ztráty linií", () => {
    const parsed = parseBooks(JSON.parse(JSON.stringify(CORNER_BOOKS)));
    expect(mainCornerLine(parsed)).toBe(10.5);
    expect(bestCornerPrice(parsed, 11.5, "over")!.odds).toBe(2.65);
  });
});

describe("týmové totaly", () => {
  const TOTAL_BOOKS: BookOdds[] = [
    book("Pinnacle", {
      totalHome: [
        { line: 1.5, over: 1.95, under: 1.9 },
        { line: 2.5, over: 3.6, under: 1.3 },
      ],
      totalAway: [{ line: 1.5, over: 2.5, under: 1.55 }],
      // Rohy má taky – nesmí se to smíchat.
      corners: [{ line: 10.5, over: 2.02, under: 1.85 }],
    }),
    book("Akční", {
      totalHome: [{ line: 1.5, over: 2.08, under: 1.78 }],
    }),
  ];

  it("čte linie z vlastního pole trhu, nemíchá strany ani trhy", () => {
    expect(mainLine(TOTAL_BOOKS, "totalHome")).toBe(1.5);
    expect(mainLine(TOTAL_BOOKS, "totalAway")).toBe(1.5);
    expect(mainLine(TOTAL_BOOKS, "corners")).toBe(10.5);
    // Hosté mají jen jednu knihu, domácí dvě – kdyby se to sečetlo, byla by tu 2.
    expect(marketLines(TOTAL_BOOKS, "totalAway")[0].books).toBe(1);
    expect(marketLines(TOTAL_BOOKS, "totalHome")[0].books).toBe(2);
  });

  it("nejlepší cena se hledá uvnitř trhu I linie", () => {
    const b = bestLinePrice(TOTAL_BOOKS, "totalHome", 1.5, "over")!;
    expect(b.odds).toBe(2.08);
    expect(b.bookmaker).toBe("Akční");
    // Kurz 3.6 je na lince 2.5 a 2.02 je na rozích – ani jeden se sem nesmí dostat.
    expect(b.odds).toBeLessThan(3.6);
  });

  it("sharp férová cena bere knihu s nejnižší marží daného trhu", () => {
    const f = sharpLineFair(TOTAL_BOOKS, "totalHome", 1.5)!;
    expect(f.over + f.under).toBeCloseTo(1, 9);
    // Pinnacle 1/1.95+1/1.9 = 1.039; Akční 1/2.08+1/1.78 = 1.043 → Pinnacle.
    expect(f.bookmaker).toBe("Pinnacle");
  });

  it("trh, který kniha nenabízí, vrací null (ne prázdné číslo)", () => {
    expect(bestLinePrice(TOTAL_BOOKS, "totalAway", 2.5, "over")).toBeNull();
    expect(sharpLineFair(TOTAL_BOOKS, "totalAway", 2.5)).toBeNull();
  });

  it("přežije kolečko přes JSON", () => {
    const parsed = parseBooks(JSON.parse(JSON.stringify(TOTAL_BOOKS)));
    expect(bestLinePrice(parsed, "totalHome", 1.5, "over")!.odds).toBe(2.08);
    expect(mainLine(parsed, "totalAway")).toBe(1.5);
    expect(mainLine(parsed, "corners")).toBe(10.5);
  });
});

describe("karty jako trh s linkami", () => {
  // Karty jsou trh s největším doloženým skillem (`lib/picks/cards.ts`) a jedou touž
  // cestou jako rohy a týmové totaly. Kritické je, že se s nimi NESMÍCHAJÍ – čísla
  // linií se navíc překrývají s týmovými totaly (obojí 2.5), takže záměna by nebyla
  // vidět ani na první pohled nesmyslné hodnotě.
  const CARD_BOOKS = [
    book("Pinnacle", {
      cards: [
        { line: 3.5, over: 1.55, under: 2.45 },
        { line: 4.5, over: 2.2, under: 1.68 },
      ],
      totalHome: [{ line: 2.5, over: 3.6, under: 1.3 }],
      corners: [{ line: 10.5, over: 2.02, under: 1.85 }],
    }),
    book("Akční", {
      cards: [{ line: 4.5, over: 2.35, under: 1.6 }],
    }),
  ];

  it("čte vlastní linie a nemíchá je s rohy ani s týmovým totalem", () => {
    expect(mainLine(CARD_BOOKS, "cards")).toBe(4.5);
    expect(marketLines(CARD_BOOKS, "cards").map((l) => l.line).sort()).toEqual([3.5, 4.5]);
    // Linka 2.5 existuje u týmového totalu, u karet ne – nesmí se propsat.
    expect(bestLinePrice(CARD_BOOKS, "cards", 2.5, "over")).toBeNull();
    expect(bestLinePrice(CARD_BOOKS, "cards", 10.5, "over")).toBeNull();
  });

  it("nejlepší cena se hledá uvnitř linie", () => {
    const b = bestLinePrice(CARD_BOOKS, "cards", 4.5, "over")!;
    expect(b.odds).toBe(2.35);
    expect(b.bookmaker).toBe("Akční");
    expect(b.books).toBe(2);
  });

  it("sharp férová cena odmaržuje na součet 1", () => {
    const f = sharpLineFair(CARD_BOOKS, "cards", 4.5)!;
    expect(f.over + f.under).toBeCloseTo(1, 9);
  });

  it("přežije kolečko přes JSON z DB", () => {
    const parsed = parseBooks(JSON.parse(JSON.stringify(CARD_BOOKS)));
    expect(mainLine(parsed, "cards")).toBe(4.5);
    expect(bestLinePrice(parsed, "cards", 3.5, "under")!.odds).toBe(2.45);
    // Ostatní trhy zůstaly na svém.
    expect(mainLine(parsed, "corners")).toBe(10.5);
    expect(mainLine(parsed, "totalHome")).toBe(2.5);
  });
});

describe("parseBooks", () => {
  it("přečte platný JSON z DB", () => {
    const parsed = parseBooks([
      { id: 4, name: "Pinnacle", home: 2.05, draw: 3.45, away: 3.7 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].home).toBe(2.05);
    expect(parsed[0].over25).toBeNull();
  });

  it("nesmysly v Json sloupci nezpůsobí pád, jen prázdný výsledek", () => {
    // Sloupec je `Json?` → může tam být cokoli. Volající pak spadne zpět
    // na referenční kurz, což je dosavadní chování.
    for (const junk of [null, undefined, 42, "text", {}, [1, 2, 3], [{ x: 1 }]]) {
      expect(parseBooks(junk)).toEqual([]);
    }
  });

  it("odfiltruje nesmyslné kurzy (≤ 1 není platný desetinný kurz)", () => {
    const parsed = parseBooks([{ name: "X", home: 1, draw: 0, away: -2, over25: 1.9 }]);
    expect(parsed[0].home).toBeNull();
    expect(parsed[0].draw).toBeNull();
    expect(parsed[0].away).toBeNull();
    expect(parsed[0].over25).toBe(1.9);
  });

  it("výsledek jde rovnou do bestPrice (kolečko DB → čtení funguje)", () => {
    const json = JSON.parse(JSON.stringify(BOOKS));
    expect(bestPrice(parseBooks(json), "away")!.odds).toBe(3.95);
  });
});
