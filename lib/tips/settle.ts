import { actualOutcome } from "@/lib/picks/trackRecord";
import type { TipMarket, TipSelection } from "./types";

/**
 * Vyšel tip na daný trh/stranu při skóre `hg:ag` (skóre po 90 min)? Čistá,
 * deterministická funkce – jádro vyhodnocení deníku. Sdílí `actualOutcome`
 * (1X2) s track-recordem modelu → stejná logika výsledku.
 *
 * Pozn.: `line` = 2.5 (MVP) je poloviční → součet gólů (celé číslo) se jí nikdy
 * nerovná, takže „push" (vrácení sázky) v MVP nemůže nastat. Celočíselné čáry
 * (push u total === line) jsou Fáze 2.
 */
export function settleTip(
  market: TipMarket,
  selection: TipSelection,
  line: number | null,
  hg: number,
  ag: number
): boolean {
  if (market === "win") {
    return actualOutcome(hg, ag) === selection; // selection ∈ home|draw|away
  }
  if (market === "over25") {
    const l = line ?? 2.5;
    const total = hg + ag;
    return selection === "over" ? total > l : total < l;
  }
  // btts – oba týmy skórovaly?
  const both = hg > 0 && ag > 0;
  return selection === "yes" ? both : !both;
}
