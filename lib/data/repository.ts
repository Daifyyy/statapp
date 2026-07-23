import type {
  ClubTransferBalance,
  FixtureDay,
  Injury,
  League,
  LeagueGoalsAvg,
  LeagueRound,
  LeagueScorer,
  LeagueTable,
  LeagueTableRow,
  LiveScore,
  MatchPick,
  PredictionRow,
  Scorer,
  SettledMatch,
  Standing,
  Team,
  Transfer,
} from "@/lib/types";
import type { LeagueBaseline } from "@/lib/stats/predict";
import type { TeamStrength } from "@/lib/stats/ratings";
import { isRealDataConfigured } from "@/lib/db";
import { generateLeague } from "@/lib/game/teams";
import type { GameTeam, LeagueAccess } from "@/lib/game/types";
import { LEAGUES, buildTeams } from "./mock/seed";
import { mockUpcomingPredictions, mockSettledPredictions } from "./mock/predictions";
import { mockFixturesByDates } from "./mock/fixtures";
import { mockLeagueTransfers, mockClubBalances } from "./mock/transfers";
import {
  getUpcomingPredictionRows,
  getSettledPredictions,
  getRecentSettledPredictions,
} from "./predictionStore";
import { summarizeSettled } from "@/lib/picks/results";
import { getLeagueTransfers, getClubBalances } from "./transferStore";
import * as real from "./realRepository";

/**
 * Datová vrstva aplikace. Při nakonfigurovaném API klíči + DB čte reálná data
 * z API-Football přes read-through cache (Postgres); jinak běží na mock datech.
 * Výpočetní jádro (lib/stats) je na zdroji nezávislé.
 */

type TeamLite = Pick<Team, "id" | "name" | "logoUrl" | "country" | "entityType">;

const useReal = isRealDataConfigured();

export function getLeagues(): League[] {
  return useReal ? real.getLeagues() : LEAGUES;
}

// ---- Mock fallback ----

let mockTeams: Team[] | null = null;
function allMockTeams(): Team[] {
  if (!mockTeams) mockTeams = buildTeams();
  return mockTeams;
}

