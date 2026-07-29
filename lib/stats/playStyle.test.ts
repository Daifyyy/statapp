import { describe, expect, it } from "vitest";
import { computePlayStyle } from "./playStyle";
import type { Metric, MetricValue, Venue } from "@/lib/types";

function mv(
  metric: Metric,
  value: number | null,
  venue: Venue = "TOTAL"
): MetricValue {
  return { metric, venue, value, lowConfidence: false, sampleSize: 10, breakdown: [] };
}

const dim = (dims: ReturnType<typeof computePlayStyle>, key: string) =>
  dims.find((d) => d.key === key)!;

/** Minimální sada, aby dimenze měla data u obou stran. */
const both = (metric: Metric, hv: number, av: number) =>
  computePlayStyle([mv(metric, hv)], [mv(metric, av)], "TOTAL");

describe("computePlayStyle", () => {
  it("škáluje ABSOLUTNĚ, ne vůči soupeři", () => {
    // Tohle je celý rozdíl proti `categories.ts`: „hraje kombinačně" musí platit
    // nezávisle na tom, kdo stojí proti. Stejný tým proti různým soupeřům = stejné číslo.
    const vsWeak = both("POSSESSION", 62, 38);
    const vsStrong = both("POSSESSION", 62, 58);
    expect(dim(vsWeak, "possession").homeScore).toBe(
      dim(vsStrong, "possession").homeScore
    );

    // A NEplatí součet 10 (to je invariant `categories.ts`, ne stylu).
    // Pozor na svůdnou náhodu: u držení v rozsahu 30–70 součet 10 vyjde
    // (`(h−30)/40 + (a−30)/40 = (h+a−60)/40 = 1`), protože se držení sečte na 100.
    // Není to podíl, jen shoda škály – proto se to musí ukázat na dvojici,
    // kde se držení na 100 nesčítá.
    expect(
      dim(vsStrong, "possession").homeScore + dim(vsStrong, "possession").awayScore
    ).toBe(15);
  });

  it("Kontrola míče: 30 % → 0, 70 % → 10, mimo rozsah se ořízne", () => {
    const d = both("POSSESSION", 30, 70);
    expect(dim(d, "possession").homeScore).toBe(0);
    expect(dim(d, "possession").awayScore).toBe(10);

    // Extrémy (v datech se objeví) nesmí utéct mimo škálu.
    const extreme = both("POSSESSION", 12, 88);
    expect(dim(extreme, "possession").homeScore).toBe(0);
    expect(dim(extreme, "possession").awayScore).toBe(10);
  });

  it("Pressing: 8 faulů → 0, 20 → 10", () => {
    const d = both("FOULS", 8, 20);
    expect(dim(d, "pressing").homeScore).toBe(0);
    expect(dim(d, "pressing").awayScore).toBe(10);
  });

  it("Styl útoku: podíl střel z vápna; chybějící střely zvenku = fallback 0", () => {
    // Dokumentovaný fallback: API občas vrátí SHOTS_INSIDE_BOX bez SHOTS_OUTSIDE_BOX.
    // Tým pak vychází jako čistě kombinační – to je vědomá volba, ne dopočet odhadem.
    const withOutside = computePlayStyle(
      [mv("SHOTS_INSIDE_BOX", 6), mv("SHOTS_OUTSIDE_BOX", 6)],
      [mv("SHOTS_INSIDE_BOX", 9), mv("SHOTS_OUTSIDE_BOX", 3)],
      "TOTAL"
    );
    expect(dim(withOutside, "buildup").homeScore).toBe(5);
    expect(dim(withOutside, "buildup").awayScore).toBe(7.5);

    const missingOutside = computePlayStyle(
      [mv("SHOTS_INSIDE_BOX", 6)],
      [mv("SHOTS_INSIDE_BOX", 9)],
      "TOTAL"
    );
    expect(dim(missingOutside, "buildup").homeScore).toBe(10);
  });

  it("Efektivita: 0 střel → dimenze není dostupná (žádné dělení nulou)", () => {
    const d = computePlayStyle(
      [mv("SHOTS", 0), mv("SHOTS_ON_TARGET", 0)],
      [mv("SHOTS", 10), mv("SHOTS_ON_TARGET", 4)],
      "TOTAL"
    );
    expect(dim(d, "efficiency").available).toBe(false);
  });

  it("Efektivita: víc střel na branku než střel celkem se ořízne na 10", () => {
    // Datová anomálie z API (různé zdroje pro obě metriky) nesmí vyrobit skóre 12.
    const d = computePlayStyle(
      [mv("SHOTS", 4), mv("SHOTS_ON_TARGET", 6)],
      [mv("SHOTS", 10), mv("SHOTS_ON_TARGET", 5)],
      "TOTAL"
    );
    expect(dim(d, "efficiency").homeScore).toBe(10);
    expect(dim(d, "efficiency").awayScore).toBe(5);
  });

  it("dimenze je dostupná, jen když mají data OBA týmy", () => {
    // Pruh porovnává dvě strany – jednostranná hodnota by kreslila soupeře na 5
    // (výchozí), což vypadá jako změřený průměr, a není.
    const d = computePlayStyle([mv("POSSESSION", 60)], [], "TOTAL");
    expect(dim(d, "possession").available).toBe(false);
    // 60 % → (60−30)/40 = 0.75 → 7.5. (Ne 6 – to by byl PODÍL jako v kategoriích;
    // tady je škála absolutní, což je přesně ten rozdíl, na kterém stojí celý modul.)
    expect(dim(d, "possession").homeScore).toBe(7.5);
    expect(dim(d, "possession").awayScore).toBe(5); // výchozí, proto available:false
  });

  it("REPREZENTACE: Kontrola míče ani Styl útoku se NEVYŘAZUJÍ", () => {
    // Regrese: obě dimenze měly natvrdo `unavailableForNational: true`, což obcházelo
    // kontrolu dat a zhaslo je i tam, kde data byla (držení má 99,5 % reprezentačních
    // zápasů se statistikami). Funkce proto `mode` ani nebere – dostupnost řeší jen data.
    const d = computePlayStyle(
      [mv("POSSESSION", 55), mv("SHOTS_INSIDE_BOX", 8), mv("SHOTS_OUTSIDE_BOX", 4)],
      [mv("POSSESSION", 45), mv("SHOTS_INSIDE_BOX", 5), mv("SHOTS_OUTSIDE_BOX", 5)],
      "TOTAL"
    );
    expect(dim(d, "possession").available).toBe(true);
    expect(dim(d, "buildup").available).toBe(true);
  });

  it("bez dat jsou všechny dimenze nedostupné a na 5", () => {
    const dims = computePlayStyle([], [], "TOTAL");
    for (const d of dims) {
      expect(d.available).toBe(false);
      expect(d.homeScore).toBe(5);
      expect(d.awayScore).toBe(5);
    }
  });

  it("venue varianta má přednost, ale padá zpět na TOTAL", () => {
    const home = [mv("POSSESSION", 70, "HOME"), mv("POSSESSION", 50, "TOTAL")];
    const away = [mv("POSSESSION", 50, "TOTAL")];
    const d = computePlayStyle(home, away, "HOME");
    expect(dim(d, "possession").homeScore).toBe(10); // z HOME (70 %), ne z TOTAL
    expect(dim(d, "possession").awayScore).toBe(5); // fallback na TOTAL (50 %)
  });

  it("vrací všechny 4 dimenze ve stabilním pořadí i s popisky pólů", () => {
    const dims = computePlayStyle([], [], "TOTAL");
    expect(dims.map((d) => d.key)).toEqual([
      "possession",
      "buildup",
      "pressing",
      "efficiency",
    ]);
    // Popisky pólů nesou význam směru – prohození by obrátilo čtení pruhu.
    expect(dim(dims, "possession").leftLabel).toBe("Přímá hra");
    expect(dim(dims, "possession").rightLabel).toBe("Kontrola");
  });
});
