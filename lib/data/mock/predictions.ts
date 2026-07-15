import type { PredictionRow, Team } from "@/lib/types";
import { compareTeams } from "@/lib/stats/compare";
import { PREDICT_PARAMS } from "@/lib/stats/predict";
import { NATIONAL_TOURNAMENT_LEAGUE_IDS } from "../catalog";
import { buildTeams } from "./seed";

/** Mock id reprezentačního turnaje (MS) – sjednoceno s catalogem kvůli UI. */
const TOURNAMENT_LEAGUE_ID = NATIONAL_TOURNAMENT_LEAGUE_IDS[0];

/**
 * Deterministické mock predikce, aby predikční záložka i track-record fungovaly
 * bez DB/API (mock režim). Predikce počítá reálným jádrem (compareTeams) nad
 * mock týmy → čísla jsou konzistentní s ostatkem appky. modelVersion = 0 (mock).
 */

function rowFrom(
  home: Team,
  away: Team,
  fixtureId: number,
  kickoff: string,
  status: string,
  homeGoals: number | null,
  awayGoals: number | null,
  leagueId: number = home.leagueId,
  bench: { home: number; draw: number; away: number } | null = null
): PredictionRow {
  const r = compareTeams(home, away);
  const p = r.prediction!;
  return {
    fixtureId,
    leagueId,
    season: 2025,
    kickoff,
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeName: r.home.team.name,
    awayName: r.away.team.name,
    homeLogo: r.home.team.logoUrl,
    awayLogo: r.away.team.logoUrl,
    available: p.available,
    lambdaHome: p.lambdaHomeBase,
    lambdaAway: p.lambdaAwayBase,
    homeWin: p.homeWin,
    draw: p.draw,
    awayWin: p.awayWin,
    bttsYes: p.bttsYes,
    over25: p.over25,
    lowConfidence: p.lowConfidence,
    readinessSample: p.readiness.sample,
    modelVersion: 0,
    rho: PREDICT_PARAMS.rho,
    sharpen: PREDICT_PARAMS.sharpen,
    calibA: PREDICT_PARAMS.calibA,
    calibB: PREDICT_PARAMS.calibB,
    status,
    homeGoals,
    awayGoals,
    // Benchmark (predikce API-Footballu) se reálně plní jen klubovou pipeline.
    // V mocku ho dodáváme jen odehraným klubovým řádkům (viz mockSettledPredictions),
    // aby srovnávací panel fungoval bez DB/API.
    benchAvailable: bench != null,
    benchHomeWin: bench?.home ?? null,
    benchDraw: bench?.draw ?? null,
    benchAwayWin: bench?.away ?? null,
    // Kurzy se reálně plní jen klubovou pipeline; v mocku je nenastavujeme.
    oddsBookmaker: null,
    oddsHome: null,
    oddsDraw: null,
    oddsAway: null,
    oddsOver25: null,
    oddsBtts: null,
  };
}

/**
 * Mock benchmark = naše predikce regresovaná k uniformní (1/3) → realisticky vypadající,
 * ale slabší konkurent (méně vyhraněný → typicky horší log-loss). Deterministické, žádný
 * trik na „vždy vyhrajeme" – jen méně sebevědomé pravděpodobnosti.
 */
function benchFrom(p: { homeWin: number; draw: number; awayWin: number }) {
  const k = 0.65; // podíl zachované „síly" predikce, zbytek táhne k 1/3
  const mix = (x: number) => k * x + (1 - k) * (1 / 3);
  const h = mix(p.homeWin);
  const d = mix(p.draw);
  const a = mix(p.awayWin);
  const s = h + d + a;
  return { home: h / s, draw: d / s, away: a / s };
}

/** Dvojice klubů ze stejné ligy (po sobě jdoucí). */
function clubPairs(): [Team, Team][] {
  const clubs = buildTeams().filter((t) => t.entityType === "CLUB");
  const pairs: [Team, Team][] = [];
  for (let i = 0; i + 1 < clubs.length; i += 2) {
    if (clubs[i].leagueId === clubs[i + 1].leagueId) {
      pairs.push([clubs[i], clubs[i + 1]]);
    }
  }
  return pairs;
}

/** Dvojice reprezentací (po sobě jdoucí) – pro mock predikce turnaje (MS). */
function nationalPairs(): [Team, Team][] {
  const nats = buildTeams().filter((t) => t.entityType === "NATIONAL");
  const pairs: [Team, Team][] = [];
  for (let i = 0; i + 1 < nats.length; i += 2) pairs.push([nats[i], nats[i + 1]]);
  return pairs;
}

const DAY = 24 * 60 * 60 * 1000;

/** Nadcházející mock predikce (status NS, výkop v budoucnu) – kluby + pár zápasů MS. */
export function mockUpcomingPredictions(): PredictionRow[] {
  const club = clubPairs()
    .slice(0, 8)
    .map(([h, a], i) =>
      rowFrom(
        h,
        a,
        900000 + i,
        new Date(Date.now() + (i + 1) * DAY).toISOString(),
        "NS",
        null,
        null
      )
    );
  // Reprezentační turnaj (MS): leagueId = id turnaje (UI pak skryje proklik).
  const national = nationalPairs()
    .slice(0, 3)
    .map(([h, a], i) =>
      rowFrom(
        h,
        a,
        905000 + i,
        new Date(Date.now() + (i + 1) * DAY).toISOString(),
        "NS",
        null,
        null,
        TOURNAMENT_LEAGUE_ID
      )
    );
  return [...club, ...national];
}

/** Odehrané mock predikce s výsledkem (pro track-record). Každý 3. = překvapení. */
export function mockSettledPredictions(): PredictionRow[] {
  // Stejné páry jako nadcházející (mock seed má jen pár klubů), jiné fixtureId/datum
  // a status FT → track-record i benchmark panel se v mocku reálně naplní.
  const pairs = clubPairs();
  return pairs.map(([h, a], i) => {
    const r = compareTeams(h, a);
    const p = r.prediction!;
    const homeFav = p.homeWin >= p.awayWin;
    const upset = i % 3 === 2; // občas favorit nevyjde
    const favWins = !upset;
    const [hg, ag] = favWins
      ? homeFav
        ? [2, 1]
        : [1, 2]
      : homeFav
        ? [1, 1]
        : [1, 1];
    return rowFrom(
      h,
      a,
      910000 + i,
      new Date(Date.now() - (i + 1) * DAY).toISOString(),
      "FT",
      hg,
      ag,
      h.leagueId,
      benchFrom(p)
    );
  });
}
