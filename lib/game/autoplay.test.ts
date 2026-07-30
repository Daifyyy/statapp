import { describe, expect, it } from "vitest";
import { needsYou, playUntilDecision, STOP_REASON_LABEL } from "./autoplay";
import {
  AUTOPLAY_FINALE_ROUNDS,
  AUTOPLAY_FITNESS_FLOOR,
  AUTOPLAY_MAX_ROUNDS,
} from "./balance";
import { generateLeague } from "./teams";
import { isSeasonOver, newSeason, simulateToEnd, setPlan } from "./engine";
import { teamStrengthScore } from "./leagues";
import type { SeasonState } from "./types";

const league = generateLeague(41);
const mid = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a))[
  Math.floor(league.length / 2)
];
const base = newSeason(41, mid.id, { teams: league });

/** Stav bez čekající události – ta by přebila všechny ostatní důvody. */
const calm = (over: Partial<SeasonState> = {}): SeasonState => ({
  ...base,
  pendingEvent: null,
  ...over,
});

describe("needsYou", () => {
  it("nevyřešená událost je blokující důvod", () => {
    const s = calm({ pendingEvent: { id: "x", round: 0 } });
    expect(needsYou(s)).toBe("event");
  });

  it("dohraná sezóna hlásí konec", () => {
    expect(needsYou(simulateToEnd(base))).toBe("season_over");
  });

  it("závěr sezóny se hraje ručně", () => {
    const s = calm({ round: base.schedule.length - AUTOPLAY_FINALE_ROUNDS });
    expect(needsYou(s)).toBe("finale");
  });

  it("vyčerpaný tým si vyžádá pohled na plán", () => {
    // Kolo mimo finále a mimo rozjezd tabulky, ať se nechytne jiný důvod dřív.
    const s = calm({ round: 10, fitness: AUTOPLAY_FITNESS_FLOOR - 1 });
    const reason = needsYou(s);
    // `rival`/`must_win` mají přednost – testujeme, že aspoň jeden důvod padne
    // a že při plné kondici v témže kole je situace klidnější nebo stejná.
    expect(reason).not.toBeNull();
    if (needsYou(calm({ round: 10, fitness: 100 })) === null) {
      expect(reason).toBe("fitness");
    }
  });

  it("v klidném kole nechá hrát dál", () => {
    // Aspoň jedno rané kolo bez události musí projít bez zastávky – jinak by
    // „Hrát dál" nikdy nic neodehrálo a tlačítko by bylo zbytečné.
    const anyCalm = [0, 1, 2, 3, 4].some((round) => needsYou(calm({ round })) === null);
    expect(anyCalm).toBe(true);
  });

  it("každý důvod má popisek pro UI", () => {
    for (const r of [
      "event",
      "must_win",
      "rival",
      "finale",
      "fitness",
      "cap",
      "season_over",
    ] as const) {
      expect(STOP_REASON_LABEL[r].length).toBeGreaterThan(0);
    }
  });
});

describe("playUntilDecision", () => {
  it("odehraje aspoň jedno kolo, i když stop podmínka platí hned", () => {
    // Hráč právě obsluhuje důvod, kvůli kterému se stálo – jinak by klik nic neudělal.
    const s = calm({ round: base.schedule.length - 1 });
    const out = playUntilDecision(s);
    expect(out.rounds).toBeGreaterThanOrEqual(1);
    expect(out.state.round).toBe(s.round + out.rounds);
  });

  it("nepřekročí strop kol na jeden klik", () => {
    let s = calm();
    for (let i = 0; i < 12 && !isSeasonOver(s); i++) {
      const out = playUntilDecision(s);
      expect(out.rounds).toBeLessThanOrEqual(AUTOPLAY_MAX_ROUNDS);
      s = out.state;
    }
  });

  it("dohraná sezóna neodehraje nic", () => {
    const out = playUntilDecision(simulateToEnd(base));
    expect(out.rounds).toBe(0);
    expect(out.reason).toBe("season_over");
  });

  it("nikdy nepřejede konec sezóny", () => {
    let s = calm();
    while (!isSeasonOver(s)) s = playUntilDecision(s).state;
    expect(s.round).toBe(s.schedule.length);
  });

  /**
   * Autoplay jede se STÁVAJÍCÍM plánem – kdyby si sám vybíral doporučení skautů, hráč by
   * jedním klikem dostal radu, kterou má jinak až za investici do skautingu.
   */
  it("nemění zvolený plán ani instrukci", () => {
    const s = setPlan(calm(), "low_block");
    const out = playUntilDecision(s);
    expect(out.state.plan).toBe("low_block");
    expect(out.state.instruction).toBe(s.instruction);
  });

  /** Sezóna přes „Hrát dál" musí dát tytéž výsledky jako ruční hra (týž RNG na kolo). */
  it("výsledky sedí na ruční hru kolo po kole", () => {
    let auto = calm();
    while (!isSeasonOver(auto)) auto = playUntilDecision(auto).state;
    const manual = simulateToEnd(calm());
    expect(auto.results.map((r) => `${r.homeGoals}:${r.awayGoals}`)).toEqual(
      manual.results.map((r) => `${r.homeGoals}:${r.awayGoals}`)
    );
  });
});
