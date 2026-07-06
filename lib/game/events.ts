// Náhodné manažerské eventy – deterministické dle (seed, kolo), malá kurátorovaná sada.
// Event má 2 volby; každá volba je čistá DATA (moraleDelta / dočasný modifikátor), takže
// applyEventChoice je serializovatelná a bezpečná. Choices žijí v registru, na SeasonState
// se drží jen odkaz `pendingEvent {id, round}`.

import { mulberry32, deriveSeed } from "./rng";
import { EVENT_CHANCE } from "./balance";
import type { PendingEvent, SeasonState } from "./types";

interface EventChoiceEffect {
  /** Změna morálky (±). */
  moraleDelta?: number;
  /** Dočasný λ modifikátor: platí `rounds` kol od aktuálního. */
  modifier?: { attack?: number; concede?: number; rounds: number; label: string };
}

export interface EventChoice {
  label: string;
  detail: string;
  effect: EventChoiceEffect;
}

export interface GameEvent {
  id: string;
  title: string;
  text: string;
  choices: EventChoice[];
}

/** Kurátorovaná sada eventů. */
export const EVENTS: GameEvent[] = [
  {
    id: "dressing_room",
    title: "Napětí v kabině",
    text: "Dva klíčoví hráči se pohádali na tréninku.",
    choices: [
      {
        label: "Tvrdý přístup",
        detail: "Disciplína teď, nálada trochu dolů.",
        effect: {
          moraleDelta: -4,
          modifier: { concede: 0.93, rounds: 2, label: "Utažená disciplína" },
        },
      },
      {
        label: "Usmířit tým",
        detail: "Zvedneš náladu, žádný taktický zisk.",
        effect: { moraleDelta: 7 },
      },
    ],
  },
  {
    id: "key_injury",
    title: "Zranění opory",
    text: "Tvoje hvězda se zranila a vypadne na několik zápasů.",
    choices: [
      {
        label: "Zavřít obranu",
        detail: "Uber vzadu na úkor útoku.",
        effect: {
          modifier: { attack: 0.9, concede: 0.95, rounds: 3, label: "Bez opory" },
        },
      },
      {
        label: "Vsadit na útok",
        detail: "Zakryješ ztrátu ofenzivou, ale riskuješ.",
        effect: {
          moraleDelta: 3,
          modifier: { concede: 1.08, rounds: 2, label: "Odvážná náhrada" },
        },
      },
    ],
  },
  {
    id: "media_pressure",
    title: "Mediální tlak",
    text: "Média zpochybňují tvou práci po nevýrazných výsledcích.",
    choices: [
      {
        label: "Postavit se tlaku",
        detail: "Semkne to tým.",
        effect: { moraleDelta: 5 },
      },
      {
        label: "Odstřihnout média",
        detail: "Klid na práci, ale chladná šatna.",
        effect: {
          moraleDelta: -2,
          modifier: { attack: 1.05, rounds: 1, label: "Klid na práci" },
        },
      },
    ],
  },
  {
    id: "board_confidence",
    title: "Důvěra vedení",
    text: "Vedení ti veřejně vyjádřilo podporu.",
    choices: [
      {
        label: "Poděkovat a makat",
        detail: "Sebevědomí nahoru.",
        effect: { moraleDelta: 6 },
      },
      {
        label: "Slíbit poháry",
        detail: "Velký tlak, velká odměna.",
        effect: {
          moraleDelta: 2,
          modifier: { attack: 1.06, concede: 1.03, rounds: 2, label: "Ofenzivní příkaz" },
        },
      },
    ],
  },
  {
    id: "youth_spark",
    title: "Jiskra z akademie",
    text: "Mladík z akademie válí na tréninku.",
    choices: [
      {
        label: "Hodit ho do ohně",
        detail: "Energie a překvapení.",
        effect: {
          moraleDelta: 3,
          modifier: { attack: 1.07, rounds: 2, label: "Mladá krev" },
        },
      },
      {
        label: "Nechat dozrát",
        detail: "Bez rizika, bez zisku.",
        effect: { moraleDelta: 1 },
      },
    ],
  },
];

/** Vyhledá event dle id (pro UI render z pendingEvent). */
export function getEvent(id: string): GameEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}

/**
 * Rozhodne, zda v daném kole nastane event (deterministicky dle seedu+kola). Vrací
 * `{id, round}` nebo null. Salt 90000 odděluje RNG od simulace zápasů (deriveSeed(seed, round)).
 */
export function maybeEvent(seed: number, round: number): PendingEvent | null {
  const rand = mulberry32(deriveSeed(seed, 90000 + round));
  if (rand() >= EVENT_CHANCE) return null;
  const idx = Math.floor(rand() * EVENTS.length);
  return { id: EVENTS[idx].id, round };
}

/**
 * Aplikuje zvolenou možnost pendingEventu: morálka + případný dočasný modifikátor
 * (platí `rounds` kol od aktuálního), a vyčistí pendingEvent. Čistá funkce.
 */
export function applyEventChoice(
  state: SeasonState,
  choiceIndex: number
): SeasonState {
  const pe = state.pendingEvent;
  if (!pe) return state;
  const ev = getEvent(pe.id);
  const choice = ev?.choices[choiceIndex];
  if (!choice) return { ...state, pendingEvent: null };

  let morale = state.morale;
  if (choice.effect.moraleDelta) {
    morale = clamp(morale + choice.effect.moraleDelta, 0, 100);
  }
  const modifiers = state.modifiers.slice();
  if (choice.effect.modifier) {
    const m = choice.effect.modifier;
    modifiers.push({
      untilRound: state.round + m.rounds - 1,
      attack: m.attack,
      concede: m.concede,
      label: m.label,
    });
  }
  return { ...state, morale, modifiers, pendingEvent: null };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
