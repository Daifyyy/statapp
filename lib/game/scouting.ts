// Scouting soupeře před zápasem – čistá analýza z ratingů + odehrané sezóny (žádná
// nová data). Vrací herní STYL soupeře (pro countery zápasového plánu), sadu traitů
// a krátký CZ popis. Pohání scouting kartu v UI a výběr správného protitahu.
//
// Konfidence NENÍ konstanta. Roste s tím, co o soupeři reálně můžeš vědět (viz balance.ts):
//   vzorek jeho odehraných zápasů + jestli jste se už letos potkali + investice do skautingu.
// Z konfidence plyne KVALITA hlášení (`ScoutQuality`), která řídí, co hráč uvidí:
//   vague    → styl se vůbec neurčí, zmíní se jen do očí bijící traity
//   standard → hlášený (zašuměný) styl + výrazné traity
//   detailed → hlášený styl, všechny traity + doporučený protitah
//
// Dvě věci, které se nesmí smíchat:
//  • `style` je PRAVDA (countruje podle něj `resolvePlan`), `reportedStyle` je to, co vidí
//    hráč. Kdyby se pravda dostala do UI, protitah by byl jistota.
//  • `traits` je PRAVDA (čte ji `resolveInstruction`), `reportedTraits` je její podmnožina.
//    Skauti nikdy nelžou – jen nemusí vidět všechno. Skrytý `punishedBy` trait tě pokousá.

import { teamById } from "./teams";
import { teamStrengthScore } from "./leagues";
// Formu ber z `form.ts`, ne z `analysis.ts` – to importuje `engine.ts` (tabulka) a vznikl
// by cyklus. Ze `teamSeasonStats` se tu stejně používalo jen `.form`.
import { hasMet, playedCount, teamForm } from "./form";
import { deriveSeed, mulberry32 } from "./rng";
import { recommendPlan, PLAN_LABEL } from "./plans";
import { recommendInstruction, INSTRUCTION_LABEL } from "./instructions";
import {
  SCOUT_CONFIDENCE_BOOSTED,
  SCOUT_CONFIDENCE_MAX,
  SCOUT_CONFIDENCE_MIN,
  SCOUT_FAMILIARITY_BONUS,
  SCOUT_LEVEL_STEP,
  SCOUT_QUALITY_DETAILED,
  SCOUT_QUALITY_VAGUE,
  SCOUT_REVEAL_STANDARD,
  SCOUT_REVEAL_VAGUE,
  SCOUT_SAMPLE_FULL,
  SCOUT_SAMPLE_WEIGHT,
  SCOUT_STRENGTH_GAP,
  SCOUT_STYLE_GAP,
  SCOUT_TRAIT_RATIO_HIGH,
  SCOUT_TRAIT_RATIO_LOW,
} from "./balance";
import type { AgencyState } from "./agency";
import type { Instruction, OppStyle, Plan, Trait } from "./types";

// Re-export pro zpětnou kompatibilitu importů (`OppStyle`/`Trait` žijí v types.ts, aby
// je mohly číst `balance.ts` a `plans.ts` bez cyklu na tenhle modul).
export type { OppStyle, Trait };

/** Kvalita skautského hlášení – odvozená z konfidence, řídí, co se hráči ukáže. */
export type ScoutQuality = "vague" | "standard" | "detailed";

/** Doporučený protitah (jen při `detailed`). Odvozený z HLÁŠENÍ, ne z pravdy. */
export interface ScoutSuggestion {
  plan: Plan;
  instruction: Instruction;
  text: string;
}

export interface ScoutReport {
  /**
   * SKUTEČNÝ styl soupeře. Nikdy neukazovat v UI – jen `resolvePlan` podle něj počítá,
   * jestli counter zabral. Hráč vidí `reportedStyle`.
   */
  style: OppStyle;
  /**
   * Styl, jak ho hlásí skauti. S pravděpodobností `1 − confidence` je vedle;
   * `null` = kvalita `vague`, styl se nepodařilo určit.
   */
  reportedStyle: OppStyle | null;
  /** Spolehlivost hlášení (0–1). */
  confidence: number;
  quality: ScoutQuality;
  /** SKUTEČNÉ traity – vstup `resolveInstruction`. Nikdy je nevykresluj celé. */
  traits: Trait[];
  /** Podmnožina `traits`, kterou skauti opravdu odhalili. Tohle patří do UI. */
  reportedTraits: Trait[];
  /** Kolik zápasů soupeř odehrál (zdroj konfidence – UI to vysvětluje hráči). */
  sample: number;
  suggestion?: ScoutSuggestion;
  note: string;
}

