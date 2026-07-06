// Orchestrace sezóny – čisté funkce nad SeasonState (žádné IO). Každé kolo má
// vlastní deterministický RNG odvozený ze seedu + čísla kola → výsledky nezávisí
// na průběhu session (odolné vůči reloadu/uložení do DB mezi koly).

import { deriveSeed, mulberry32 } from "./rng";
import { generateLeague, teamById } from "./teams";
import { roundRobin } from "./schedule";
import { simulateMatch, predictProbs } from "./simulate";
import { buildTable } from "./standings";
import { MOCK_LEAGUE } from "./leagues";
import type {
  Fixture,
  GameTeam,
  MatchProbs,
  SeasonState,
  Tactic,
} from "./types";

/**
 * Založí novou sezónu: rozlosuje ligu a nastaví tvůj tým. Bez `teams` vygeneruje
 * fiktivní ligu (mock/offline); s `teams` (reálná liga z API) použije je.
 */
export function newSeason(
  seed: number,
  yourTeamId: number,
  opts: {
    season?: number;
    teams?: GameTeam[];
    leagueId?: number;
    leagueName?: string;
  } = {}
): SeasonState {
  const league = opts.teams ?? generateLeague(seed);
  const schedule = roundRobin(league.map((t) => t.id));
  return {
    season: opts.season ?? 1,
    leagueId: opts.leagueId ?? MOCK_LEAGUE.id,
    leagueName: opts.leagueName ?? MOCK_LEAGUE.name,
    seed,
    teams: league,
    yourTeamId,
    schedule,
    results: [],
    round: 0,
    tactic: "balanced",
  };
}

/** Je sezóna dohraná? */
export function isSeasonOver(state: SeasonState): boolean {
  return state.round >= state.schedule.length;
}

/** Nastaví taktiku pro nejbližší zápas (neměně jinak stav). */
export function setTactic(state: SeasonState, tactic: Tactic): SeasonState {
  return { ...state, tactic };
}

/** Odehraje jedno kolo (tvá taktika platí jen pro tvůj zápas, ostatní „balanced"). */
export function playRound(state: SeasonState): SeasonState {
  if (isSeasonOver(state)) return state;
  const fixtures = state.schedule[state.round];
  const rand = mulberry32(deriveSeed(state.seed, state.round));
  const results = state.results.slice();
  for (const f of fixtures) {
    const home = teamById(state.teams, f.homeId);
    const away = teamById(state.teams, f.awayId);
    const homeTactic: Tactic =
      f.homeId === state.yourTeamId ? state.tactic : "balanced";
    const awayTactic: Tactic =
      f.awayId === state.yourTeamId ? state.tactic : "balanced";
    const r = simulateMatch(home, away, homeTactic, awayTactic, rand);
    results.push({
      round: state.round,
      homeId: f.homeId,
      awayId: f.awayId,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
    });
  }
  return { ...state, results, round: state.round + 1 };
}

/** Dohraje celou sezónu (současná taktika platí pro zbývající zápasy). */
export function simulateToEnd(state: SeasonState): SeasonState {
  let s = state;
  while (!isSeasonOver(s)) s = playRound(s);
  return s;
}

/** Aktuální ligová tabulka. */
export function currentTable(state: SeasonState) {
  return buildTable(
    state.teams.map((t) => t.id),
    state.results
  );
}

/** Tvůj příští zápas + predikce modelu (s tvou vybranou taktikou). Null když je dohráno. */
export function yourNextMatch(state: SeasonState): {
  fixture: Fixture;
  isHome: boolean;
  opponent: GameTeam;
  probs: MatchProbs;
} | null {
  if (isSeasonOver(state)) return null;
  const fixtures = state.schedule[state.round];
  const fixture = fixtures.find(
    (f) => f.homeId === state.yourTeamId || f.awayId === state.yourTeamId
  );
  if (!fixture) return null; // pojistka (v úplné lize hraje každý každé kolo)
  const isHome = fixture.homeId === state.yourTeamId;
  const home = teamById(state.teams, fixture.homeId);
  const away = teamById(state.teams, fixture.awayId);
  const homeTactic: Tactic = isHome ? state.tactic : "balanced";
  const awayTactic: Tactic = isHome ? "balanced" : state.tactic;
  const probs = predictProbs(home, away, homeTactic, awayTactic);
  return { fixture, isHome, opponent: isHome ? away : home, probs };
}

/** Výsledky tvého týmu (nejnovější první). */
export function yourResults(state: SeasonState) {
  return state.results
    .filter((r) => r.homeId === state.yourTeamId || r.awayId === state.yourTeamId)
    .slice()
    .reverse();
}
