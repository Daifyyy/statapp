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
  open: "Nejvíc gólů na obou stranách — volba, když remíza k ničemu není. Otevře zataženého, proti útočnému je to divočina.",
  low_block: "Když ti stačí bod: zavři obranu a šetři síly (jediný plán, který regeneruje). Vepředu skoro nic.",
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

// Pozn.: doporučení plánu (`recommendPlan`) žije v `planChoice.ts`, ne tady. Dřív to byl
// argmax `planScore = útok − obdržené`, tedy proxy na gólový rozdíl na škále λ – jenže ta
// proxy má JEDNU správnou odpověď na styl bez ohledu na situaci (naměřeno: `counter` 62 %,
// `press` 28 %, `balanced` 10 %, `open` a `low_block` NIKDY) a navíc není monotonní vůči
// šanci na výhru. Dnes se plány porovnávají na skutečné 1X2 predikci a váženě podle toho,
// co ze zápasu potřebuješ (`stakes.ts`). Druhá, jednodušší škála by se s ní rozešla.
