import type { MatchStat, PredictionRow, Team } from "@/lib/types";
import { compareTeams } from "@/lib/stats/compare";
import {
  DEFAULT_BASELINE,
  PREDICT_PARAMS,
  type LeagueBaseline,
  type PredictTuning,
} from "@/lib/stats/predict";

/**
 * Offline backtest: přehraje historické zápasy **stejným jádrem** (`compareTeams` →
 * `predictMatch`), jaké běží v produkci, a vydá `PredictionRow[]` – tedy přesně ten tvar,
 * který už umí `computeTrackRecord` / `computeReliability` / `fit.ts`. Model se tak dá měřit
 * a ladit na tisících zápasů **hned**, ne rychlostí, jakou se hrají (a jakou se plní DB).
 *
 * Dvě vědomá omezení oproti produkci (obojí zapiš do závěru, ať se čísla nepřecení):
 *  1. **Bez xG.** λ v produkci míchá gólový odhad s xG, když je k dispozici. xG je jen
 *     v `/fixtures/statistics` = 1 volání na zápas → pro tisíce zápasů neúnosné. Backtest
 *     tedy měří **gólovou část** λ; xG by měl výsledky spíš zlepšit, ne zhoršit.
 *  2. **Jen ligové zápasy.** Poháry (`euroMatches`) nesbíráme – pro top-5 ligy okrajové.
 *
 * Klíčová vlastnost: **point-in-time**. Tým se staví jen ze zápasů s datem PŘED výkopem
 * predikovaného zápasu (`buildTeamAt`) → žádný leak z budoucnosti. Kryto testem.
 */

/** Odehraný zápas z historie ligy (jen to, co jde levně vytáhnout z `/fixtures`). */
export interface HistoryMatch {
  fixtureId: number;
  date: string; // ISO
  season: number; // ligová sezóna (rok začátku)
  leagueId: number;
  homeId: number;
  awayId: number;
  homeName: string;
  awayName: string;
  homeLogo: string;
  awayLogo: string;
  /** Skóre po 90 minutách (v lize = koncové; viz `fullTimeGoals`). */
  homeGoals: number;
  awayGoals: number;
}

/**
 * Zápasy jednoho týmu **před** daným datem, převedené na `MatchStat`.
 *
 * `isBaseline` = zápas z předchozí sezóny (okno SEASON, váha 15 %). Produkce ho určuje
 * dynamicky v `realRepository` („nejnovější dokončená sezóna"); při pohledu zevnitř sezóny
 * `season` je to vždy `season - 1`, takže se to shoduje.
 */
