import { describe, expect, it } from "vitest";
import { computeCategoryScores } from "./categories";
import type { Metric, MetricValue, Venue } from "@/lib/types";

/** Zkratka pro jednu spočítanou metriku (breakdown testy nezajímá). */
function mv(
  metric: Metric,
  value: number | null,
  venue: Venue = "TOTAL",
  extra: Partial<MetricValue> = {}
): MetricValue {
  return {
    metric,
    venue,
    value,
    lowConfidence: false,
    sampleSize: 10,
    breakdown: [],
    ...extra,
  };
}

const cat = (scores: ReturnType<typeof computeCategoryScores>, key: string) =>
  scores.find((c) => c.key === key)!;

describe("computeCategoryScores", () => {
  it("normalizuje RELATIVNĚ: součet obou stran je vždy 10", () => {
    // Celý smysl kategoriového skóre je „kdo je v tomhle lepší", ne absolutní výkon.
    // Kdyby se strany rozešly, pruh v UI (`homeScore / total`) by přestal odpovídat číslům.
    const home = [mv("GOALS_FOR", 2.4), mv("XG", 1.9)];
    const away = [mv("GOALS_FOR", 1.2), mv("XG", 1.1)];
    const scores = computeCategoryScores(home, away, "TOTAL", "CLUB");
    for (const c of scores) {
      expect(c.homeScore + c.awayScore).toBeCloseTo(10, 10);
    }
  });

  it.each([
    ["držení míče", "POSSESSION" as Metric, 30, 50, "ball_control"],
    ["fauly", "FOULS" as Metric, 8.5, 11.5, "discipline"],
    ["góly", "GOALS_FOR" as Metric, 0.51, 0.69, "attack"],
  ])(
    "součet 10 drží i tam, kde se obě strany zaokrouhlí nahoru (%s)",
    (_label, metric, hv, av, key) => {
      // Regrese: strany se zaokrouhlovaly NEZÁVISLE, takže podíl 0.375 dal 3.8 a 6.3
      // → UI ukázalo dvě čísla se součtem 10.1 a pruh (`homeScore / total`) jim
      // neodpovídal. Je to táž past, kvůli které `matchReport.ts` dopočítává druhou
      // stranu až ze zaokrouhlené první. Reálných dvojic je v běžných rozsazích
      // několik set (držení 30:50, fauly 8.5:11.5, góly 0.51:0.69 …).
      const scores = computeCategoryScores(
        [mv(metric, hv)],
        [mv(metric, av)],
        "TOTAL",
        "CLUB"
      );
      const c = cat(scores, key);
      expect(c.homeScore + c.awayScore).toBe(10);
    }
  );

  it("obrací metriky, kde je NIŽŠÍ lepší (obdržené góly)", () => {
    // Domácí inkasují méně → v Obraně musí být lepší, i když je číslo menší.
    const scores = computeCategoryScores(
      [mv("GOALS_AGAINST", 0.8)],
      [mv("GOALS_AGAINST", 2.4)],
      "TOTAL",
      "CLUB"
    );
    const defense = cat(scores, "defense");
    expect(defense.homeScore).toBeGreaterThan(defense.awayScore);
    expect(defense.homeScore).toBeCloseTo(7.5, 5);
  });

  it("metrika chybějící u JEDNÉ strany se přeskočí a NEPOSUNE váhy", () => {
    // Kdyby se počítala s null jako s nulou, tým bez xG by vypadal jako tým s xG = 0.
    // Výsledek proto musí být shodný s během, kde ta metrika chybí oběma.
    const withHalfXg = computeCategoryScores(
      [mv("GOALS_FOR", 2), mv("XG", 1.8)],
      [mv("GOALS_FOR", 1)], // hosté xG nemají
      "TOTAL",
      "CLUB"
    );
    const withoutXg = computeCategoryScores(
      [mv("GOALS_FOR", 2)],
      [mv("GOALS_FOR", 1)],
      "TOTAL",
      "CLUB"
    );
    expect(cat(withHalfXg, "attack").homeScore).toBe(
      cat(withoutXg, "attack").homeScore
    );
  });

  it("obě strany na nule → 5/5, ne dělení nulou", () => {
    // Červené karty jsou nejčastější případ: většina dvojic má 0 : 0.
    const scores = computeCategoryScores(
      [mv("RED_CARDS", 0)],
      [mv("RED_CARDS", 0)],
      "TOTAL",
      "CLUB"
    );
    const discipline = cat(scores, "discipline");
    expect(discipline.homeScore).toBe(5);
    expect(discipline.awayScore).toBe(5);
    expect(discipline.available).toBe(true); // data JSOU, jen jsou shodná
  });

  it("kategorie bez jediné metriky s daty → available:false a 5/5", () => {
    const scores = computeCategoryScores([], [], "TOTAL", "CLUB");
    for (const c of scores) {
      expect(c.available).toBe(false);
      expect(c.homeScore).toBe(5);
      expect(c.awayScore).toBe(5);
    }
  });

  it("REPREZENTACE: xG se vyloučí, ale Útok jede dál z gólů a střel", () => {
    // xG je jediná metrika, kterou reprezentacím vyřazujeme (má ji 30,9 % zápasů).
    // Kategorie kvůli tomu nesmí zhasnout – to byla stará chyba u „Hry s míčem".
    const home = [mv("GOALS_FOR", 2), mv("XG", 9), mv("SHOTS_ON_TARGET", 6)];
    const away = [mv("GOALS_FOR", 1), mv("XG", 0.1), mv("SHOTS_ON_TARGET", 3)];

    const national = cat(computeCategoryScores(home, away, "TOTAL", "NATIONAL"), "attack");
    const club = cat(computeCategoryScores(home, away, "TOTAL", "CLUB"), "attack");

    expect(national.available).toBe(true);
    // Nesmyslně vysoké domácí xG (9) smí ovlivnit jen klubový režim → skóre se liší.
    expect(national.homeScore).not.toBe(club.homeScore);
  });

  it("REPREZENTACE: držení míče se NEVYŘAZUJE (má ho 99,5 % zápasů se statistikami)", () => {
    const scores = computeCategoryScores(
      [mv("POSSESSION", 60)],
      [mv("POSSESSION", 40)],
      "TOTAL",
      "NATIONAL"
    );
    const ball = cat(scores, "ball_control");
    expect(ball.available).toBe(true);
    expect(ball.homeScore).toBeCloseTo(6, 5);
  });

  it("venue varianta má přednost, ale padá zpět na TOTAL", () => {
    const home = [mv("GOALS_FOR", 3, "HOME"), mv("GOALS_FOR", 2, "TOTAL")];
    const away = [mv("GOALS_FOR", 1, "TOTAL")]; // jen TOTAL → fallback
    const scores = computeCategoryScores(home, away, "HOME", "CLUB");
    // 3 vs 1 (ne 2 vs 1) → domácí share 0.75
    expect(cat(scores, "attack").homeScore).toBeCloseTo(7.5, 5);
  });

  it("lowConfidence kterékoli strany označí celou kategorii", () => {
    const scores = computeCategoryScores(
      [mv("GOALS_FOR", 2, "TOTAL", { lowConfidence: true })],
      [mv("GOALS_FOR", 1)],
      "TOTAL",
      "CLUB"
    );
    expect(cat(scores, "attack").lowConfidence).toBe(true);
  });

  it("váhy uvnitř kategorie se skutečně uplatní", () => {
    // Útok: GOALS_FOR má váhu 3, SHOTS_OUTSIDE_BOX není v Útoku vůbec.
    // Když domácí dominují v metrice s vahou 3 a prohrávají v metrice s vahou 2,
    // musí výsledek zůstat na jejich straně.
    const scores = computeCategoryScores(
      [mv("GOALS_FOR", 3), mv("SHOTS_ON_TARGET", 3)],
      [mv("GOALS_FOR", 1), mv("SHOTS_ON_TARGET", 4)],
      "TOTAL",
      "CLUB"
    );
    expect(cat(scores, "attack").homeScore).toBeGreaterThan(5);
  });

  it("vrací všech 5 kategorií ve stabilním pořadí", () => {
    // UI je vykresluje v pořadí, v jakém přijdou – přeházení by tiše změnilo rozvržení.
    const keys = computeCategoryScores([], [], "TOTAL", "CLUB").map((c) => c.key);
    expect(keys).toEqual([
      "attack",
      "defense",
      "ball_control",
      "chance_creation",
      "discipline",
    ]);
  });
});
