// Scouting soupeře před zápasem – čistá analýza z ratingů + odehrané sezóny (žádná
// nová data). Vrací herní STYL soupeře (pro countery zápasového plánu), sadu traitů
// a krátký CZ popis. Pohání scouting kartu v UI a výběr správného protitahu.

import { teamById } from "./teams";
import { teamStrengthScore } from "./leagues";
import { teamSeasonStats } from "./analysis";
import {
  SCOUT_STRENGTH_GAP,
  SCOUT_STYLE_GAP,
  SCOUT_TRAIT_RATIO_HIGH,
  SCOUT_TRAIT_RATIO_LOW,
} from "./balance";
import type { SeasonState } from "./types";

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
  style: OppStyle;
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

/** Scout report soupeře z pohledu tvého týmu. */
export function scoutOpponent(state: SeasonState, oppId: number): ScoutReport {
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

  const stats = teamSeasonStats(state, oppId);
  const wins = stats.form.filter((f) => f === "W").length;
  const losses = stats.form.filter((f) => f === "L").length;
  if (stats.form.length >= 3 && wins >= 3) traits.push("inForm");
  if (stats.form.length >= 3 && losses >= 3) traits.push("poorForm");

  const diff = teamStrengthScore(opp) - teamStrengthScore(you);
  if (diff > SCOUT_STRENGTH_GAP) traits.push("favourite");
  else if (diff < -SCOUT_STRENGTH_GAP) traits.push("underdog");

  const traitText = traits.length
    ? traits.map((t) => TRAIT_LABEL[t]).join(", ")
    : "bez výrazných rysů";
  return { style, traits, note: `${STYLE_NOTE[style]} (${traitText})` };
}