const TRAIT_LABEL: Record<Trait, string> = {
  strongAttack: "silný útok",
  weakDefense: "děravá obrana",
  solidDefense: "pevná obrana",
  inForm: "ve formě",
  poorForm: "mimo formu",
  favourite: "papírový favorit",
  underdog: "outsider",
};

const STYLE_NOTE: Record<OppStyle, string> = {
  attacking: "Hraje ofenzivně a otevřeně — zranitelný do protiútoku.",
  defensive: "Spoléhá na pevný blok — těžko se prolamuje.",
  balanced: "Vyrovnaný tým bez výrazného extrému.",
};

const UNKNOWN_STYLE_NOTE = "Styl se nepodařilo určit — skauti ho zatím nepřečetli.";

export const STYLE_LABEL: Record<OppStyle, string> = {
  attacking: "útočný",
  defensive: "defenzivní",
  balanced: "vyrovnaný",
};

const ALL_STYLES: OppStyle[] = ["attacking", "defensive", "balanced"];

// Rozpětí, na kterém se „jak výrazný ten rys je" normalizuje na 0–1. Jsou to jednotky
// jednotlivých veličin (poměr k ligovému průměru / počet výsledků / rozdíl skóre síly),
// proto nesedí do balance.ts mezi laditelné páky – jsou to měřítka, ne balanc.
const TRAIT_RATIO_SPAN = 0.25;
const TRAIT_FORM_SPAN = 3;
const TRAIT_STRENGTH_SPAN = 0.5;

/** Trait s tím, jak výrazný je (0 = těsně za prahem, 1 = do očí bijící). */
interface ScoredTrait {
  trait: Trait;
  strength: number;
}

/**
 * Konfidence hlášení. Skládá se z toho, co o soupeři jde vědět: kolik toho odehrál,
 * jestli jste se už potkali, a kolik jsi nasypal do skautského oddělení. Zaplacená
 * analýza z eventu (`scoutBoostUntilRound`) ji na pár kol vytáhne rovnou na strop.
 */
export function scoutConfidence(state: AgencyState, oppId: number): number {
  const boosted =
    state.scoutBoostUntilRound !== null && state.scoutBoostUntilRound >= state.round;
  if (boosted) return SCOUT_CONFIDENCE_BOOSTED;

  const sample = Math.min(playedCount(state.results, oppId) / SCOUT_SAMPLE_FULL, 1);
  const familiarity = hasMet(state.results, state.yourTeamId, oppId)
    ? SCOUT_FAMILIARITY_BONUS
    : 0;
  // Kariérní pole – v turnaji chybí (jako `youth`), pak je příspěvek nulový.
  const level = (state.scouting ?? 0) * SCOUT_LEVEL_STEP;

  return clamp(
    SCOUT_CONFIDENCE_MIN + sample * SCOUT_SAMPLE_WEIGHT + familiarity + level,
    SCOUT_CONFIDENCE_MIN,
    SCOUT_CONFIDENCE_MAX
  );
}

/** Kvalita hlášení z konfidence. */
export function scoutQuality(confidence: number): ScoutQuality {
  if (confidence < SCOUT_QUALITY_VAGUE) return "vague";
  if (confidence < SCOUT_QUALITY_DETAILED) return "standard";
  return "detailed";
}

/** Kolik síly musí trait mít, aby ho skauti při dané kvalitě zmínili. */
function revealThreshold(quality: ScoutQuality): number {
  if (quality === "vague") return SCOUT_REVEAL_VAGUE;
  if (quality === "standard") return SCOUT_REVEAL_STANDARD;
  return 0; // detailed: všechno
}

/**
 * Co skauti nahlásí. S pravděpodobností `confidence` sedí na pravdu, jinak ukážou jeden
 * z ostatních stylů. Deterministické dle `(seed, salt, kolo, soupeř)` – vlastní RNG stream
 * (salt 70000), aby hlášení nekolísalo mezi rendery ani po reloadu a neposunulo RNG
 * simulace zápasů (`deriveSeed(seed, round)`) ani eventů (salt 90000).
 *
 * Seed se skládá VNOŘENĚ (`deriveSeed(deriveSeed(…, kolo), soupeř)`). Dřívější
 * `70000 + round * 101 + oppId` kolidovalo: reálná id týmů jdou do tisíců, takže
 * (kolo 0, soupeř 202) dávalo stejný stream jako (kolo 2, soupeř 0) – hlášení pak
 * korelovala napříč koly.
 */
function reportStyle(
  state: AgencyState,
  oppId: number,
  trueStyle: OppStyle,
  confidence: number
): OppStyle {
  const rand = mulberry32(
    deriveSeed(deriveSeed(state.seed + state.rngSalt, 70000 + state.round), oppId)
  );
  if (rand() < confidence) return trueStyle;
  const others = ALL_STYLES.filter((s) => s !== trueStyle);
  return others[Math.floor(rand() * others.length)];
}

