// Reprezentační soutěže (Euro 24 / MS 48): registr + kvalifikace + orchestrace jednoho
// „běhu" (`TournamentRun`) od kvalifikace po závěrečný turnaj. Čistě funkční, offline,
// deterministické dle seedu – běží celé na klientu z commitnutého snapshotu reprezentací
// (`nationalTeams.ts`), bez API i DB.
//
// **Vědomé zjednodušení kvalifikace.** Reálné kvalifikační formáty se cyklus od cyklu mění
// a jsou napříč konfederacemi nesouměřitelné. Model je proto jednotný: hráč odehraje JEDNU
// kvalifikační skupinu své konfederace dvoukolově (doma/venku – tady `homeBoost` konečně
// dává smysl), a když skončí do `QUAL_ADVANCE`. místa, postoupí. Zbytek závěrečného pole
// (ostatní konfederace + doplnění té tvé) obsadí LOS VÁŽENÝ RATINGEM, s garancí pořadatele.

import { deriveSeed, mulberry32 } from "./rng";
import { RNG_SALT_QUALIFICATION } from "./agency";
import type { AgencyState } from "./agency";
import {
  HOME_BOOST_CAP,
  MIN_HIREABLE_PRESTIGE,
  QUAL_ADVANCE,
  QUAL_GROUP_SIZE,
  QUAL_HOME_BOOST,
  STARTING_FITNESS,
  STARTING_MORALE,
} from "./balance";
import { simulateMatch } from "./simulate";
import { NEUTRAL_ADJUST } from "./simulate";
import type { SideAdjust } from "./simulate";
import { roundRobin } from "./schedule";
import { buildTable } from "./standings";
import { teamById } from "./teams";
import { teamStrengthScore } from "./leagues";
import { resolveYourAdjust } from "./engine";
import { maybeEvent } from "./events";
import { updateMorale } from "./morale";
import { updateFitness } from "./fitness";
import { HIRE_MARGIN } from "./reputation";
import {
  EURO_FORMAT,
  WORLD_CUP_FORMAT,
  STAGE_LABEL,
  isTournamentOver,
  newTournament,
  playTournamentRound,
  simulateTournamentToEnd,
} from "./tournament";
import type { Stage, TournamentFormat, TournamentState } from "./tournament";
import {
  NATIONAL_TEAMS,
  nationalGameTeam,
  nationalsByConfed,
} from "./nationalTeams";
import type { ConfedCode, NationalSeed } from "./nationalTeams";
import type {
  Fixture,
  GameTeam,
  Instruction,
  MatchResult,
  Modifier,
  Plan,
  TournamentSummary,
} from "./types";

// ───────────────────────── registr soutěží ─────────────────────────

export type CompetitionId = "EURO" | "WC";

/** Popis reprezentační soutěže: formát závěrečného turnaje + kvóty míst per konfederace. */
export interface Competition {
  id: CompetitionId;
  name: string;
  emoji: string;
  format: TournamentFormat;
  /**
   * Konfederace → počet míst v závěrečném turnaji. **Součet = velikost pole**
   * (`format.groups × format.groupSize`). Pořadatel je garantovaně uvnitř své kvóty.
   */
  slotsByConfed: Partial<Record<ConfedCode, number>>;
  /** Výchozí pořadatel (auto-kvalifikace + domácí výhoda v závěrečném turnaji). */
  hostId: number;
}

export const COMPETITIONS: Record<CompetitionId, Competition> = {
  // Euro: 24 týmů, jen UEFA. Pořadatel Německo (25).
  EURO: {
    id: "EURO",
    name: "Mistrovství Evropy",
    emoji: "🏆",
    format: EURO_FORMAT,
    slotsByConfed: { UEFA: 24 },
    hostId: 25,
  },
  // MS 2026: 48 týmů napříč konfederacemi. Pořadatel USA (2384, CONCACAF).
  // Kvóty (16/6/9/9/7/1 = 48) jsou zaokrouhlené na velikost pole – reálné MS má 46 kvót
  // + hostitele; navýšení CONCACAF/AFC absorbuje 3 hostitele a baráže (vědomé zjednodušení).
  WC: {
    id: "WC",
    name: "Mistrovství světa",
    emoji: "🌍",
    format: WORLD_CUP_FORMAT,
    slotsByConfed: { UEFA: 16, CONMEBOL: 6, CAF: 9, AFC: 9, CONCACAF: 7, OFC: 1 },
    hostId: 2384,
  },
};

