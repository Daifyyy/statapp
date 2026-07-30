import { ADJUST_MAX, ADJUST_MIN } from "./balance";
import { resolvePlan } from "./plans";
import { resolveInstruction } from "./instructions";
import { moraleFactor } from "./morale";
import { fitnessFactor } from "./fitness";
import type { AgencyState } from "./agency";
import type { SideAdjust } from "./simulate";
import type { Instruction, OppStyle, Plan, Trait } from "./types";

/**
 * **Jediné místo, kde se skládají násobiče λ tvého týmu.**
 *
 * Vytknuto z `engine.resolveAdjust`, protože stack potřebují dva volající s různým vstupem:
 * - `resolveAdjust` ho volá se **skutečným** stylem a traity soupeře (counter buď sedne,
 *   nebo ne, podle pravdy),
 * - `planChoice.ts` s **nahlášeným** stylem a traity (doporučení musí být stejně omylné
 *   jako hlášení – jinak by se jím dala nejistota scoutingu obejít).
 *
 * Druhá kopie tohohle výpočtu by se dřív nebo později rozešla a `ADJUST_MIN/MAX` by
 * přestal platit pro jednu z větví.
 */
export function composeAdjust(
  state: AgencyState,
  style: OppStyle,
  traits: Trait[],
  plan: Plan,
  instruction: Instruction
): SideAdjust {
  const base = resolvePlan(plan, style);
  const instr = resolveInstruction(instruction, traits);
  const mf = moraleFactor(state.morale);
  const ff = fitnessFactor(state.fitness);
  let attack = base.attack * instr.attack * mf * ff;
  let concede = (base.concede * instr.concede) / mf / ff; // vyšší morálka/kondice = míň obdržených
  for (const m of state.modifiers) {
    if (m.untilRound >= state.round) {
      if (m.attack) attack *= m.attack;
      if (m.concede) concede *= m.concede;
    }
  }
  // Strop na kombinované stohování (plán×counter×instrukce×morálka×kondice×eventy) – žádná
  // kombinace by neměla poslat attack/concede mimo tento rozsah, ani při "perfektní bouři".
  return { attack: clampAdjust(attack), concede: clampAdjust(concede) };
}

function clampAdjust(v: number): number {
  return Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, v));
}
