import { describe, expect, it } from "vitest";
import { computeRatings, type RatingMatch, type RatingOptions } from "./ratings";

const OPTS: RatingOptions = {
  halfLifeDays: 270,
  shrinkMatches: 2,
  xgWeight: 0,
  iterations: 5,
  home: 1.5,
  away: 1.2,
};

function m(
  date: string,
  homeId: number,
  awayId: number,
  homeGoals: number,
  awayGoals: number
): RatingMatch {
  return { date, homeId, awayId, homeGoals, awayGoals };
}

/** Vyrovnaná liga 4 týmů: každý s každým, samé 1:1 → nikdo nevyčnívá. */
const BALANCED: RatingMatch[] = [
  m("2025-08-01T15:00:00Z", 1, 2, 1, 1),
  m("2025-08-08T15:00:00Z", 3, 4, 1, 1),
  m("2025-08-15T15:00:00Z", 1, 3, 1, 1),
  m("2025-08-22T15:00:00Z", 2, 4, 1, 1),
  m("2025-08-29T15:00:00Z", 1, 4, 1, 1),
  m("2025-09-05T15:00:00Z", 2, 3, 1, 1),
];

describe("computeRatings", () => {
  it("ligový průměr je 1.0 (normalizace)", () => {
    const r = computeRatings(BALANCED, "2025-09-10T00:00:00Z", OPTS);
    const att = [...r.values()].map((s) => s.attack);
    const mean = att.reduce((a, b) => a + b, 0) / att.length;
    expect(mean).toBeCloseTo(1, 6);
  });

  it("point-in-time: zápasy po `asOf` se ignorují (žádný leak)", () => {
    // K 15. 8. zná model jen první dva zápasy → tým 4 ještě neodehrál nic proti 1 ani 2.
    const early = computeRatings(BALANCED, "2025-08-10T00:00:00Z", OPTS);
    const late = computeRatings(BALANCED, "2025-09-10T00:00:00Z", OPTS);
    expect(early.get(1)!.sample).toBeLessThan(late.get(1)!.sample);
  });

  it("KOREKCE NA SOUPEŘE: dát 2 góly elitní obraně váží víc než 2 góly dnu tabulky", () => {
    // Tým 5 je propustná obrana (dostane 4 od každého), tým 6 je pevná (nedostane nic).
    const league: RatingMatch[] = [
      m("2025-08-01T15:00:00Z", 5, 3, 0, 4),
      m("2025-08-02T15:00:00Z", 5, 4, 0, 4),
      m("2025-08-03T15:00:00Z", 6, 3, 0, 0),
      m("2025-08-04T15:00:00Z", 6, 4, 0, 0),
      // Tým 1 dal dva góly PEVNÉ obraně, tým 2 dal dva góly PROPUSTNÉ.
      m("2025-08-05T15:00:00Z", 1, 6, 2, 0),
      m("2025-08-06T15:00:00Z", 2, 5, 2, 0),
    ];
    const r = computeRatings(league, "2025-08-10T00:00:00Z", OPTS);
    // Stejný počet gólů, ale proti nesrovnatelné obraně → tým 1 musí mít vyšší útok.
    expect(r.get(1)!.attack).toBeGreaterThan(r.get(2)!.attack);
  });

  it("ČASOVÝ ÚTLUM: starý výkon váží míň než čerstvý", () => {
    const teamStrongLately: RatingMatch[] = [
      m("2024-01-01T15:00:00Z", 1, 2, 0, 3), // dávno: tým 1 dostal výprask
      m("2025-09-01T15:00:00Z", 1, 2, 3, 0), // nedávno: tým 1 vyhrál 3:0
    ];
    const teamStrongLongAgo: RatingMatch[] = [
      m("2024-01-01T15:00:00Z", 1, 2, 3, 0),
      m("2025-09-01T15:00:00Z", 1, 2, 0, 3),
    ];
    const a = computeRatings(teamStrongLately, "2025-09-10T00:00:00Z", OPTS).get(1)!;
    const b = computeRatings(teamStrongLongAgo, "2025-09-10T00:00:00Z", OPTS).get(1)!;
    // Stejné zápasy, jen prohozené v čase → rozhoduje ten čerstvý.
    expect(a.attack).toBeGreaterThan(b.attack);
    expect(a.defense).toBeLessThan(b.defense); // nižší = pevnější obrana
  });

  it("shrinkage: tenký vzorek drží tým u ligového průměru", () => {
    const one: RatingMatch[] = [m("2025-09-01T15:00:00Z", 1, 2, 5, 0)];
    const weak = computeRatings(one, "2025-09-10T00:00:00Z", { ...OPTS, shrinkMatches: 20 });
    const strong = computeRatings(one, "2025-09-10T00:00:00Z", { ...OPTS, shrinkMatches: 0 });
    // Z jednoho zápasu 5:0 se s velkým shrinkage nesmí stát superútok.
    expect(weak.get(1)!.attack).toBeLessThan(strong.get(1)!.attack);
  });

  it("NEUTRÁLNÍ PŮDA: turnajový domácí tým nedostane domácí výhodu", () => {
    // Stejný zápas 1:1, jednou jako kvalifikace (doma/venku), jednou jako turnaj (neutrál).
    const qualif: RatingMatch[] = [m("2025-09-01T15:00:00Z", 1, 2, 1, 1)];
    const neutral: RatingMatch[] = [
      { ...m("2025-09-01T15:00:00Z", 1, 2, 1, 1), neutral: true },
    ];
    const q = computeRatings(qualif, "2025-09-10T00:00:00Z", { ...OPTS, shrinkMatches: 0 });
    const n = computeRatings(neutral, "2025-09-10T00:00:00Z", { ...OPTS, shrinkMatches: 0 });

    // Doma/venku: 1 gól doma je PODprůměr (⌀ 1.5), 1 gól venku NADprůměr (⌀ 1.2) → týmy
    // se rozejdou. Na neutrální půdě je měřítko společné → remíza 1:1 je symetrická.
    expect(q.get(1)!.attack).toBeLessThan(q.get(2)!.attack);
    expect(n.get(1)!.attack).toBeCloseTo(n.get(2)!.attack, 6);
  });

  it("VÁHA ZÁPASU: přátelák (weight 0.5) hýbe ratingem míň než soutěžní zápas", () => {
    const soutezni: RatingMatch[] = [
      m("2025-06-01T15:00:00Z", 1, 2, 1, 1),
      m("2025-09-01T15:00:00Z", 1, 2, 4, 0),
    ];
    const jakoPratelak: RatingMatch[] = [
      m("2025-06-01T15:00:00Z", 1, 2, 1, 1),
      { ...m("2025-09-01T15:00:00Z", 1, 2, 4, 0), weight: 0.2 },
    ];
    const a = computeRatings(soutezni, "2025-09-10T00:00:00Z", OPTS).get(1)!;
    const b = computeRatings(jakoPratelak, "2025-09-10T00:00:00Z", OPTS).get(1)!;
    // Výhra 4:0 v přáteláku nesmí vystřelit útok tak jako v soutěžním zápase.
    expect(b.attack).toBeLessThan(a.attack);
  });

  it("xG se mísí s góly dle váhy (xgWeight)", () => {
    const lucky: RatingMatch[] = [
      { ...m("2025-09-01T15:00:00Z", 1, 2, 3, 0), homeXg: 0.5, awayXg: 1.5 },
    ];
    const byGoals = computeRatings(lucky, "2025-09-10T00:00:00Z", { ...OPTS, xgWeight: 0 });
    const byXg = computeRatings(lucky, "2025-09-10T00:00:00Z", { ...OPTS, xgWeight: 1 });
    // Tým 1 vyhrál 3:0, ale zaslouženě to nebylo → podle xG má být slabší.
    expect(byXg.get(1)!.attack).toBeLessThan(byGoals.get(1)!.attack);
  });
});
