import type { MatchStat, PredictionRow, Team } from "@/lib/types";
import { compareTeams } from "@/lib/stats/compare";
import {
  DEFAULT_BASELINE,
  PREDICT_PARAMS,
  type LeagueBaseline,
} from "@/lib/stats/predict";
import {
  isNationalTournamentLeague,
  NATIONAL_HOME_AWAY_LEAGUE_IDS,
} from "@/lib/data/catalog";
import {
  computeRatings,
  type RatingMatch,
  type RatingOptions,
  type TeamStrength,
} from "@/lib/stats/ratings";

/**
 * Offline backtest **reprezentací** – protějšek `backtest.ts` pro kluby.
 *
 * Proč zvlášť: reprezentace mají jiný svět. Časová okna místo počtových, **venue-neutrální**
 * zápasy (produkce je tak staví: `isNeutral: true`), přáteláky s nižší vahou, žádné xG
 * (API u nich statistiky většinou nemá) a hlavně **žádnou ligu** – tým se poměřuje s celým
 * světem, ne s tabulkou. Právě proto je současný model u reprezentací podezřelý: srovnává
 * góly Portugalska (nastřílené v UEFA) s góly Uzbekistánu (nastřílenými v AFC), jako by
 * pocházely ze stejného rozdělení.
 *
 * Tenhle harness měří **současný stav**, aby bylo proti čemu poměřovat globální ratingy.
 * Věrně replikuje produkční build: historie = všechny reprezentační zápasy týmu (napříč
 * soutěžemi, jako `fetchLastFixtures`), venue-neutrální, přáteláky označené `competitive:false`.
 */

/** Odehraný reprezentační zápas (góly stačí – xG u reprezentací API nedává). */
export interface NationalMatch {
  fixtureId: number;
  date: string; // ISO
  leagueId: number; // soutěž (kvalifikace / turnaj / Liga národů / přátelák)
  friendly: boolean;
  homeId: number;
  awayId: number;
  homeName: string;
  awayName: string;
  homeLogo: string;
  awayLogo: string;
  homeGoals: number;
  awayGoals: number;
}

/** Kolik zápasů zpět brát (časová okna reprezentací sahají ~24 měsíců). */
const HISTORY_MONTHS = 30;

/**
 * Zápasy týmu **před** daným datem jako `MatchStat`. Venue-neutrální (shodně s produkcí),
 * takže vše spadne do TOTAL – doma/venku se u reprezentací nedělí.
 */
