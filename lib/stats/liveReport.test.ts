import { describe, expect, it } from "vitest";
import { buildLiveReport, effectiveMinute, type LiveReport } from "./liveReport";
import { buildMatchDimensions, buildMatchReport, type MatchSide } from "./matchReport";

/**
 * Fixtury jsou **skutečné živé zápasy** odchycené sondou 31. 7. 2026 – ne vymyšlená čísla.
 * Díky tomu testy hlídají i to, že prahy sedí na reálná rozdělení, ne jen na kulaté vstupy.
 */

/** Sparta–Zlín, 88. minuta, stav 3:1. Jasná převaha domácích i v držení. */
const SPARTA: MatchSide = {
  SHOTS_ON_TARGET: 4, SHOTS_OFF_TARGET: 6, SHOTS: 11, BLOCKED_SHOTS: 1,
  SHOTS_INSIDE_BOX: 5, SHOTS_OUTSIDE_BOX: 6, FOULS: 12, CORNERS: 5, OFFSIDES: 1,
  POSSESSION: 66, YELLOW_CARDS: 0, SAVES: 1, PASSES_TOTAL: 429, PASSES_ACCURATE: 380,
  PASS_ACCURACY: 89, XG: 2.06,
};
const ZLIN: MatchSide = {
  SHOTS_ON_TARGET: 2, SHOTS_OFF_TARGET: 7, SHOTS: 11, BLOCKED_SHOTS: 2,
  SHOTS_INSIDE_BOX: 6, SHOTS_OUTSIDE_BOX: 5, FOULS: 12, CORNERS: 3, OFFSIDES: 0,
  POSSESSION: 34, YELLOW_CARDS: 2, SAVES: 1, PASSES_TOTAL: 218, PASSES_ACCURATE: 173,
  PASS_ACCURACY: 79, XG: 0.85,
};

/** Lask–Grazer, 72. minuta, stav 2:0. Extrémně jednostranné (xG 2.19 : 0.02). */
const LASK: MatchSide = {
  SHOTS_ON_TARGET: 8, SHOTS_OFF_TARGET: 10, SHOTS: 20, BLOCKED_SHOTS: 2,
  SHOTS_INSIDE_BOX: 9, SHOTS_OUTSIDE_BOX: 11, FOULS: 9, CORNERS: 5, OFFSIDES: 3,
  POSSESSION: 59, YELLOW_CARDS: 0, SAVES: 0, PASSES_TOTAL: 439, PASSES_ACCURATE: 391,
  PASS_ACCURACY: 89, XG: 2.19,
};
const GRAZER: MatchSide = {
  SHOTS_ON_TARGET: 0, SHOTS_OFF_TARGET: 1, SHOTS: 1, BLOCKED_SHOTS: 0,
  SHOTS_INSIDE_BOX: 0, SHOTS_OUTSIDE_BOX: 1, FOULS: 10, CORNERS: 1, OFFSIDES: 2,
  POSSESSION: 41, YELLOW_CARDS: 1, SAVES: 6, PASSES_TOTAL: 305, PASSES_ACCURATE: 245,
  PASS_ACCURACY: 80, XG: 0.02,
};

/** Motor–Jagiellonia, 11. minuta. Skoro se nic nestalo – nesmí se z toho nic vyvozovat. */
const MOTOR: MatchSide = {
  SHOTS_ON_TARGET: 0, SHOTS_OFF_TARGET: 1, SHOTS: 1, SHOTS_INSIDE_BOX: 1,
  FOULS: 0, CORNERS: 0, POSSESSION: 42, PASSES_TOTAL: 34, PASSES_ACCURATE: 26, XG: 0.04,
};
const JAGIELLONIA: MatchSide = {
  SHOTS_ON_TARGET: 0, SHOTS_OFF_TARGET: 1, SHOTS: 1, SHOTS_INSIDE_BOX: 1,
  FOULS: 1, CORNERS: 1, POSSESSION: 58, PASSES_TOTAL: 45, PASSES_ACCURATE: 39, XG: 0.08,
};

const TEAMS = { home: "Sparta", away: "Zlín" };

function live(
  home: MatchSide,
  away: MatchSide,
  elapsed: number,
  goals: { home: number; away: number } | null = null,
  teams = TEAMS,
  status = "2H"
): LiveReport {
  return buildLiveReport({ home, away, teams, goals, elapsed, status });
}

/** Všechny věty reportu – headline i poznámky. */
const sentences = (r: LiveReport): string[] =>
  [r.headline, ...r.notes].filter((s) => s.length > 0);