/** Velikost závěrečného pole soutěže (= součet kvót). */
export function fieldSize(comp: Competition): number {
  return comp.format.groups * comp.format.groupSize;
}

// ───────────────────────── prestiž / hireable ─────────────────────────

/** Percentil síly týmu v daném poli (0 = nejslabší, 1 = nejsilnější). */
function strengthPercentile(id: number, pool: NationalSeed[]): number {
  const mine = seedStrength(byId(id));
  const below = pool.filter((t) => seedStrength(t) < mine).length;
  return pool.length > 1 ? below / (pool.length - 1) : 0.5;
}

function seedStrength(s: NationalSeed): number {
  return s.attack - s.defense;
}

const BY_ID = new Map(NATIONAL_TEAMS.map((s) => [s.id, s]));
function byId(id: number): NationalSeed {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`nationalCompetitions: neznámá reprezentace ${id}`);
  return s;
}

/**
 * Prestiž reprezentace 0–100 dle percentilu síly ve světě. Gatuje výběr národa stejně jako
 * prestiž klubu gatuje job market (nejsilnější ~95, nejslabší ~40).
 */
export function nationPrestige(id: number): number {
  const pct = strengthPercentile(id, NATIONAL_TEAMS);
  // Podlaha pod `MIN_HIREABLE_PRESTIGE` (40), ať nejslabší národy vezme i začátečník
  // (obdoba nejmenších klubů) a kariéra „od nuly" jde postavit i u reprezentace.
  return Math.round(35 + pct * 60);
}

/** Vezme si tě reprezentace? Stejná logika jako `isHireable` u klubů (prestiž vs. reputace). */
export function nationHireable(id: number, reputation: number): boolean {
  const prestige = nationPrestige(id);
  return prestige <= MIN_HIREABLE_PRESTIGE || prestige <= reputation + HIRE_MARGIN;
}

/** Nabídka národů k výběru (pro dané reputace) – seřazená od nejsilnějšího. */
export interface NationOption {
  id: number;
  name: string;
  confed: ConfedCode;
  prestige: number;
  hireable: boolean;
  logo: string;
}

export function nationOptions(reputation: number): NationOption[] {
  return NATIONAL_TEAMS.map((s) => {
    const team = nationalGameTeam(s);
    return {
      id: s.id,
      name: s.name,
      confed: s.confed,
      prestige: nationPrestige(s.id),
      hireable: nationHireable(s.id, reputation),
      logo: team.logo!,
    };
  }).sort((a, b) => b.prestige - a.prestige);
}

// ───────────────────────── kvalifikace ─────────────────────────

/** Kvalifikační stav = jedna skupina hráčovy konfederace, dvoukolově (doma/venku). */
export interface QualificationState extends AgencyState {
  competitionId: CompetitionId;
  hostId: number;
  /** Id týmů ve skupině (včetně tvého). */
  group: number[];
  /** Dvoukolový rozpis (home/away). */
  schedule: Fixture[][];
  results: MatchResult[];
}

/** GameTeam pro kvalifikaci = reprezentace, ale s reálnou domácí výhodou (ne neutrál). */
function qualTeam(id: number): GameTeam {
  return { ...nationalGameTeam(byId(id)), homeBoost: QUAL_HOME_BOOST };
}

/**
 * Vybere `QUAL_GROUP_SIZE−1` soupeřů z hráčovy konfederace stratifikovaně dle síly – ať
 * skupina není celá slabá ani celá silná. Pool se seřadí, rozdělí do pásem a z každého se
 * seedem vybere jeden tým. Deterministické.
 */