export function nationalStatsBefore(
  history: NationalMatch[],
  teamId: number,
  before: string
): MatchStat[] {
  const cutoff = new Date(
    new Date(before).getTime() - HISTORY_MONTHS * 30 * 24 * 3600 * 1000
  ).toISOString();

  return history
    .filter(
      (m) =>
        (m.homeId === teamId || m.awayId === teamId) &&
        m.date < before &&
        m.date >= cutoff
    )
    .map((m) => {
      const isHome = m.homeId === teamId;
      return {
        fixtureId: m.fixtureId,
        date: m.date,
        isHome,
        isNeutral: true, // produkce staví reprezentace venue-neutrálně
        competitive: !m.friendly,
        season: 0,
        isBaseline: false, // reprezentace mají časová okna, ne sezónní baseline
        metrics: {
          GOALS_FOR: isHome ? m.homeGoals : m.awayGoals,
          GOALS_AGAINST: isHome ? m.awayGoals : m.homeGoals,
        },
      } satisfies MatchStat;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Reprezentační `Team` postavený jen z historie dostupné před `before` (point-in-time). */
export function buildNationalTeamAt(
  history: NationalMatch[],
  teamId: number,
  meta: { name: string; logoUrl: string },
  before: string
): Team {
  return {
    id: teamId,
    name: meta.name,
    logoUrl: meta.logoUrl,
    country: meta.name,
    entityType: "NATIONAL",
    leagueId: 0, // reprezentace nemá ligu (v produkci se sem dává konfederace)
    leagueMatches: nationalStatsBefore(history, teamId, before),
  };
}

/**
 * Globální měřítko: kolik gólů dá průměrná reprezentace za zápas. U venue-neutrálních
 * zápasů se `home`/`away` stejně slévá do průměru, ale drží se rozdíl kvůli kvalifikacím
 * (ty se hrají doma/venku, jen je produkce takhle nerozlišuje).
 */
export function nationalBaseline(history: NationalMatch[]): LeagueBaseline {
  if (history.length < 100) return DEFAULT_BASELINE;
  const home = history.reduce((a, m) => a + m.homeGoals, 0) / history.length;
  const away = history.reduce((a, m) => a + m.awayGoals, 0) / history.length;
  return { home, away };
}

export interface NationalBacktestOptions {
  /** Predikuj jen zápasy v tomto období (ISO datum od–do). */
  from: string;
  to: string;
  /** Predikuj jen tyhle soutěže (default: co predikuje produkce – turnaje + Liga národů). */
  competitions?: number[];
  /** Vyžaduj aspoň tolik předchozích zápasů u OBOU týmů. */
  minMatches?: number;
  /**
   * **Globální** ratingy (jeden pool VŠECH reprezentací) místo okenních průměrů. Klíčové:
   * ratingy per konfederace by chybu zopakovaly (každý pool normalizovaný na svou 1.0);
   * v jednom poolu propojí konfederace přáteláky a mezikontinentální zápasy a iterativní
   * schéma po těch hranách sílu propaguje – stejně jako Elo.
   */
  ratings?: Omit<RatingOptions, "home" | "away">;
  /** Váha přáteláku vůči soutěžnímu zápasu (rotace, experimenty → slabší signál). */
  friendlyWeight?: number;
}

/** Zápasy jako vstup pro ratingy: turnaje = neutrální půda, přáteláky s nižší vahou. */
function toRatingMatches(
  history: NationalMatch[],
  friendlyWeight: number
): RatingMatch[] {
  return history.map((m) => ({
    date: m.date,
    homeId: m.homeId,
    awayId: m.awayId,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
    neutral: isNationalTournamentLeague(m.leagueId) && !NATIONAL_HOME_AWAY.has(m.leagueId),
    weight: m.friendly ? friendlyWeight : 1,
  }));
}

const NATIONAL_HOME_AWAY = new Set(NATIONAL_HOME_AWAY_LEAGUE_IDS);

/** Soutěže, které produkce reálně predikuje (turnaje + Liga národů). */
export const PREDICTED_NATIONAL = (leagueId: number) =>
  isNationalTournamentLeague(leagueId);

/**
 * Přehraje reprezentační historii **stejným jádrem** (`compareTeams`) a vrátí `PredictionRow[]`
 * → jde rovnou do `computeTrackRecord` / `computeReliability` / `fit.ts`, jako u klubů.
 */
export function backtestNational(
  history: NationalMatch[],
  opts: NationalBacktestOptions
): PredictionRow[] {
  const baseline = nationalBaseline(history);
  const minMatches = opts.minMatches ?? 0;
  const predicted = opts.competitions
    ? (id: number) => opts.competitions!.includes(id)
    : PREDICTED_NATIONAL;

  const ratingInput = opts.ratings
    ? toRatingMatches(history, opts.friendlyWeight ?? 1)
    : [];
  // Ratingy se přepočítávají po dnech (zápasy téhož dne mají stejnou minulost).
  const ratingCache = new Map<string, Map<number, TeamStrength>>();

  const rows: PredictionRow[] = [];
  for (const m of history) {
    if (m.date < opts.from || m.date > opts.to) continue;
    if (!predicted(m.leagueId)) continue;

    let strength: { home: TeamStrength; away: TeamStrength } | undefined;
    if (opts.ratings) {
      const day = m.date.slice(0, 10);
      let table = ratingCache.get(day);
      if (!table) {
        table = computeRatings(ratingInput, m.date, {
          ...opts.ratings,
          home: baseline.home,
          away: baseline.away,
        });
        ratingCache.set(day, table);
      }
      const h = table.get(m.homeId);
      const a = table.get(m.awayId);
      if (h && a) strength = { home: h, away: a };
    }

    const home = buildNationalTeamAt(
      history,
      m.homeId,
      { name: m.homeName, logoUrl: m.homeLogo },
      m.date
    );
    const away = buildNationalTeamAt(
      history,
      m.awayId,
      { name: m.awayName, logoUrl: m.awayLogo },
      m.date
    );
    if (
      home.leagueMatches.length < minMatches ||
      away.leagueMatches.length < minMatches
    ) {
      continue;
    }

    // Turnaje se hrají na neutrální půdě (Liga národů a kvalifikace ne).
    const neutral =
      isNationalTournamentLeague(m.leagueId) && !NATIONAL_HOME_AWAY.has(m.leagueId);
    const p = compareTeams(home, away, new Date(m.date), {
      baseline,
      strength,
      neutral,
    }).prediction;
    if (!p) continue;

    rows.push({
      fixtureId: m.fixtureId,
      leagueId: m.leagueId,
      season: 0,
      kickoff: m.date,
      homeTeamId: m.homeId,
      awayTeamId: m.awayId,
      homeName: m.homeName,
      awayName: m.awayName,
      homeLogo: m.homeLogo,
      awayLogo: m.awayLogo,
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
      status: "FT",
      homeGoals: m.homeGoals,
      awayGoals: m.awayGoals,
      benchAvailable: false,
      benchHomeWin: null,
      benchDraw: null,
      benchAwayWin: null,
      oddsBookmaker: null,
      oddsHome: null,
      oddsDraw: null,
      oddsAway: null,
      oddsOver25: null,
      oddsBtts: null,
    });
  }
  return rows;
}
