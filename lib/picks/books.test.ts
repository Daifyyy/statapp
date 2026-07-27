import { describe, expect, it } from "vitest";
import type { BookOdds } from "@/lib/data/apiFootball";
import {
  bestOverround,
  bestPrice,
  overroundOf,
  parseBooks,
  sharpFair,
  sharpFairTotal,
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
