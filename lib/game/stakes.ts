import { SCOUT_STRENGTH_GAP } from "./balance";
import { buildTable } from "./standings";
import { teamById } from "./teams";
import { teamStrengthScore } from "./leagues";
import type { OutcomeWeights } from "./planChoice";
import { HOLD_POINT_WEIGHTS, MUST_WIN_WEIGHTS, POINTS_WEIGHTS } from "./planChoice";
import type { SeasonState } from "./types";

/**
 * **Co z tohohle zápasu vlastně potřebuješ.**
 *
 * Dokud se plán vybíral jako argmax `útok − obdržené`, měl každý styl soupeře **jednu**
 * správnou odpověď bez ohledu na situaci: napříč 4 560 koly padlo `counter` 62 %, `press`
 * 28 %, `balanced` 10 % — a `open` s `low_block` **ani jednou**. Jenže manažerské
 * rozhodnutí nezní „maximalizuj gólový rozdíl", ale „venku u lídra beru bod" vs. „doma
 * se dnem musím vyhrát". Tohle je ta chybějící vstupní informace: převádí zápas na
 * **váhy výhry a remízy**, a teprve podle nich se plány porovnávají (`planChoice.ts`).
 *
 * Žije v ligové vrstvě, ne v agency: potřebuje tabulku, rozpis a sezónní cíl, tedy přesně
 * to, co `AgencyState` vědomě nezná. Turnaj a pohár si váhy dodají po svém.
 *
 * Váhy nejsou jen kosmetika – měřeno na všech dvojicích ligy: pod „musíš vyhrát" vyskočí
 * podíl `open` z 11 % na 33–38 %, pod „drž bod" má `low_block` 37 % (proti 0 % dřív).
 */
export type StakesKind = "must_win" | "hold_a_point" | "normal";

export interface MatchStakes {
  kind: StakesKind;
  /** Váhy pro `recommendPlan` – čím se v tomhle zápase měří úspěch. */
  weights: OutcomeWeights;
  /** Jedna věta pro hráče (UI). Vysvětluje, PROČ jsou sázky takové. */
  text: string;
}

/**
 * Od jaké části sezóny se „došel čas" bere vážně. Dřív než ve třetině od konce je manko
 * dohnatelné skoro vždycky a hláška „remízy tě nedotáhnou" by byla planý poplach.
 */
export const LATE_SEASON_FRACTION = 1 / 3;

/**
 * Sázky nadcházejícího zápasu. Čistá funkce nad stavem – nic neukládá, nikde se necachuje
 * (odvozená kopie by se rozešla s tabulkou, stejně jako `nextOpponentOf`).
 */
export function matchStakes(state: SeasonState, oppId: number): MatchStakes {
  const table = buildTable(
    state.teams.map((t) => t.id),
    state.results
  );
  const you = table.find((r) => r.teamId === state.yourTeamId);
  const roundsLeft = state.schedule.length - state.round;
  const lateSeason = roundsLeft <= state.schedule.length * LATE_SEASON_FRACTION;

  const target = state.objective.targetRank;
  const targetRow = table[target - 1];
  // Kolik bodů ti chybí na příčku, kterou po tobě vedení chce. `+1` = musíš je přeskočit,
  // ne dorovnat (o rovnosti bodů rozhoduje skóre, na které se nedá spolehnout).
  const pointsToTarget =
    you && targetRow ? Math.max(0, targetRow.points + 1 - you.points) : 0;
  const below = you ? you.rank > target : false;

  // „Musíš vyhrát" = i kdybys všechno zbývající remizoval, na cíl to nestačí. Remízy dají
  // přesně `roundsLeft` bodů, takže práh je právě tam. Dřív než v poslední třetině se to
  // neaktivuje – manko z podzimu není krize.
  if (below && lateSeason && pointsToTarget > roundsLeft) {
    return {
      kind: "must_win",
      weights: MUST_WIN_WEIGHTS,
      text: `Remízy už tě nedotáhnou — na ${target}. místo chybí ${pointsToTarget} b a zbývá ${roundsLeft} kol.`,
    };
  }

  const opp = teamById(state.teams, oppId);
  const yourTeam = teamById(state.teams, state.yourTeamId);
  const stronger =
    teamStrengthScore(opp) - teamStrengthScore(yourTeam) > SCOUT_STRENGTH_GAP;
  if (stronger) {
    return {
      kind: "hold_a_point",
      weights: HOLD_POINT_WEIGHTS,
      text: "Papírově silnější soupeř — bod bere.",
    };
  }

  return {
    kind: "normal",
    weights: POINTS_WEIGHTS,
    text: "Běžný zápas — hraje se o tři body.",
  };
}
