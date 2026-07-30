import { composeAdjust } from "./adjust";
import { predictProbs, NEUTRAL_ADJUST } from "./simulate";
import { PLANS, PLAN_LABEL } from "./plans";
import { INSTRUCTION_LABEL, recommendInstruction } from "./instructions";
import { teamById } from "./teams";
import type { AgencyState } from "./agency";
import type { OppStyle, Plan, Trait } from "./types";

/**
 * **Který plán je nejlepší — a podle čeho se to vlastně měří.**
 *
 * Původní `recommendPlan(style)` byl argmax `planScore = útok − obdržené`, tedy proxy na
 * gólový rozdíl na škále λ. Mělo to dvě vady, které z taktické vrstvy dělaly kulisu:
 *
 * 1. **Jedna správná odpověď na styl.** Napříč 4 560 koly padlo `counter` 62 %, `press` 28 %,
 *    `balanced` 10 % — `open` a `low_block` ani jednou. Gólový rozdíl je totiž jediné
 *    kritérium, jenže manažer ho nemaximalizuje: venku u lídra bere bod, doma se dnem
 *    potřebuje tři.
 * 2. **Proxy místo skutečnosti.** `útok − obdržené` není monotonní vůči šanci na výhru —
 *    cesta z násobiče λ na 1X2 je přes Poissona nelineární a závisí na síle obou týmů
 *    i na hřišti.
 *
 * Proto se dnes plány porovnávají **na skutečné 1X2 predikci** (`predictProbs` nad
 * `composeAdjust`) a váženě podle toho, co ze zápasu potřebuješ (`MatchStakes` ve
 * `stakes.ts`). Změřeno na všech dvojicích ligy: pod „musíš vyhrát" vyskočí podíl `open`
 * z 11 % na 33–38 %, pod „drž bod" má `low_block` 37 % (dřív 0 %).
 *
 * **Nejistota scoutingu se tím NEOBCHÁZÍ.** Doporučení se staví z `reportedStyle` a
 * `reportedTraits` (co skauti nahlásili), ne z pravdy — stejně jako dřív. Skrytý trait
 * tě pokouše i s dokonalým výpočtem.
 */
export interface OutcomeWeights {
  /** Cena výhry. Držená na 3, ať jsou váhy čitelné jako body. */
  win: number;
  /** Cena remízy. 1 = body, 0.3 = „remíza je skoro k ničemu", 2 = „bod bereme". */
  draw: number;
}

/** Běžný zápas: hodnota výsledku = body v tabulce. */
export const POINTS_WEIGHTS: OutcomeWeights = { win: 3, draw: 1 };
/**
 * „Musíš vyhrát." Remíza není nula — bod pořád není nic, a nulou by se z `low_block`
 * stala nesmyslná volba i v zápase, kde ještě není zle.
 */
export const MUST_WIN_WEIGHTS: OutcomeWeights = { win: 3, draw: 0.3 };
/** „Bod bere." Remíza proti silnějšímu je skoro jako výhra doma se slabým. */
export const HOLD_POINT_WEIGHTS: OutcomeWeights = { win: 3, draw: 2 };
/**
 * Vyřazovací zápas: remíza neznamená bod, ale prodloužení a případně penalty — tedy
 * zhruba půl postupu. (Skupinová fáze turnaje jede na `POINTS_WEIGHTS`.)
 */
export const KNOCKOUT_WEIGHTS: OutcomeWeights = { win: 3, draw: 1.5 };

/** Vážená hodnota zápasu pro tvůj tým z 1X2 predikce. */
export function outcomeValue(
  win: number,
  draw: number,
  weights: OutcomeWeights
): number {
  return weights.win * win + weights.draw * draw;
}

/**
 * Nejlepší plán proti danému (NAHLÁŠENÉMU) stylu a traitům, měřeno vahami zápasu.
 *
 * Instrukce se drží na `"none"`: porovnávají se plány mezi sebou, a instrukce má vlastní
 * doporučení (`recommendInstruction`). Míchat obojí do jednoho argmaxu by znamenalo
 * projít 25 kombinací kvůli efektu, který je o polovinu menší než counter.
 */
export function recommendPlan(
  state: AgencyState,
  oppId: number,
  youHome: boolean,
  style: OppStyle,
  traits: Trait[],
  weights: OutcomeWeights = POINTS_WEIGHTS
): Plan {
  const you = teamById(state.teams, state.yourTeamId);
  const opp = teamById(state.teams, oppId);
  const home = youHome ? you : opp;
  const away = youHome ? opp : you;

  let best: Plan = "balanced";
  let bestValue = -Infinity;
  for (const plan of PLANS) {
    const adj = composeAdjust(state, style, traits, plan, "none");
    const probs = predictProbs(
      home,
      away,
      youHome ? adj : NEUTRAL_ADJUST,
      youHome ? NEUTRAL_ADJUST : adj
    );
    const value = outcomeValue(
      youHome ? probs.homeWin : probs.awayWin,
      probs.draw,
      weights
    );
    if (value > bestValue) {
      bestValue = value;
      best = plan;
    }
  }
  return best;
}

/** Doporučení skautů: plán + instrukce + text do UI. */
export interface PlanSuggestion {
  plan: Plan;
  instruction: ReturnType<typeof recommendInstruction>;
  text: string;
}

/**
 * Doporučení z toho, co skauti NAHLÁSILI. Volá se jen u detailního hlášení – je to
 * odměna za investici do skautingu, ne základní výbava.
 */
export function planSuggestion(
  state: AgencyState,
  oppId: number,
  youHome: boolean,
  reportedStyle: OppStyle,
  reportedTraits: Trait[],
  weights: OutcomeWeights = POINTS_WEIGHTS
): PlanSuggestion {
  const plan = recommendPlan(
    state,
    oppId,
    youHome,
    reportedStyle,
    reportedTraits,
    weights
  );
  const instruction = recommendInstruction(reportedTraits);
  const text =
    instruction === "none"
      ? PLAN_LABEL[plan]
      : `${PLAN_LABEL[plan]} + ${INSTRUCTION_LABEL[instruction]}`;
  return { plan, instruction, text };
}