describe("effectiveMinute", () => {
  it("poločas je 45, prodloužení a penalty plný objem", () => {
    expect(effectiveMinute("HT", null)).toBe(45);
    expect(effectiveMinute("BT", null)).toBe(90);
    expect(effectiveMinute("P", null)).toBe(90);
  });
  it("nastavení se ořízne na 90 – prahy jsou vztažené k 90 minutám", () => {
    expect(effectiveMinute("2H", 90)).toBe(90);
    expect(effectiveMinute("ET", 105)).toBe(90);
  });
  it("chybějící minuta se odhadne z poloviny, ne z nuly", () => {
    expect(effectiveMinute("2H", null)).toBe(45);
    expect(effectiveMinute("1H", null)).toBe(0);
  });
});

describe("brány objemu a času", () => {
  it("v 11. minutě se nevyvozuje nic", () => {
    const r = live(MOTOR, JAGIELLONIA, 11, { home: 0, away: 0 });
    expect(r.available).toBe(false);
    expect(r.reason).toBe("early");
    expect(r.notes).toEqual([]);
    expect(r.character).toEqual({ openness: null, balance: null, intensity: null });
  });

  it("po 20. minutě, ale s nulovým objemem, mlčí o nebezpečnosti", () => {
    // Tatáž chudá čísla, jen posunutá v čase: xG celkem 0.12 < práh 0.5.
    const r = live(MOTOR, JAGIELLONIA, 35, { home: 0, away: 0 });
    const threat = r.dimensions.find((d) => d.key === "THREAT")!;
    expect(threat.available).toBe(false);
    expect(r.character.balance).toBeNull();
  });

  it("chudý zápas dostane větu o objemu, ne prázdný panel", () => {
    // Malý objem je dobře změřený (součet nemá jmenovatele blízko nule), takže se o něm
    // MLUVIT dá – jen se z něj nesmí vyvozovat, kdo je lepší.
    const r = live(MOTOR, JAGIELLONIA, 35, { home: 0, away: 0 });
    expect(r.available).toBe(true);
    expect(r.headline).toBe("Za 35 minut je toho zatím málo – dohromady 2 střely.");
  });

  it("dostupný report nikdy nemá prázdný headline", () => {
    const cases: LiveReport[] = [
      live(SPARTA, ZLIN, 88, { home: 3, away: 1 }),
      live(MOTOR, JAGIELLONIA, 35, { home: 0, away: 0 }),
      live({ POSSESSION: 55 }, { POSSESSION: 45 }, 50, { home: 0, away: 0 }),
      live(LASK, GRAZER, 72, { home: 2, away: 0 }, { home: "Lask", away: "Grazer" }),
    ];
    for (const r of cases) {
      if (r.available) expect(r.headline.length).toBeGreaterThan(0);
    }
  });

  it("Proměňování v živém reportu není nikdy", () => {
    const r = live(SPARTA, ZLIN, 88, { home: 3, away: 1 });
    expect(r.dimensions.map((d) => d.key)).toEqual(["CONTROL", "THREAT", "PHYSICAL"]);
  });

  it("součet obou stran je vždy 10 (invariant pruhů)", () => {
    const r = live(SPARTA, ZLIN, 88, { home: 3, away: 1 });
    for (const d of r.dimensions) {
      expect(d.home + d.away).toBeCloseTo(10, 5);
    }
  });
});

describe("povaha zápasu – škálování časem", () => {
  const withFouls = (n: number): MatchSide => ({ ...SPARTA, FOULS: n });

  it("10 faulů ve 30. minutě je ostrý zápas (pro rata na 26 za 90)", () => {
    const r = live(withFouls(5), { ...ZLIN, FOULS: 5 }, 30, { home: 0, away: 0 });
    expect(r.character.intensity).toBe("ostrý");
  });

  it("6 faulů ve 30. minutě nestačí ani na výrok – brána objemu je dřív", () => {
    const r = live(withFouls(3), { ...ZLIN, FOULS: 3 }, 30, { home: 0, away: 0 });
    expect(r.character.intensity).toBeNull();
  });

  it("„zatím klidný“ nepadne před poločasem, i když čísla sedí", () => {
    // 10 faulů v 60. minutě je pod škálovaným prahem klidu (16 × 0.67 = 10.7).
    const late = live(withFouls(5), { ...ZLIN, FOULS: 5 }, 60, { home: 0, away: 0 });
    expect(late.character.intensity).toBe("zatím klidný");
    // Tatáž čísla ve 40. minutě: nepřítomnost se tak brzy tvrdit nedá.
    const early = live(withFouls(5), { ...ZLIN, FOULS: 5 }, 40, { home: 0, away: 0 });
    expect(early.character.intensity).not.toBe("zatím klidný");
  });

  it("jednostrannost je podíl – neškáluje se a pozná se i dřív", () => {
    const r = live(LASK, GRAZER, 30, { home: 1, away: 0 }, { home: "Lask", away: "Grazer" });
    expect(r.character.balance).toBe("jednostranný průběh");
  });
});

