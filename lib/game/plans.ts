// Zápasové plány trenéra (nahrazují původní Tactic). Každý plán má základní efekt na
// λ tvého týmu (balance.ts) + COUNTER proti stylu soupeře: správný protitah = výhoda,
// špatný = postih. Čisté funkce; výsledek čte simulate.ts přes SideAdjust.

import { COUNTER_BONUS, COUNTER_PENALTY, PLAN_BASE } from "./balance";
import type { OppStyle } from "./scouting";
import type { Plan } from "./types";

export const PLAN_LABEL: Record<Plan, string> = {
  balanced: "Vyvážený",
  open: "Otevřená hra",
  low_block: "Nízký blok",
  press: "Presink",
  counter: "Kontry",
};

export const PLAN_HINT: Record<Plan, string> = {
  balanced: "Bez úprav – vyrovnaný přístup.",
  open: "Víc dáš i dostaneš. Sedí na zataženého soupeře.",
  low_block: "Zavři obranu a uber vzadu. Dobré proti silnému útoku.",
  press: "Vysoký presink. Rozebere pasivní tým, ale riziko vzadu proti ofenzivnímu.",
  counter: "Pevná obrana a rychlé protiútoky. Ideál proti otevřenému soupeři.",
};

/** Efekt plánu s ohledem na styl soupeře. Multiplikativní úprava na PLAN_BASE. */
export function resolvePlan(
  plan: Plan,
  oppStyle: OppStyle
): { attack: number; concede: number } {
  const base = PLAN_BASE[plan];
  const eff = counterEffect(plan, oppStyle);
  return {
    attack: base.attack * eff.atk,
    concede: base.concede * eff.conc,
  };
}

/** Násobky (1 = neutrál) za správný/špatný protitah vůči stylu soupeře. */
function counterEffect(
  plan: Plan,
  oppStyle: OppStyle
): { atk: number; conc: number } {
  const up = 1 + COUNTER_BONUS; // útok nahoru = dobré
  const down = 1 - COUNTER_BONUS; // obdržené dolů = dobré
  const risk = 1 + COUNTER_PENALTY; // obdržené nahoru = špatné
  const toothless = 1 - COUNTER_PENALTY; // útok dolů = špatné
  switch (plan) {
    case "counter":
      if (oppStyle === "attacking") return { atk: up, conc: down }; // trestej otevřeného
      if (oppStyle === "defensive") return { atk: toothless, conc: 1 }; // není co chytat
      return { atk: 1, conc: 1 };
    case "low_block":
      if (oppStyle === "attacking") return { atk: 1, conc: down }; // ustojíš tlak
      if (oppStyle === "defensive") return { atk: toothless, conc: 1 }; // zbytečně pasivní
      return { atk: 1, conc: 1 };
    case "press":
      if (oppStyle === "defensive") return { atk: up, conc: 1 }; // rozeber pasivní
      if (oppStyle === "attacking") return { atk: 1, conc: risk }; // riziko vzadu
      return { atk: 1, conc: 1 };
    case "open":
      if (oppStyle === "defensive") return { atk: up, conc: 1 }; // otevři zataženého
      if (oppStyle === "attacking") return { atk: 1, conc: risk }; // divoká přestřelka
      return { atk: 1, conc: 1 };
    default: // balanced – bez counteru
      return { atk: 1, conc: 1 };
  }
}
