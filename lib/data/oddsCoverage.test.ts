import { describe, expect, it } from "vitest";
import {
  addFixtureCoverage,
  coverageWarnings,
  emptyCoverage,
} from "./oddsCoverage";
import type { BookOdds } from "./apiFootball";

/** Kniha s 1X2 + O/U + BTTS (to nabízí prakticky každá sázkovka). */
function book(over: Partial<BookOdds> = {}): BookOdds {
  return {
    id: 8,
    name: "Bet365",
    home: 2.1,
    draw: 3.4,
    away: 3.6,
    over25: 1.9,
    under25: 1.95,
    btts: 1.8,
    bttsNo: 2.0,
    ...over,
  };
}

const runOf = (fixtures: BookOdds[][]) =>
  fixtures.reduce((acc, books) => addFixtureCoverage(acc, books), emptyCoverage());

describe("addFixtureCoverage", () => {
  it("počítá zápasy, ne knihy – stačí, když trh má JEDNA kniha", () => {
    // Zajímá nás „šlo to vůbec vytáhnout", ne šířka nabídky.
    const cov = addFixtureCoverage(emptyCoverage(), [
      book(),
      book({ id: 2, name: "Pinnacle", corners: [{ line: 10.5, over: 1.9, under: 1.9 }] }),
    ]);
    expect(cov.corners).toBe(1);
    expect(cov.main).toBe(1);
  });

  it("1X2 se počítá jen s kompletní trojicí", () => {
    // Chybějící remíza znamená, že se trh nerozparsoval celý – půlka je k ničemu.
    const cov = addFixtureCoverage(emptyCoverage(), [book({ draw: null })]);
    expect(cov.main).toBe(0);
  });

  it("prázdné pole linií se NEpočítá jako pokrytí", () => {
    const cov = addFixtureCoverage(emptyCoverage(), [book({ cards: [] })]);
    expect(cov.cards).toBe(0);
  });

  it("sčítá napříč zápasy", () => {
    const withCards = book({ cards: [{ line: 4.5, over: 1.85, under: 1.85 }] });
    const cov = runOf([[book()], [withCards], [withCards]]);
    expect(cov.cards).toBe(2);
    expect(cov.main).toBe(3);
  });
});

describe("coverageWarnings", () => {
  it("MLČÍ na malém vzorku – jedno úterý mimo sezónu není porucha", () => {
    const cov = runOf(Array.from({ length: 3 }, () => [book()]));
    expect(coverageWarnings(cov, 3)).toEqual([]);
  });

  it("1X2 bez záchytu na 5 zápasech = jistá chyba parsování", () => {
    // Každá kniha kótuje 1X2. Nula napříč pěti zápasy nemá legitimní výklad.
    const cov = runOf(Array.from({ length: 5 }, () => [book({ home: null, draw: null, away: null })]));
    expect(coverageWarnings(cov, 5)).toContain("main");
  });

  it("vedlejší trhy potřebují VĚTŠÍ vzorek než 1X2", () => {
    // Rohy/karty nekótuje každá kniha a daleko před výkopem někdy nikdo. Kdyby se
    // hlásily už od pěti zápasů, křičelo by to každé ráno a přestalo by se to číst.
    const cov = runOf(Array.from({ length: 6 }, () => [book()]));
    expect(coverageWarnings(cov, 6)).toEqual([]);
  });

  it("nula rohů/karet/totalů přes 15+ zápasů = podezření na rozbité matchery", () => {
    // Přesně ten stav, kvůli kterému modul existuje: kurzy se ukládají, ale parsování
    // trhů psané v mezisezóně nechytá reálné názvy → celý podzim sběru bez rohů.
    const cov = runOf(Array.from({ length: 20 }, () => [book()]));
    const warn = coverageWarnings(cov, 20);
    expect(warn).toEqual(
      expect.arrayContaining(["corners", "cards", "totalHome", "totalAway"])
    );
    expect(warn).not.toContain("main"); // 1X2 se chytá, ten je v pořádku
    expect(warn).not.toContain("over25");
  });

  it("zdravý běh nehlásí nic", () => {
    const full = book({
      corners: [{ line: 10.5, over: 1.9, under: 1.9 }],
      cards: [{ line: 4.5, over: 1.85, under: 1.85 }],
      totalHome: [{ line: 1.5, over: 1.7, under: 2.1 }],
      totalAway: [{ line: 1.5, over: 2.2, under: 1.65 }],
    });
    const cov = runOf(Array.from({ length: 20 }, () => [full]));
    expect(coverageWarnings(cov, 20)).toEqual([]);
  });

  it("hlásí jen ten trh, který chybí – ne všechny naráz", () => {
    // Když se rozbije jen jeden matcher, hlášení musí ukázat na něj, ne na celý sběr.
    const noCards = book({
      corners: [{ line: 10.5, over: 1.9, under: 1.9 }],
      totalHome: [{ line: 1.5, over: 1.7, under: 2.1 }],
      totalAway: [{ line: 1.5, over: 2.2, under: 1.65 }],
    });
    const cov = runOf(Array.from({ length: 20 }, () => [noCards]));
    expect(coverageWarnings(cov, 20)).toEqual(["cards"]);
  });
});