function pickGroupOpponents(yourId: number, confed: ConfedCode, seed: number): number[] {
  const pool = nationalsByConfed(confed)
    .filter((s) => s.id !== yourId)
    .sort((a, b) => seedStrength(b) - seedStrength(a));
  const need = QUAL_GROUP_SIZE - 1;
  if (pool.length <= need) return pool.map((s) => s.id);

  const rand = mulberry32(deriveSeed(seed, 31000));
  const bandSize = pool.length / need;
  const out: number[] = [];
  for (let b = 0; b < need; b++) {
    const start = Math.floor(b * bandSize);
    const end = Math.min(pool.length, Math.floor((b + 1) * bandSize));
    const idx = start + Math.floor(rand() * Math.max(1, end - start));
    out.push(pool[Math.min(idx, pool.length - 1)].id);
  }
  return out;
}

export function startQualification(
  competitionId: CompetitionId,
  yourTeamId: number,
  seed: number
): QualificationState {
  const your = byId(yourTeamId);
  const opponents = pickGroupOpponents(yourTeamId, your.confed, seed);
  const group = [yourTeamId, ...opponents];
  const teams = group.map(qualTeam);
  const schedule = roundRobin(group);

  const state: QualificationState = {
    competitionId,
    hostId: COMPETITIONS[competitionId].hostId,
    seed,
    round: 0,
    rngSalt: RNG_SALT_QUALIFICATION,
    teams,
    yourTeamId,
    group,
    schedule,
    results: [],
    morale: STARTING_MORALE,
    fitness: STARTING_FITNESS,
    modifiers: [],
    scoutBoostUntilRound: null,
    plan: "balanced",
    instruction: "none",
    pendingEvent: null,
  };
  return { ...state, pendingEvent: maybeEvent(state, qualNextOpponent(state)) };
}

export function isQualOver(qs: QualificationState): boolean {
  return qs.round >= qs.schedule.length;
}

/** Tvůj zápas v aktuálním kole kvalifikace. */
export function yourQualFixture(qs: QualificationState): Fixture | null {
  const fixtures = qs.schedule[qs.round];
  if (!fixtures) return null;
  return fixtures.find((f) => f.homeId === qs.yourTeamId || f.awayId === qs.yourTeamId) ?? null;
}

export function qualNextOpponent(qs: QualificationState): number | null {
  const f = yourQualFixture(qs);
  if (!f) return null;
  return f.homeId === qs.yourTeamId ? f.awayId : f.homeId;
}

/** Kvalifikační tabulka skupiny. */
export function qualTable(qs: QualificationState) {
  return buildTable(qs.group, qs.results);
}

function qualAdjust(qs: QualificationState, teamId: number, oppId: number): SideAdjust {
  return teamId === qs.yourTeamId ? resolveYourAdjust(qs, oppId) : NEUTRAL_ADJUST;
}

/** Odehraje jedno kolo kvalifikace (tvůj plán/morálka/eventy jen pro tvůj zápas). */
export function playQualRound(qs: QualificationState): QualificationState {
  if (isQualOver(qs)) return qs;
  const rand = mulberry32(deriveSeed(qs.seed + qs.rngSalt, qs.round));
  const results = qs.results.slice();
  const you = teamById(qs.teams, qs.yourTeamId);
  let yourResult: MatchResult | null = null;
  let oppStronger = false;

  for (const f of qs.schedule[qs.round]) {
    const home = teamById(qs.teams, f.homeId);
    const away = teamById(qs.teams, f.awayId);
    const r = simulateMatch(
      home,
      away,
      qualAdjust(qs, f.homeId, f.awayId),
      qualAdjust(qs, f.awayId, f.homeId),
      rand
    );
    const mr: MatchResult = {
      round: qs.round,
      homeId: f.homeId,
      awayId: f.awayId,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
    };
    results.push(mr);
    if (f.homeId === qs.yourTeamId || f.awayId === qs.yourTeamId) {
      yourResult = mr;
      const opp = f.homeId === qs.yourTeamId ? away : home;
      oppStronger = teamStrengthScore(opp) > teamStrengthScore(you);
    }
  }

  const nextRound = qs.round + 1;
  let morale = qs.morale;
  let fitness = qs.fitness;
  if (yourResult) {
    morale = updateMorale(qs.morale, outcomeFor(yourResult, qs.yourTeamId), oppStronger);
    fitness = updateFitness(qs.fitness, qs.plan);
  }
  const next: QualificationState = {
    ...qs,
    results,
    round: nextRound,
    morale,
    fitness,
    modifiers: qs.modifiers.filter((m: Modifier) => m.untilRound >= nextRound),
    pendingEvent: null,
  };
  return {
    ...next,
    pendingEvent: nextRound < qs.schedule.length ? maybeEvent(next, qualNextOpponent(next)) : null,
  };
}

