// Scouting soupeře před zápasem – čistá analýza z ratingů + odehrané sezóny (žádná
// nová data). Vrací herní STYL soupeře (pro countery zápasového plánu), sadu traitů
// a krátký CZ popis. Pohání scouting kartu v UI a výběr správného protitahu.

import { teamById } from "./teams";
import { teamStrengthScore } from "./leagues";
// Formu ber z `form.ts`, ne z `analysis.ts` – to importuje `engine.ts` (tabulka) a vznikl
// by cyklus. Ze `teamSeasonStats` se tu stejně používalo jen `.form`.
import { teamForm } from "./form";
import { deriveSeed, mulberry32 } from "./rng";
import {
  SCOUT_CONFIDENCE,
  SCOUT_CONFIDENCE_BOOSTED,
  SCOUT_STRENGTH_GAP,
  SCOUT_STYLE_GAP,
  SCOUT_TRAIT_RATIO_HIGH,
  SCOUT_TRAIT_RATIO_LOW,
} from "./balance";
import type { AgencyState } from "./agency";

/** Herní styl soupeře – vstup pro counter logiku plánu. */
export type OppStyle = "attacking" | "defensive" | "balanced";

export type Trait =
  | "strongAttack"
  | "weakDefense"
  | "solidDefense"
  | "inForm"
  | "poorForm"
  | "favourite"
  | "underdog";

export interface ScoutReport {
  /**
   * SKUTEČNÝ styl soupeře. Nikdy neukazovat v UI – jen `resolvePlan` podle něj počítá,
   * jestli counter zabral. Hráč vidí `reportedStyle`.
   */
  style: OppStyle;
  /** Styl, jak ho hlásí skauti. S pravděpodobností `1 − confidence` je vedle. */
  reportedStyle: OppStyle;
  /** Spolehlivost hlášení (0–1). */
  confidence: number;
  traits: Trait[];
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

export const STYLE_LABEL: Record<OppStyle, string> = {
  attacking: "útočný",
  defensive: "defenzivní",
  balanced: "vyrovnaný",
};

const ALL_STYLES: OppStyle[] = ["attacking", "defensive", "balanced"];

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

/**
 * Scout report soupeře z pohledu tvého týmu. `style` je pravda (pro counter v
 * `resolvePlan`), `reportedStyle` je to, co uvidí hráč – proto counter není jistota.
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

  const traits: Trait[] = [];
  if (opp.attack > meanAtk * SCOUT_TRAIT_RATIO_HIGH) traits.push("strongAttack");
  if (opp.defense > meanDef * SCOUT_TRAIT_RATIO_HIGH) traits.push("weakDefense");
  if (opp.defense < meanDef * SCOUT_TRAIT_RATIO_LOW) traits.push("solidDefense");

  const form = teamForm(state.results, oppId, 5);
  const wins = form.filter((f) => f === "W").length;
  const losses = form.filter((f) => f === "L").length;
  if (form.length >= 3 && wins >= 3) traits.push("inForm");
  if (form.length >= 3 && losses >= 3) traits.push("poorForm");

  const diff = teamStrengthScore(opp) - teamStrengthScore(you);
  if (diff > SCOUT_STRENGTH_GAP) traits.push("favourite");
  else if (diff < -SCOUT_STRENGTH_GAP) traits.push("underdog");

  const traitText = traits.length
    ? traits.map((t) => TRAIT_LABEL[t]).join(", ")
    : "bez výrazných rysů";

  // Investice do skautingu (event) zvedne spolehlivost hlášení na pár kol.
  const boosted =
    state.scoutBoostUntilRound !== null && state.scoutBoostUntilRound >= state.round;
  const confidence = boosted ? SCOUT_CONFIDENCE_BOOSTED : SCOUT_CONFIDENCE;
  const reportedStyle = reportStyle(state, oppId, style, confidence);

  return {
    style,
    reportedStyle,
    confidence,
    traits,
    // Popis se řídí HLÁŠENÝM stylem – hráč nesmí z textu vyčíst pravdu.
    note: `${STYLE_NOTE[reportedStyle]} (${traitText})`,
  };
}