export async function getTeamsByLeague(
  leagueId: number
): Promise<TeamLite[]> {
  if (useReal) return real.getTeamsByLeague(leagueId);
  return allMockTeams()
    .filter((t) => t.leagueId === leagueId)
    .map(({ id, name, logoUrl, country, entityType }) => ({
      id,
      name,
      logoUrl,
      country,
      entityType,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export async function getCompareTeam(
  teamId: number,
  leagueId: number,
  includeEuro = false
): Promise<Team | null> {
  if (useReal) return real.getCompareTeam(teamId, leagueId, includeEuro);
  return allMockTeams().find((t) => t.id === teamId) ?? null;
}

/** Nadcházející zápasy našich lig na zadané dny (real = API+cache, mock = generátor). */
export async function getFixturesByDates(dates: string[]): Promise<FixtureDay[]> {
  const days = useReal
    ? await real.getFixturesByDates(dates)
    : mockFixturesByDates(dates);
  await enrichFixtureRanks(days);
  return days;
}

/** Živé skóre našich lig (real = sdílené API+cache; mock = prázdno). */
export async function getLiveFixtures(): Promise<LiveScore[]> {
  return useReal ? real.getLiveFixtures() : [];
}

/** Doplní klubovým zápasům pozici obou týmů v tabulce (FREE kontext; reprezentace přeskočí). */
async function enrichFixtureRanks(days: FixtureDay[]): Promise<void> {
  const teams = days.flatMap((d) =>
    d.fixtures
      .filter((f) => !f.national)
      .flatMap((f) => [
        { id: f.home.id, leagueId: f.leagueId, national: false },
        { id: f.away.id, leagueId: f.leagueId, national: false },
      ])
  );
  if (teams.length === 0) return;
  const ranks = await getRanks(teams);
  for (const d of days) {
    for (const f of d.fixtures) {
      if (f.national) continue;
      f.homeRank = ranks.get(f.home.id) ?? null;
      f.awayRank = ranks.get(f.away.id) ?? null;
    }
  }
}

/**
 * Mapa `teamId → pozice v tabulce` pro dané týmy (real = API+cache per liga; mock =
 * deterministický řádek). Reprezentace se přeskočí (nemají tabulku).
 */
export async function getRanks(
  teams: { id: number; leagueId: number; national: boolean }[]
): Promise<Map<number, number>> {
  if (useReal) return real.getRanks(teams);
  const map = new Map<number, number>();
  for (const t of teams) {
    if (t.national) continue;
    const s = mockStanding(t.id);
    if (s) map.set(t.id, s.rank);
  }
  return map;
}

/**
 * Doplní klubovým tipům pozici obou týmů v tabulce (FREE kontext do `PickRow`).
 * Reprezentační tipy nechá být (nemají tabulku). Sdílí `/api/picks` i `/api/digest`.
 */
export async function stampPickRanks(picks: MatchPick[]): Promise<MatchPick[]> {
  const teams = picks
    .filter((p) => p.compareMode === "CLUB")
    .flatMap((p) => [
      { id: p.home.id, leagueId: p.leagueId, national: false },
      { id: p.away.id, leagueId: p.leagueId, national: false },
    ]);
  if (teams.length === 0) return picks;
  const ranks = await getRanks(teams);
  return picks.map((p) =>
    p.compareMode === "CLUB"
      ? {
          ...p,
          homeRank: ranks.get(p.home.id) ?? null,
          awayRank: ranks.get(p.away.id) ?? null,
        }
      : p
  );
}

/** Nadcházející predikce pro záložku (real = DB store, mock = generátor). */
export async function getUpcomingPredictions(): Promise<PredictionRow[]> {
  if (useReal) return getUpcomingPredictionRows();
  return mockUpcomingPredictions();
}

/**
 * Reverzní mapa `teamId → konfederace` pro deep-link reprezentačních řádků
 * (Tipy/Výsledky → NATIONAL Porovnání). Real = z cachovaných reprezentačních
 * seznamů; mock = prázdná (národní mock řádky zůstanou neklikací, bez pádu).
 */
export async function getNationalConfedMap(): Promise<Map<number, number>> {
  if (useReal) return real.getNationalConfedMap();
  return new Map();
}

/** Odehrané predikce s výsledkem pro track-record (real = DB, mock = generátor). */
export async function getSettledPredictionRows(): Promise<PredictionRow[]> {
  if (useReal) return getSettledPredictions();
  return mockSettledPredictions();
}

/**
 * Nedávno dohrané zápasy s vyhodnocenou predikcí pro záložku „Výsledky".
 * Real = posledních pár dní z DB + dohledání konfederací pro reprezentační deep-link;
 * mock = generátor. FREE (jen historie, žádný konkrétní budoucí tip).
 */
export async function getRecentResults(): Promise<SettledMatch[]> {
  const rows = useReal
    ? await getRecentSettledPredictions()
    : mockSettledPredictions();
  const matches = summarizeSettled(rows);

  // Reprezentačním řádkům dohledej konfederaci každého týmu (deep-link do NATIONAL).
  if (useReal && matches.some((m) => m.compareMode === "NATIONAL")) {
    const confed = await real.getNationalConfedMap();
    for (const m of matches) {
      if (m.compareMode !== "NATIONAL") continue;
      m.homeCompareLeagueId = confed.get(m.home.id) ?? null;
      m.awayCompareLeagueId = confed.get(m.away.id) ?? null;
    }
  }
  return matches;
}

/** Aktuální přestupy vybraných lig (real = DB store, mock = generátor). */
export async function getTransfers(
  leagueIds: number[],
  limit = 200
): Promise<Transfer[]> {
  if (useReal) return getLeagueTransfers(leagueIds, limit);
  return mockLeagueTransfers(leagueIds);
}

/** Bilance přestupů klubů vybraných lig (real = DB agregace, mock = generátor). */
export async function getTransferBalances(
  leagueIds: number[]
): Promise<ClubTransferBalance[]> {
  if (useReal) return getClubBalances(leagueIds);
  return mockClubBalances(leagueIds);
}

/**
 * Postavení týmu v ligové tabulce (FREE kontext). Real = API+cache (per liga);
 * mock = deterministický řádek dle teamId, ať jde UI zkoušet bez DB/API.
 * Reprezentace tabulku nemají → null (UI sekci skryje).
 */
export async function getStanding(
  teamId: number,
  leagueId: number
): Promise<{ standing: Standing | null; leagueAvg: LeagueGoalsAvg | null }> {
  if (useReal) return real.getLeagueStanding(teamId, leagueId);
  return { standing: mockStanding(teamId), leagueAvg: mockLeagueGoalsAvg() };
}

function mockLeagueGoalsAvg(): LeagueGoalsAvg {
  return { goalsFor: 1.35, goalsAgainst: 1.35 };
}

/**
 * Ligové měřítko pro λ (⌀ góly domácích/hostů). Real = z cachované tabulky (0 API navíc);
 * mock/reprezentace/mezisezóna → `null` = predikce sáhne po typickém defaultu.
 */
export async function getLeagueBaseline(
  leagueId: number
): Promise<LeagueBaseline | null> {
  if (useReal) return real.getLeagueBaseline(leagueId);
  return null;
}

/**
 * Síly týmů ligy s korekcí na soupeře a časovým útlumem (C2) – z už cachovaných zápasů,
 * **0 volání API**. `null` (mock, reprezentace, studená cache) → predikce použije okenní model.
 */
export async function getLeagueRatings(
  leagueId: number
): Promise<Map<number, TeamStrength> | null> {
  if (useReal) return real.getLeagueRatings(leagueId);
  return null;
}

/**
 * Globální ratingy reprezentací (jeden pool všech národů) – opravují srovnávání sil
 * napříč konfederacemi. `null` v mocku / při výpadku → padne se na okenní model.
 */
export async function getNationalRatings(): Promise<Map<
  number,
  TeamStrength
> | null> {
  if (useReal) return real.getNationalRatings();
  return null;
}

/**
 * Celá ligová tabulka pro záložku Tabulky. Real = sdílená `standings:` cache
 * (0 API navíc); mock = deterministická tabulka z mock týmů ligy (offline).
 * Reprezentace tabulku nemají → `null`.
 */
export async function getLeagueTable(leagueId: number): Promise<LeagueTable | null> {
  if (useReal) return real.getLeagueTable(leagueId);
  return mockLeagueTable(leagueId);
}

function mockLeagueTable(leagueId: number): LeagueTable | null {
  const teams = allMockTeams().filter(
    (t) => t.leagueId === leagueId && t.entityType !== "NATIONAL"
  );
  if (teams.length === 0) return null;
  const rows: LeagueTableRow[] = teams
    .map((t, i) => {
      const rank = i + 1;
      const wins = Math.max(0, teams.length - rank);
      const losses = Math.max(0, rank - 1);
      const draws = 5;
      const played = wins + draws + losses;
      const goalsFor = 45 - rank;
      const goalsAgainst = 12 + rank;
      const zone =
        rank <= 2
          ? ("champions" as const)
          : rank === 3
            ? ("europa" as const)
            : rank > teams.length - 2
              ? ("relegation" as const)
              : null;
      return {
        rank,
        teamId: t.id,
        name: t.name,
        logoUrl: t.logoUrl,
        played,
        win: wins,
        draw: draws,
        lose: losses,
        goalsFor,
        goalsAgainst,
        goalsDiff: goalsFor - goalsAgainst,
        points: wins * 3 + draws,
        form: "WWDLW",
        zone,
      };
    })
    .sort((a, b) => a.rank - b.rank);
  return { rows, leagueAvg: mockLeagueGoalsAvg() };
}

/**
 * Týmy ligy s herními ratingy pro modul „Manažer". Reálně z ligové tabulky
 * (1 cachované volání); v mocku fiktivní liga (offline, bez DB/API).
 */
export async function getGameLeague(
  leagueId: number
): Promise<{ teams: GameTeam[]; leagueAccess: LeagueAccess | null }> {
  if (useReal) return real.getLeagueGameTeams(leagueId);
  return { teams: generateLeague(12345), leagueAccess: null };
}

function mockStanding(teamId: number): Standing | null {
  const team = allMockTeams().find((t) => t.id === teamId);
  if (!team || team.entityType === "NATIONAL") return null;
  const rank = (teamId % 18) + 1;
  const wins = 20 - rank;
  const losses = rank - 1;
  const draws = 6;
  const played = wins + draws + losses;
  const gf = 40 - rank;
  const ga = 10 + rank;
  const half = (n: number) => Math.round(n / 2);
  return {
    rank,
    points: wins * 3 + draws,
    goalsDiff: gf - ga,
    form: ["W", "W", "D", "L", "W"].slice(0, 5).join(""),
    all: { played, win: wins, draw: draws, lose: losses, goalsFor: gf, goalsAgainst: ga },
    home: {
      played: half(played),
      win: half(wins),
      draw: half(draws),
      lose: half(losses),
      goalsFor: half(gf),
      goalsAgainst: half(ga),
    },
    away: {
      played: played - half(played),
      win: wins - half(wins),
      draw: draws - half(draws),
      lose: losses - half(losses),
      goalsFor: gf - half(gf),
      goalsAgainst: ga - half(ga),
    },
  };
}

/**
 * Nejlepší střelci ligy patřící k týmu (FREE kontext). Real = API+cache per liga;
 * mock = deterministických 0–2 hráčů dle teamId. Reprezentace → prázdné.
 */
export async function getTopScorers(
  teamId: number,
  leagueId: number
): Promise<Scorer[]> {
  if (useReal) return real.getTeamTopScorers(teamId, leagueId);
  const team = allMockTeams().find((t) => t.id === teamId);
  if (!team || team.entityType === "NATIONAL") return [];
  const count = teamId % 3; // 0–2 střelci
  return Array.from({ length: count }, (_, i) => ({
    playerId: teamId * 1000 + i,
    name: `Střelec #${i + 1}`,
    goals: 15 - i * 4 - (teamId % 3),
  }));
}

function mockLeagueClubTeams(leagueId: number): Team[] {
  return allMockTeams().filter(
    (t) => t.leagueId === leagueId && t.entityType !== "NATIONAL"
  );
}

/** Nejlepší střelci CELÉ ligy (Tabulky). Real = sdílená cache; mock = deterministický žebříček. */
export async function getLeagueScorers(
  leagueId: number,
  limit = 10
): Promise<LeagueScorer[]> {
  if (useReal) return real.getLeagueScorers(leagueId, limit);
  return mockLeagueClubTeams(leagueId)
    .slice(0, limit)
    .map((t, i) => ({
      playerId: t.id * 1000,
      name: `Střelec ${t.name}`,
      value: 20 - i * 2,
      teamId: t.id,
      teamName: t.name,
      teamLogo: t.logoUrl,
    }));
}

/** Nejlepší nahrávači CELÉ ligy (Tabulky). Real = API+cache; mock = deterministický žebříček. */
export async function getLeagueAssists(
  leagueId: number,
  limit = 10
): Promise<LeagueScorer[]> {
  if (useReal) return real.getLeagueAssists(leagueId, limit);
  return mockLeagueClubTeams(leagueId)
    .slice(0, limit)
    .map((t, i) => ({
      playerId: t.id * 1000 + 1,
      name: `Nahrávač ${t.name}`,
      value: 15 - i * 2,
      teamId: t.id,
      teamName: t.name,
      teamLogo: t.logoUrl,
    }));
}

/** Poslední + příští kolo vybrané ligy (Tabulky). Real = API+cache; mock = pár fiktivních dvojic. */
export async function getLeagueRound(leagueId: number): Promise<LeagueRound | null> {
  if (useReal) return real.getLeagueRound(leagueId);
  const teams = mockLeagueClubTeams(leagueId);
  if (teams.length < 4) return null;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const pair = (
    a: Team,
    b: Team,
    offsetDays: number,
    played: boolean
  ) => ({
    fixtureId: a.id * 100000 + b.id,
    kickoff: new Date(now + offsetDays * day).toISOString(),
    home: { id: a.id, name: a.name, logoUrl: a.logoUrl },
    away: { id: b.id, name: b.name, logoUrl: b.logoUrl },
    homeGoals: played ? 2 : null,
    awayGoals: played ? 1 : null,
  });
  return {
    last: [pair(teams[0], teams[1], -7, true), pair(teams[2], teams[3], -7, true)],
    next: [pair(teams[1], teams[0], 7, false), pair(teams[3], teams[2], 7, false)],
  };
}

const MOCK_INJURY_REASONS = [
  "Zranění kolene",
  "Natažený sval",
  "Trest za karty",
  "Zranění kotníku",
  "Nemoc",
];

/** Aktuálně zranění/absentující hráči (líně načítané, mimo zápasové statistiky). */
export async function getInjuries(
  teamId: number,
  leagueId: number
): Promise<Injury[]> {
  if (useReal) return real.getTeamInjuries(teamId, leagueId);
  // Deterministický mock (0–3 položky dle teamId), ať jde UI zkoušet bez API.
  const count = teamId % 4;
  return Array.from({ length: count }, (_, i) => {
    const pid = teamId * 100 + i;
    return {
      playerId: pid,
      name: `Hráč #${i + 1}`,
      reason: MOCK_INJURY_REASONS[(teamId + i) % MOCK_INJURY_REASONS.length],
    };
  });
}
