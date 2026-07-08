// Vedlejší instrukce k zápasovému plánu. Zatímco plán countruje STYL soupeře
// (attacking/defensive/balanced), instrukce míří na konkrétní **traity** ze scout
// reportu – ty se do téhle chvíle počítaly a vykreslovaly, ale mechanicky nic nedělaly.
//
// Efekt je záměrně menší než counter plánu (±5 % vs ±10 %): instrukce má rozhodování
// prohloubit, ne přebít plán. A protože scout hlásí styl jen s určitou konfidencí
// (`SCOUT_CONFIDENCE`), není ani jedna volba jistota.

import { INSTRUCTION_BONUS, INSTRUCTION_PENALTY } from "./balance";
import type { Trait } from "./scouting";
import type { Instruction } from "./types";

export const INSTRUCTION_LABEL: Record<Instruction, string> = {
  none: "Bez instrukce",
  man_mark: "Osobní obrana na hvězdu",
  wing_play: "Hra po křídlech",
  set_pieces: "Důraz na standardky",
  high_line: "Vysoká obranná linie",
};

export const INSTRUCTION_HINT: Record<Instruction, string> = {
  none: "Žádný bonus ani postih.",
  man_mark: "Udusí soupeřovu hvězdu. Proti outsiderovi jen zbytečně vážeš vlastního hráče.",
  wing_play: "Trestá děravou obranu. Proti pevnému bloku se křídla vyčerpají.",
  set_pieces: "Způsob, jak otevřít pevnou obranu. Proti otevřenému týmu ztráta času.",
  high_line: "Dusí tým mimo formu. Proti týmu ve formě riskuješ běh za obranu.",
};

/** Který trait instrukce trestá (bonus), a který ji naopak trestá (postih). */
const MATCHUP: Record<
  Exclude<Instruction, "none">,
  { rewards: Trait; punishedBy: Trait; effect: "attack" | "concede" }
> = {
  // Osobní obrana na hvězdu: proti silnému útoku ubere obdržené; proti outsiderovi jen
  // sváže vlastního hráče. `punishedBy` NESMÍ korelovat s `rewards` – s původním
  // `solidDefense` se oba traity u špičkových týmů potkávaly a vyrušily se, takže
  // instrukce byla relevantní jen v 8 % zápasů (měřeno na 760 zápasech).
  man_mark: { rewards: "strongAttack", punishedBy: "underdog", effect: "concede" },
  // Křídla: rozebere děravou obranu; proti pevnému bloku se centry ztratí.
  wing_play: { rewards: "weakDefense", punishedBy: "solidDefense", effect: "attack" },
  // Standardky: cesta jak otevřít zataženého soupeře; proti děravé obraně zbytečné.
  set_pieces: { rewards: "solidDefense", punishedBy: "weakDefense", effect: "attack" },
  // Vysoká linie: dusí tým mimo formu; tým ve formě ji přeběhne.
  high_line: { rewards: "poorForm", punishedBy: "inForm", effect: "concede" },
};

/**
 * Multiplikátory λ z vedlejší instrukce proti konkrétním traitům soupeře.
 * `attack` > 1 a `concede` < 1 jsou pro tebe dobré.
 */
export function resolveInstruction(
  instruction: Instruction,
  traits: Trait[]
): { attack: number; concede: number } {
  if (instruction === "none") return { attack: 1, concede: 1 };
  const m = MATCHUP[instruction];
  const hit = traits.includes(m.rewards);
  const miss = traits.includes(m.punishedBy);
  // Trefa i postih zároveň (soupeř má oba traity) se vyruší.
  if (hit === miss) return { attack: 1, concede: 1 };

  if (m.effect === "attack") {
    return hit
      ? { attack: 1 + INSTRUCTION_BONUS, concede: 1 }
      : { attack: 1 - INSTRUCTION_PENALTY, concede: 1 };
  }
  return hit
    ? { attack: 1, concede: 1 - INSTRUCTION_BONUS }
    : { attack: 1, concede: 1 + INSTRUCTION_PENALTY };
}

/** Všechny instrukce k vykreslení v UI. */
export const INSTRUCTIONS: Instruction[] = [
  "none",
  "man_mark",
  "wing_play",
  "set_pieces",
  "high_line",
];
