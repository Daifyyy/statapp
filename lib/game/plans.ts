// Zápasové plány trenéra (nahrazují původní Tactic). Každý plán má základní efekt na
// λ tvého týmu (`PLAN_BASE`) + COUNTER proti stylu soupeře (`COUNTER_MATRIX`): správný
// protitah = výhoda, špatný = postih. Čisté funkce; výsledek čte simulate.ts přes SideAdjust.
//
// Návrhový invariant: **žádný plán nesmí být lepší než `balanced` proti všem stylům.**
// Každý za svou výhodu někde platí – jinak by „Vyvážený" byl mrtvá volba (to byl přesně
// případ `counter`, dokud měl základ 1.02/0.90). Kryje to test „dominance".

import { COUNTER_MATRIX, PLAN_BASE } from "./balance";
import type { OppStyle, Plan } from "./types";

export const PLAN_LABEL: Record<Plan, string> = {
  balanced: "Vyvážený",
  open: "Otevřená hra",
  low_block: "Nízký blok",
  press: "Presink",
  counter: "Kontry",
};

export const PLAN_HINT: Record<Plan, string> = {
  balanced: "Bez úprav a bez rizika. Když o soupeři nic nevíš, nic neztratíš.",
  open: "Nejvíc gólů na obou stranách. Otevře zataženého, proti útočnému je to divočina.",
  low_block: "Zavři obranu a šetři síly (jediný plán, který regeneruje). Vepředu skoro nic.",
  press: "Vysoký presink rozebere pasivní tým. Proti ofenzivnímu necháš díry za obranou.",
  counter: "Vzadu pevný, vepředu opatrný. Proti otevřenému soupeři nejsilnější protitah.",
};

/** Všechny plány k vykreslení v UI. */
export const PLANS: Plan[] = ["balanced", "open", "low_block", "press", "counter"];

/** Efekt plánu s ohledem na styl soupeře. Multiplikativní úprava na `PLAN_BASE`. */
export function resolvePlan(
  plan: Plan,
  oppStyle: OppStyle
): { attack: number; concede: number } {
  const base = PLAN_BASE[plan];
  const eff = COUNTER_MATRIX[plan][oppStyle];
  return {
    attack: base.attack * eff.atk,
    concede: base.concede * eff.conc,
  };
}

/**
 * Jak dobře plán sedí na daný styl – proxy na gólový rozdíl (útok − obdržené na škále λ).
 * Slouží jen k **doporučení pro hráče** (`recommendPlan`), ne k simulaci.
 * Vědomě ignoruje kondici: doporučení je zápasové, únava je rozpočet přes sezónu.
 */
export function planScore(plan: Plan, oppStyle: OppStyle): number {
  const r = resolvePlan(plan, oppStyle);
  return r.attack - r.concede;
}

/**
 * Který plán skauti doporučí proti nahlášenému stylu. Bere **hlášený** styl, ne pravdu –
 * doporučení je proto stejně omylné jako hlášení a nejde jím obejít nejistotu scoutingu.
 */
export function recommendPlan(oppStyle: OppStyle): Plan {
  let best: Plan = "balanced";
  let bestScore = -Infinity;
  for (const p of PLANS) {
    const s = planScore(p, oppStyle);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}