describe("headline", () => {
  it("držení i šance na téže straně → „určuje hru“ (Sparta–Zlín 88')", () => {
    const r = live(SPARTA, ZLIN, 88, { home: 3, away: 1 });
    expect(r.headline).toBe(
      "Sparta zatím určuje hru: 66 % držení a víc vytvořených šancí (xG 2.06 : 0.85)."
    );
  });

  it("míč na jedné straně, šance na druhé → míč se nezamlčí, ale nevydává za převahu", () => {
    // Držení prohodíme: nebezpečnější je Sparta, míč má Zlín.
    const r = live({ ...SPARTA, POSSESSION: 34 }, { ...ZLIN, POSSESSION: 66 }, 70, {
      home: 1, away: 0,
    });
    expect(r.headline).toContain("Míč má Zlín (66 %)");
    expect(r.headline).toContain("nebezpečnější je zatím Sparta");
  });

  it("držení bez šancí nedostane pochvalu, ale konstatování", () => {
    // xG pod bránou → o nebezpečnosti se mlčí, o míči ne.
    const home = { ...MOTOR, POSSESSION: 64, PASSES_ACCURATE: 300 };
    const away = { ...JAGIELLONIA, POSSESSION: 36, PASSES_ACCURATE: 150 };
    const r = live(home, away, 40, { home: 0, away: 0 });
    expect(r.headline).toContain("má víc míče (64 %)");
    expect(r.headline).toContain("do šancí se to zatím nepromítá");
  });

  it("oslabení soupeře se přizná – jinak se převaha přečte jako taktika", () => {
    const r = live(LASK, { ...GRAZER, RED_CARDS: 1 }, 72, { home: 2, away: 0 }, {
      home: "Lask", away: "Grazer",
    });
    expect(r.headline).toContain("Soupeř přitom hraje v oslabení");
    expect(r.notes[0]).toBe("Grazer hraje v oslabení (1× červená karta).");
  });
});

describe("poznámky", () => {
  it("brankář a standardky (Lask–Grazer 72')", () => {
    const r = live(LASK, GRAZER, 72, { home: 2, away: 0 }, { home: "Lask", away: "Grazer" });
    expect(r.notes).toContain("Brankář Grazer musel zatím zasáhnout 6×.");
    expect(r.notes).toContain("Lask tlačí ze standardek – rohy 5 : 1.");
  });

  it("rozpor mezi hrou a stavem má přednost před kosmetikou", () => {
    // Lepší je Lask, ale vede soupeř.
    const r = live(LASK, GRAZER, 72, { home: 0, away: 1 }, { home: "Lask", away: "Grazer" });
    expect(r.notes[0]).toBe(
      "Na hřišti je zatím lepší Lask, na ukazateli ale vede Grazer 0:1."
    );
  });

  it("proměňování se nehodnotí před 70. minutou", () => {
    const early = live(SPARTA, ZLIN, 60, { home: 3, away: 0 });
    expect(early.notes.join(" ")).not.toContain("nad očekáváním");
    const late = live(SPARTA, ZLIN, 80, { home: 4, away: 0 });
    expect(late.notes.join(" ")).toContain("nad očekáváním");
  });

  it("vývoj po přestávce se hlásí jen ve druhém poločase", () => {
    // API sype do `halftime` v prvním poločase PRŮBĚŽNÉ skóre (ověřeno živě), takže
    // věta o vývoji po přestávce by tam byla vždy pravdivá a vždy bezcenná.
    const prvni = buildLiveReport({
      home: SPARTA, away: ZLIN, teams: TEAMS,
      goals: { home: 1, away: 0 }, elapsed: 40, status: "1H",
      halftime: { home: 1, away: 0 },
    });
    expect(prvni.notes.join(" ")).not.toContain("poločas");

    const druhy = buildLiveReport({
      home: SPARTA, away: ZLIN, teams: TEAMS,
      goals: { home: 3, away: 1 }, elapsed: 72, status: "2H",
      halftime: { home: 1, away: 1 },
    });
    expect(druhy.notes.join(" ")).toContain("Druhý poločas zatím přinesl 2 góly.");

    const bezeZmeny = buildLiveReport({
      home: SPARTA, away: ZLIN, teams: TEAMS,
      goals: { home: 1, away: 1 }, elapsed: 72, status: "2H",
      halftime: { home: 1, away: 1 },
    });
    expect(bezeZmeny.notes.join(" ")).toContain("Od poločasu (1:1) se skóre zatím nezměnilo.");
  });

  it("nejvýš tři poznámky", () => {
    const r = live(LASK, { ...GRAZER, RED_CARDS: 1, YELLOW_CARDS: 5 }, 85, {
      home: 0, away: 1,
    }, { home: "Lask", away: "Grazer" });
    expect(r.notes.length).toBeLessThanOrEqual(3);
  });
});