/** Postupující z tvé skupiny (top `QUAL_ADVANCE`). */
export function qualifiersFromGroup(qs: QualificationState): number[] {
  return qualTable(qs)
    .slice(0, QUAL_ADVANCE)
    .map((r) => r.teamId);
}

/** Prošel tvůj tým? (pořadatel automaticky, jinak do `QUAL_ADVANCE`. místa.) */
export function didYouQualify(qs: QualificationState): boolean {
  if (qs.yourTeamId === qs.hostId) return true;
  return qualifiersFromGroup(qs).includes(qs.yourTeamId);
}

// ───────────────────────── los závěrečného pole ─────────────────────────

/**
 * Los `count` týmů z poolu vážený silou (silnější mají větší šanci, ne jistotu).
 * `guaranteed` id se zařadí vždy (pořadatel, postupující z tvé skupiny). Bez opakování.
 */
function weightedDraw(
  pool: NationalSeed[],
  count: number,
  seed: number,
  guaranteed: number[]
): number[] {
  const rand = mulberry32(seed);
  const chosen = new Set<number>();
  const out: number[] = [];
  for (const id of guaranteed) {
    if (pool.some((s) => s.id === id) && !chosen.has(id)) {
      chosen.add(id);
      out.push(id);
    }
  }
  const rest = pool.filter((s) => !chosen.has(s.id));
  const minStrength = Math.min(...rest.map(seedStrength), 0);
  // Váha > 0, silnější tým vyšší; posun nad minimum + basál, ať i dno má nenulovou šanci.
  const weighted = rest.map((s) => ({ id: s.id, w: seedStrength(s) - minStrength + 0.3 }));

  while (out.length < count && weighted.length > 0) {
    let total = 0;
    for (const c of weighted) total += c.w;
    let x = rand() * total;
    let idx = 0;
    for (; idx < weighted.length; idx++) {
      x -= weighted[idx].w;
      if (x <= 0) break;
    }
    const pick = weighted.splice(Math.min(idx, weighted.length - 1), 1)[0];
    out.push(pick.id);
  }
  return out;
}

/**
 * Postaví závěrečné pole z výsledku kvalifikace: pro každou konfederaci vylosuje `slots`
 * týmů vážené silou, s garancí pořadatele a postupujících z tvé skupiny. Vrátí GameTeamy
 * (pořadatel dostane domácí výhodu, ostatní neutrál) a zda ses kvalifikoval.
 */
