import type { ApiFixtureEvent } from "@/lib/data/apiFootball";

/**
 * Průběh zápasu = góly, karty a střídání na časové ose.
 *
 * **Čistá vrstva bez závislosti na zdroji** (stejné pravidlo jako `lib/stats/*`): tady se
 * jen normalizuje syrová odpověď API. Vzniklo z toho, že appka uměla ukázat *výsledek*
 * i *statistiky*, ale ne *co se v zápase stalo* – `/fixtures/events` se nevolal vůbec.
 */

export type MatchEventKind = "goal" | "ownGoal" | "penalty" | "yellow" | "red" | "sub";

export interface MatchEvent {
  /** Minuta včetně nastavení (90+3 → `minute: 90`, `extra: 3`). */
  minute: number;
  extra: number | null;
  kind: MatchEventKind;
  teamId: number;
  /** Kdo to udělal; u střídání **odcházející** hráč. `null` = API jméno nedalo. */
  player: string | null;
  /**
   * Doplňkový hráč: u gólu asistent, u střídání **přicházející**. U vlastního gólu
   * schválně `null` – „asistence" u vlastňáku by byla nesmyslná.
   */
  assist: string | null;
}

/** Prázdné jméno („", „ ") je pro UI totéž co chybějící. */
function name(p: { name?: string | null } | null | undefined): string | null {
  const n = p?.name?.trim();
  return n ? n : null;
}

/**
 * Typ události. **`type` chodí s nekonzistentní velikostí písmen** – „Goal", „Card",
 * ale „subst" – takže se porovnává výhradně malými písmeny. Kdyby se to porovnalo
 * doslova, střídání by tiše vypadla a nikdo by si toho nevšiml.
 */
function kindOf(e: ApiFixtureEvent): MatchEventKind | null {
  const type = e.type.toLowerCase();
  const detail = e.detail.toLowerCase();

  if (type === "goal") {
    // „Missed Penalty" je taky typ Goal, ale gól to není – nesmí se objevit na ose gólů.
    if (detail.includes("missed")) return null;
    if (detail.includes("own")) return "ownGoal";
    if (detail.includes("penalty")) return "penalty";
    return "goal";
  }
  if (type === "card") {
    if (detail.includes("red")) return "red";
    if (detail.includes("yellow")) return "yellow";
    return null;
  }
  if (type === "subst") return "sub";
  // `Var` a cokoli neznámého vědomě zahazujeme: VAR událost bez kontextu („Goal
  // cancelled") čte laik jako gól. Radši nic než matoucí řádek.
  return null;
}

/**
 * Normalizuje odpověď `/fixtures/events` na časovou osu.
 *
 * Události bez minuty se zahazují (nedaly by se zařadit), řazení je stabilní podle
 * minuty včetně nastavení – API je vrací zhruba chronologicky, ale zaručené to není.
 */
export function buildMatchEvents(raw: ApiFixtureEvent[]): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (const e of raw) {
    const kind = kindOf(e);
    if (kind == null) continue;
    if (e.time.elapsed == null) continue;
    out.push({
      minute: e.time.elapsed,
      extra: e.time.extra ?? null,
      kind,
      teamId: e.team.id,
      player: name(e.player),
      assist: kind === "ownGoal" ? null : name(e.assist),
    });
  }
  return out.sort(
    (a, b) => a.minute - b.minute || (a.extra ?? 0) - (b.extra ?? 0)
  );
}

/** „67'" / „90+3'" – tak, jak se minuta píše na tabuli. */
export function formatMinute(e: MatchEvent): string {
  return e.extra != null && e.extra > 0
    ? `${e.minute}+${e.extra}'`
    : `${e.minute}'`;
}

export const EVENT_ICON: Record<MatchEventKind, string> = {
  goal: "⚽",
  ownGoal: "🥅",
  penalty: "⚽",
  yellow: "🟨",
  red: "🟥",
  sub: "🔁",
};

/** Popisek pro odečítač i pro `title` – ikona sama význam nenese. */
export const EVENT_LABEL: Record<MatchEventKind, string> = {
  goal: "Gól",
  ownGoal: "Vlastní gól",
  penalty: "Gól z penalty",
  yellow: "Žlutá karta",
  red: "Červená karta",
  sub: "Střídání",
};