/**
 * Tvrdá pojistka na formulace. Přítomný čas svádí k větám, které znějí jako závěr –
 * a „má zápas pod kontrolou" je predikce výsledku vydávaná za popis, i když ji uživatel
 * sám navrhl. Kontroluje se strojově napříč scénáři, ne jen v jedné větě.
 */
describe("jazyk", () => {
  const ZAKAZANE = /zaslouž|ovládl|ovládá|vyhraj|prohraj|bude|měl by|jistě|rozhod(l|ne)|pod kontrolou/i;

  const scenarios: LiveReport[] = [
    live(SPARTA, ZLIN, 25, { home: 0, away: 0 }),
    live(SPARTA, ZLIN, 45, { home: 1, away: 0 }),
    live(SPARTA, ZLIN, 88, { home: 3, away: 1 }),
    live(ZLIN, SPARTA, 70, { home: 0, away: 2 }),
    live(LASK, GRAZER, 30, { home: 1, away: 0 }, { home: "Lask", away: "Grazer" }),
    live(LASK, GRAZER, 72, { home: 2, away: 0 }, { home: "Lask", away: "Grazer" }),
    live(LASK, GRAZER, 72, { home: 0, away: 1 }, { home: "Lask", away: "Grazer" }),
    live(GRAZER, LASK, 80, { home: 1, away: 1 }, { home: "Grazer", away: "Lask" }),
    live(MOTOR, JAGIELLONIA, 11, { home: 0, away: 0 }),
    live(MOTOR, JAGIELLONIA, 35, { home: 0, away: 0 }),
    live({ ...SPARTA, RED_CARDS: 1 }, ZLIN, 60, { home: 0, away: 1 }),
    live({}, {}, 55, { home: 0, away: 0 }),
  ];

  it("žádná věta neslibuje výsledek", () => {
    for (const r of scenarios) {
      for (const s of sentences(r)) {
        expect(s, `zakázaná formulace: „${s}“`).not.toMatch(ZAKAZANE);
      }
    }
  });

  it("každá věta je ukotvená – obsahuje „zatím“ nebo číslo", () => {
    // Nemarkerovaná věta v přítomném čase se čte jako závěr o zápase.
    for (const r of scenarios) {
      for (const s of sentences(r)) {
        expect(s, `věta bez ukotvení: „${s}“`).toMatch(/zatím|\d/i);
      }
    }
  });

  it("čísla se skloňují – „3 karty“, ne „3 karet“", () => {
    // Počty se do vět dosazují z dat, takže tvar nejde napsat natvrdo.
    // V 45. minutě je škálovaný práh karet přesně 3 (6 za 90 × 0.5), takže nota sepne.
    const ostry = live(
      { ...SPARTA, YELLOW_CARDS: 2 },
      { ...ZLIN, YELLOW_CARDS: 1 },
      45,
      { home: 1, away: 0 }
    );
    expect(ostry.notes.join(" ")).toContain("3 karty");

    const jedenGol = live(SPARTA, ZLIN, 80, { home: 1, away: 0 });
    expect(jedenGol.notes.join(" ")).not.toContain("1 góly");

    const jednaStrela = live(
      { ...MOTOR, SHOTS: 1 },
      { ...JAGIELLONIA, SHOTS: 0 },
      30,
      { home: 0, away: 0 }
    );
    expect(jednaStrela.headline).toContain("1 střela");
  });

  it("bez jakýchkoli statistik se nic nevymýšlí", () => {
    const r = live({}, {}, 55, { home: 0, away: 0 });
    expect(r.available).toBe(false);
    expect(r.reason).toBe("nodata");
    expect(r.notes).toEqual([]);
  });
});

/**
 * Regresní pojistka refaktoru: živý i dohraný report berou rozměry z jedné funkce.
 * Kdyby se `buildMatchDimensions` rozešla s tím, co počítá `buildMatchReport`, pruhy
 * v jednom z panelů by přestaly odpovídat číslům nad nimi.
 */
describe("sdílené rozměry", () => {
  it("buildMatchDimensions dává pro týž vstup stejná čísla jako buildMatchReport", () => {
    const withGoals = {
      home: { ...SPARTA, GOALS_FOR: 3 },
      away: { ...ZLIN, GOALS_FOR: 1 },
    };
    const dims = buildMatchDimensions(withGoals.home, withGoals.away);
    const report = buildMatchReport(SPARTA, ZLIN, TEAMS, { home: 3, away: 1 });
    for (const d of report.dimensions) {
      expect(dims[d.key].home).toBe(d.home);
      expect(dims[d.key].away).toBe(d.away);
      expect(dims[d.key].detail).toBe(d.detail);
    }
  });
});