export function buildTournamentField(
  qs: QualificationState,
  seed: number
): { teams: GameTeam[]; yourQualified: boolean } {
  const comp = COMPETITIONS[qs.competitionId];
  const yourConfed = byId(qs.yourTeamId).confed;
  const groupQualifiers = qualifiersFromGroup(qs);
  const yourQualified = didYouQualify(qs);

  const ids: number[] = [];
  let confedIndex = 0;
  for (const [confed, slots] of Object.entries(comp.slotsByConfed) as [ConfedCode, number][]) {
    const pool = nationalsByConfed(confed);
    const guaranteed: number[] = [];
    if (byId(comp.hostId).confed === confed) guaranteed.push(comp.hostId);
    if (confed === yourConfed) guaranteed.push(...groupQualifiers);
    const drawn = weightedDraw(pool, slots, deriveSeed(seed, 40000 + confedIndex), guaranteed);
    ids.push(...drawn.slice(0, slots));
    confedIndex++;
  }

  const need = fieldSize(comp);
  if (ids.length !== need) {
    throw new Error(`buildTournamentField: ${comp.id} chce ${need} týmů, sestavil ${ids.length}`);
  }

  const teams = ids.map((id) => {
    const t = nationalGameTeam(byId(id));
    return id === comp.hostId ? { ...t, homeBoost: Math.min(QUAL_HOME_BOOST, HOME_BOOST_CAP) } : t;
  });
  return { teams, yourQualified };
}

// ───────────────────────── běh (kvalifikace → turnaj) ─────────────────────────

export type RunPhase = "qualification" | "final" | "done";

/** Jeden reprezentační „běh": kvalifikace, případně závěrečný turnaj, pak vyhodnocení. */
export interface TournamentRun {
  competitionId: CompetitionId;
  seed: number;
  yourTeamId: number;
  yourName: string;
  yourLogo?: string;
  hostId: number;
  /** Pořadové číslo turnaje v této reprezentační „kariéře" (1-based). */
  edition: number;
  phase: RunPhase;
  qualification: QualificationState;
  /** Naplní se po dohrání kvalifikace. */
  qualified: boolean;
  /** Závěrečný turnaj – jen když ses kvalifikoval. */
  tournament: TournamentState | null;
}

export function startRun(
  competitionId: CompetitionId,
  yourTeamId: number,
  seed: number,
  edition: number
): TournamentRun {
  const meta = nationalGameTeam(byId(yourTeamId));
  return {
    competitionId,
    seed,
    yourTeamId,
    yourName: meta.name,
    yourLogo: meta.logo,
    hostId: COMPETITIONS[competitionId].hostId,
    edition,
    phase: "qualification",
    qualification: startQualification(competitionId, yourTeamId, seed),
    qualified: false,
    tournament: null,
  };
}

export function isRunOver(run: TournamentRun): boolean {
  return run.phase === "done";
}

/** Odehraje jedno kolo běhu – větví se dle fáze (kvalifikace / turnaj) a přechází mezi nimi. */
export function playRunRound(run: TournamentRun): TournamentRun {
  const format = COMPETITIONS[run.competitionId].format;

  if (run.phase === "qualification") {
    const qs = playQualRound(run.qualification);
    if (!isQualOver(qs)) return { ...run, qualification: qs };
    // Kvalifikace dohraná → postav pole a rozhodni.
    const { teams, yourQualified } = buildTournamentField(qs, run.seed);
    if (!yourQualified) {
      return { ...run, qualification: qs, qualified: false, phase: "done" };
    }
    const tournament = newTournament(run.seed, run.yourTeamId, teams, format);
    return { ...run, qualification: qs, qualified: true, phase: "final", tournament };
  }

  if (run.phase === "final" && run.tournament) {
    const t = playTournamentRound(run.tournament, format);
    return { ...run, tournament: t, phase: isTournamentOver(t) ? "done" : "final" };
  }
  return run;
}

/** Dohraje celý běh do konce (eventy se přeskočí, jako `simulateToEnd`). */
export function simulateRunToEnd(run: TournamentRun): TournamentRun {
  const format = COMPETITIONS[run.competitionId].format;
  let r = run;
  // Dohraj kvalifikaci kolo po kole (kvůli přechodu na turnaj), pak turnaj naráz.
  let guard = 0;
  while (r.phase === "qualification" && guard++ < 100) r = playRunRound(r);
  if (r.phase === "final" && r.tournament) {
    const t = simulateTournamentToEnd(r.tournament, format);
    r = { ...r, tournament: t, phase: "done" };
  }
  return r;
}

// ───────────────────────── UI dotazy na běh ─────────────────────────