export function matchStatsBefore(
  history: HistoryMatch[],
  teamId: number,
  before: string,
  season: number
): MatchStat[] {
  return history
    .filter(
      (m) =>
        (m.homeId === teamId || m.awayId === teamId) &&
        m.date < before &&
        (m.season === season || m.season === season - 1)
    )
    .map((m) => {
      const isHome = m.homeId === teamId;
      const gf = isHome ? m.homeGoals : m.awayGoals;
      const ga = isHome ? m.awayGoals : m.homeGoals;
      return {
        fixtureId: m.fixtureId,
        date: m.date,
        isHome,
        isNeutral: false,
        competitive: true,
        season: m.season,
        isBaseline: m.season === season - 1,
        metrics: { GOALS_FOR: gf, GOALS_AGAINST: ga },
      } satisfies MatchStat;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Klubový `Team` postavený jen z historie dostupné před `before` (point-in-time). */
export function buildTeamAt(
  history: HistoryMatch[],
  teamId: number,
  meta: { name: string; logoUrl: string; leagueId: number },
  before: string,
  season: number
): Team {
  return {
    id: teamId,
    name: meta.name,
    logoUrl: meta.logoUrl,
    country: "",
    entityType: "CLUB",
    leagueId: meta.leagueId,
    leagueMatches: matchStatsBefore(history, teamId, before, season),
  };
}

/**
 * Ligové měřítko (⌀ góly domácích/hostů) z **předchozí** sezóny téže ligy → do predikce
 * nemůže protéct nic z hodnoceného ročníku. Chybí-li předchozí sezóna, vrací default.
 */
export function baselineFor(
  history: HistoryMatch[],
  leagueId: number,
  season: number
): LeagueBaseline {
  const prev = history.filter(
    (m) => m.leagueId === leagueId && m.season === season - 1
  );
  if (prev.length < 50) return DEFAULT_BASELINE;
  const home = prev.reduce((a, m) => a + m.homeGoals, 0) / prev.length;
  const away = prev.reduce((a, m) => a + m.awayGoals, 0) / prev.length;
  return { home, away };
}

export interface BacktestOptions {
  /** Predikuj jen zápasy těchto sezón (starší slouží jako baseline/rozjezd). */
  seasons: number[];
  /** Vyžaduj aspoň tolik předchozích zápasů u OBOU týmů (0 = predikuj i 1. kolo). */
  minMatches?: number;
  /** Ladicí parametry λ – grid search v `scripts/backtest.ts` (bez nich produkční default). */
  tuning?: PredictTuning;
}

/**
 * Přehraje historii a vrátí predikce ve tvaru `PredictionRow` (s doplněným skutečným
 * výsledkem) → jde je rovnou prohnat `computeTrackRecord`, `computeReliability`, `fit.ts`.
 */
export function backtest(
  history: HistoryMatch[],
  opts: BacktestOptions
): PredictionRow[] {
  const seasons = new Set(opts.seasons);
  const minMatches = opts.minMatches ?? 0;
  const rows: PredictionRow[] = [];
  // Ligové měřítko se počítá 1× per liga+sezóna (z předchozí sezóny), ne pro každý zápas.
  const baselines = new Map<string, LeagueBaseline>();

  for (const m of history) {
    if (!seasons.has(m.season)) continue;

    const key = `${m.leagueId}:${m.season}`;
    let baseline = baselines.get(key);
    if (!baseline) {
      baseline = baselineFor(history, m.leagueId, m.season);
      baselines.set(key, baseline);
    }

    const home = buildTeamAt(
      history,
      m.homeId,
      { name: m.homeName, logoUrl: m.homeLogo, leagueId: m.leagueId },
      m.date,
      m.season
    );
    const away = buildTeamAt(
      history,
      m.awayId,
      { name: m.awayName, logoUrl: m.awayLogo, leagueId: m.leagueId },
      m.date,
      m.season
    );
    if (
      home.leagueMatches.length < minMatches ||
      away.leagueMatches.length < minMatches
    ) {
      continue;
    }

    // `now` = datum zápasu → časová okna (reprezentace) i vše ostatní se dívají do minulosti.
    const p = compareTeams(home, away, new Date(m.date), {
      baseline,
      tuning: opts.tuning,
    }).prediction;
    if (!p) continue;

    rows.push({
      fixtureId: m.fixtureId,
      leagueId: m.leagueId,
      season: m.season,
      kickoff: m.date,
      homeTeamId: m.homeId,
      awayTeamId: m.awayId,
      homeName: m.homeName,
      awayName: m.awayName,
      homeLogo: m.homeLogo,
      awayLogo: m.awayLogo,
      available: p.available,
      // Základní λ (před zostřením) – stejně jako ukládá produkční pipeline.
      lambdaHome: p.lambdaHomeBase,
      lambdaAway: p.lambdaAwayBase,
      homeWin: p.homeWin,
      draw: p.draw,
      awayWin: p.awayWin,
      bttsYes: p.bttsYes,
      over25: p.over25,
      lowConfidence: p.lowConfidence,
      readinessSample: p.readiness.sample,
      modelVersion: 0, // backtest, ne produkční řádek
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

/**
 * Referenční baseline: konstantní 1X2 pravděpodobnosti (typický fotbalový rozdaj).
 * Model, který tohle nepřekoná, nedělá vůbec nic – povinná kontrola smyslu.
 */
export const NAIVE_PROBS = { home: 0.45, draw: 0.26, away: 0.29 };