/** Traity soupeře i s tím, jak výrazné jsou (0–1). Pravda – nikdy zašuměná. */
function scoredTraits(
  attackRatio: number,
  defenseRatio: number,
  wins: number,
  losses: number,
  formSample: number,
  strengthDiff: number
): ScoredTrait[] {
  const out: ScoredTrait[] = [];
  const push = (trait: Trait, over: number, span: number) => {
    if (over > 0) out.push({ trait, strength: clamp(over / span, 0, 1) });
  };

  push("strongAttack", attackRatio - SCOUT_TRAIT_RATIO_HIGH, TRAIT_RATIO_SPAN);
  push("weakDefense", defenseRatio - SCOUT_TRAIT_RATIO_HIGH, TRAIT_RATIO_SPAN);
  push("solidDefense", SCOUT_TRAIT_RATIO_LOW - defenseRatio, TRAIT_RATIO_SPAN);
  if (formSample >= 3) {
    // 3 výhry z 5 = slabý signál, 5 z 5 = jasný. Práh zůstává na 3 jako dřív.
    if (wins >= 3) push("inForm", wins - 2, TRAIT_FORM_SPAN);
    if (losses >= 3) push("poorForm", losses - 2, TRAIT_FORM_SPAN);
  }
  push("favourite", strengthDiff - SCOUT_STRENGTH_GAP, TRAIT_STRENGTH_SPAN);
  push("underdog", -strengthDiff - SCOUT_STRENGTH_GAP, TRAIT_STRENGTH_SPAN);
  return out;
}

/**
 * Scout report soupeře z pohledu tvého týmu. `style`/`traits` je pravda (pro `resolvePlan`
 * a `resolveInstruction`), `reportedStyle`/`reportedTraits` je to, co uvidí hráč.
 */
export function scoutOpponent(state: AgencyState, oppId: number): ScoutReport {
  const opp = teamById(state.teams, oppId);
  const you = teamById(state.teams, state.yourTeamId);
  const meanAtk =
    state.teams.reduce((s, t) => s + t.attack, 0) / state.teams.length;
  const meanDef =
    state.teams.reduce((s, t) => s + t.defense, 0) / state.teams.length;

  // Styl: útok vs obrana relativně k lize (nižší defense = lepší obrana).
  const atkIndex = opp.attack - meanAtk;
  const defIndex = meanDef - opp.defense;
  const style: OppStyle =
    atkIndex > defIndex + SCOUT_STYLE_GAP
      ? "attacking"
      : defIndex > atkIndex + SCOUT_STYLE_GAP
        ? "defensive"
        : "balanced";

  const form = teamForm(state.results, oppId, 5);
  const scored = scoredTraits(
    opp.attack / meanAtk,
    opp.defense / meanDef,
    form.filter((f) => f === "W").length,
    form.filter((f) => f === "L").length,
    form.length,
    teamStrengthScore(opp) - teamStrengthScore(you)
  );
  const traits = scored.map((s) => s.trait);

  const confidence = scoutConfidence(state, oppId);
  const quality = scoutQuality(confidence);
  const minStrength = revealThreshold(quality);
  const reportedTraits = scored
    .filter((s) => s.strength >= minStrength)
    .map((s) => s.trait);

  // `vague` = styl se vůbec neurčí. Jinak zašuměné hlášení.
  const reportedStyle =
    quality === "vague" ? null : reportStyle(state, oppId, style, confidence);

  const traitText = reportedTraits.length
    ? reportedTraits.map((t) => TRAIT_LABEL[t]).join(", ")
    : "bez výrazných rysů";

  // Doporučení jen v detailním hlášení – a jen z toho, co skauti nahlásili.
  const suggestion =
    quality === "detailed" && reportedStyle
      ? buildSuggestion(reportedStyle, reportedTraits)
      : undefined;

  return {
    style,
    reportedStyle,
    confidence,
    quality,
    traits,
    reportedTraits,
    sample: playedCount(state.results, oppId),
    suggestion,
    // Popis se řídí HLÁŠENÝM stylem – hráč nesmí z textu vyčíst pravdu.
    note: `${reportedStyle ? STYLE_NOTE[reportedStyle] : UNKNOWN_STYLE_NOTE} (${traitText})`,
  };
}

function buildSuggestion(
  reportedStyle: OppStyle,
  reportedTraits: Trait[]
): ScoutSuggestion {
  const plan = recommendPlan(reportedStyle);
  const instruction = recommendInstruction(reportedTraits);
  const text =
    instruction === "none"
      ? PLAN_LABEL[plan]
      : `${PLAN_LABEL[plan]} + ${INSTRUCTION_LABEL[instruction]}`;
  return { plan, instruction, text };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
