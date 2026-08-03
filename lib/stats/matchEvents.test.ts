import { describe, expect, it } from "vitest";
import type { ApiFixtureEvent } from "@/lib/data/apiFootball";
import { buildMatchEvents, formatMinute } from "./matchEvents";

function ev(over: Partial<ApiFixtureEvent> = {}): ApiFixtureEvent {
  return {
    time: { elapsed: 10, extra: null },
    team: { id: 640, name: "Mladá Boleslav", logo: null },
    player: { id: 1, name: "S. John" },
    assist: { id: 2, name: "J. Klíma" },
    type: "Goal",
    detail: "Normal Goal",
    comments: null,
    ...over,
  };
}

describe("buildMatchEvents", () => {
  it("mapuje gól včetně asistence", () => {
    const [e] = buildMatchEvents([ev()]);
    expect(e.kind).toBe("goal");
    expect(e.player).toBe("S. John");
    expect(e.assist).toBe("J. Klíma");
    expect(e.teamId).toBe(640);
  });

  // Tohle je hlavní past celého endpointu: `type` chodí „Goal"/„Card", ale „subst".
  it("pozná střídání navzdory malému písmenu v `type`", () => {
    const [e] = buildMatchEvents([
      ev({ type: "subst", detail: "Substitution 1" }),
    ]);
    expect(e.kind).toBe("sub");
  });

  it("u střídání je player odcházející a assist přicházející", () => {
    const [e] = buildMatchEvents([
      ev({
        type: "subst",
        detail: "Substitution 1",
        player: { id: 1, name: "Odchází" },
        assist: { id: 2, name: "Přichází" },
      }),
    ]);
    expect(e.player).toBe("Odchází");
    expect(e.assist).toBe("Přichází");
  });

  it("rozliší vlastní gól a penaltu", () => {
    const kinds = buildMatchEvents([
      ev({ detail: "Own Goal" }),
      ev({ detail: "Penalty" }),
    ]).map((e) => e.kind);
    expect(kinds).toEqual(["ownGoal", "penalty"]);
  });

  it("u vlastního gólu NEuvádí asistenci", () => {
    const [e] = buildMatchEvents([ev({ detail: "Own Goal" })]);
    expect(e.assist).toBeNull();
  });

  it("neproměněná penalta není gól", () => {
    expect(buildMatchEvents([ev({ detail: "Missed Penalty" })])).toEqual([]);
  });

  it("rozliší žlutou a červenou", () => {
    const kinds = buildMatchEvents([
      ev({ type: "Card", detail: "Yellow Card" }),
      ev({ type: "Card", detail: "Red Card" }),
    ]).map((e) => e.kind);
    expect(kinds).toEqual(["yellow", "red"]);
  });

  it("VAR a neznámé typy zahazuje (bez kontextu matou)", () => {
    expect(
      buildMatchEvents([
        ev({ type: "Var", detail: "Goal cancelled" }),
        ev({ type: "Neco", detail: "Jineho" }),
      ])
    ).toEqual([]);
  });

  it("událost bez minuty zahodí (nedá se zařadit)", () => {
    expect(buildMatchEvents([ev({ time: { elapsed: null, extra: null } })])).toEqual([]);
  });

  it("prázdné jméno je totéž co chybějící", () => {
    const [e] = buildMatchEvents([ev({ player: { id: 1, name: "  " }, assist: null })]);
    expect(e.player).toBeNull();
    expect(e.assist).toBeNull();
  });

  it("řadí chronologicky včetně nastavení", () => {
    const order = buildMatchEvents([
      ev({ time: { elapsed: 90, extra: 3 } }),
      ev({ time: { elapsed: 45, extra: null } }),
      ev({ time: { elapsed: 90, extra: null } }),
    ]).map((e) => `${e.minute}+${e.extra ?? 0}`);
    expect(order).toEqual(["45+0", "90+0", "90+3"]);
  });
});

describe("formatMinute", () => {
  it("nastavení píše jako 90+3'", () => {
    const [e] = buildMatchEvents([ev({ time: { elapsed: 90, extra: 3 } })]);
    expect(formatMinute(e)).toBe("90+3'");
  });

  it("bez nastavení jen minutu", () => {
    const [e] = buildMatchEvents([ev({ time: { elapsed: 67, extra: null } })]);
    expect(formatMinute(e)).toBe("67'");
  });
});