/** Aktivní agency stav (kvalifikace nebo turnaj) pro sdílené UI (plán/instrukce/event). */
export function activeAgency(run: TournamentRun): QualificationState | TournamentState | null {
  if (run.phase === "qualification") return run.qualification;
  if (run.phase === "final") return run.tournament;
  return null;
}

/** Nastaví plán aktivní fáze. */
export function setRunPlan(run: TournamentRun, plan: Plan): TournamentRun {
  if (run.phase === "qualification") {
    return { ...run, qualification: { ...run.qualification, plan } };
  }
  if (run.phase === "final" && run.tournament) {
    return { ...run, tournament: { ...run.tournament, plan } };
  }
  return run;
}

export function setRunInstruction(run: TournamentRun, instruction: Instruction): TournamentRun {
  if (run.phase === "qualification") {
    return { ...run, qualification: { ...run.qualification, instruction } };
  }
  if (run.phase === "final" && run.tournament) {
    return { ...run, tournament: { ...run.tournament, instruction } };
  }
  return run;
}

// ───────────────────────── vyhodnocení běhu ─────────────────────────

function outcomeFor(r: MatchResult, teamId: number): "W" | "D" | "L" {
  const [f, a] = r.homeId === teamId ? [r.homeGoals, r.awayGoals] : [r.awayGoals, r.homeGoals];
  return f > a ? "W" : f < a ? "L" : "D";
}

/** Souhrn tvých zápasů z pole výsledků. */
export function tallyMatches(
  results: MatchResult[],
  teamId: number
): { played: number; win: number; draw: number; loss: number; goalsFor: number; goalsAgainst: number } {
  let played = 0, win = 0, draw = 0, loss = 0, goalsFor = 0, goalsAgainst = 0;
  for (const r of results) {
    const isHome = r.homeId === teamId;
    const isAway = r.awayId === teamId;
    if (!isHome && !isAway) continue;
    played++;
    const gf = isHome ? r.homeGoals : r.awayGoals;
    const ga = isHome ? r.awayGoals : r.homeGoals;
    goalsFor += gf;
    goalsAgainst += ga;
    if (gf > ga) win++;
    else if (gf < ga) loss++;
    else draw++;
  }
  return { played, win, draw, loss, goalsFor, goalsAgainst };
}

/** Nejdál dosažená fáze (do UI). `qualified === false` → zůstal v kvalifikaci. */
export function stageReachedOf(run: TournamentRun): Stage {
  if (run.phase !== "done") return run.tournament?.yourStage ?? "group";
  if (!run.qualified) return "group";
  return run.tournament?.yourStage ?? "group";
}

/**
 * Souhrn dohraného běhu do síně slávy. Zápasové statistiky agregují **kvalifikaci i turnaj**
 * (jinak by nekvalifikovaný trenér měl `played: 0`). `champion` = vyhrál jsi celý turnaj.
 */
export function summarizeRun(run: TournamentRun): TournamentSummary {
  const comp = COMPETITIONS[run.competitionId];
  const qual = tallyMatches(run.qualification.results, run.yourTeamId);
  const finals = run.tournament
    ? tallyMatches(run.tournament.results, run.yourTeamId)
    : { played: 0, win: 0, draw: 0, loss: 0, goalsFor: 0, goalsAgainst: 0 };
  return {
    competitionId: comp.id,
    competitionName: comp.name,
    edition: run.edition,
    teamId: run.yourTeamId,
    teamName: run.yourName,
    teamLogo: run.yourLogo,
    qualified: run.qualified,
    stageReached: stageReachedOf(run),
    champion: run.tournament?.champion === run.yourTeamId,
    played: qual.played + finals.played,
    win: qual.win + finals.win,
    draw: qual.draw + finals.draw,
    loss: qual.loss + finals.loss,
    goalsFor: qual.goalsFor + finals.goalsFor,
    goalsAgainst: qual.goalsAgainst + finals.goalsAgainst,
  };
}

export { STAGE_LABEL };
