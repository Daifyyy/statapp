import { getCompareTeam, getLeagueBaseline } from "./repository";
import {
  getCompareNationalTeamFromFixture,
  getCompareNationalHomeAwayTeamFromFixture,
} from "./realRepository";
import {
  ALL_NATIONAL_PREDICTION_LEAGUE_IDS,
  isNationalTournamentLeague,
  isNationalHomeAwayLeague,
} from "./catalog";
import { compareTeams } from "@/lib/stats/compare";
import {
  fetchLeagueUpcomingFixtures,
  fetchFixturesByIds,
  fetchPrediction,
  fetchOdds,
  FINISHED_STATUSES,
} from "./apiFootball";
import { fullTimeGoals } from "./fixtures";
import {
  upsertPrediction,
  getUnsettledPredictions,
  applyResult,
  hasBenchmark,
  saveBenchmark,
  hasOdds,
  saveOdds,
} from "./predictionStore";

/**
 * Orchestrace predikční pipeline (běží jen na pozadí / cron, real data).
 * predict-upcoming: pro Top 5 lig spočítá predikce nadcházejících zápasů a uloží.
 * settle-results: u odehraných predikcí dotáhne skutečný výsledek.
 */

/**
 * Verze modelu = **co generuje λ** (okna, váhy, xG zpevnění, build týmů). Bump vynuluje
 * dataset (kalibrace i track-record běží per verzi), protože stará λ už nejde srovnávat.
 *
 * **NEbumpuj kvůli ρ / zostření λ** – to jsou post-parametry nad uloženými λ
 * (`PREDICT_PARAMS` v `lib/stats/predict.ts`). Změna konstanty + `npm run reprice`
 * přepočte historii čistou matematikou, bez API a bez ztráty nasbíraných zápasů.
 */
export const MODEL_VERSION = 2;

/** Sledované klubové ligy (uživatelská volba: Top 5 lig). */
export const PREDICTION_LEAGUES = [39, 140, 135, 78, 61];

/**
 * Všechny sledované soutěže pro predikci: klubové ligy + reprezentační soutěže
 * (`ALL_NATIONAL_PREDICTION_LEAGUE_IDS` z catalogu – meta týmů z fixture; finálové
 * turnaje venue-neutrálně, Liga národů s home/away splitem). Mimo sezónu vrací API prázdno.
 */
export const ALL_PREDICTION_LEAGUES = [
  ...PREDICTION_LEAGUES,
  ...ALL_NATIONAL_PREDICTION_LEAGUE_IDS,
];

/** Kolik nejbližších zápasů ligy predikovat (pokryje kolo + rezervu). */
const UPCOMING_PER_LEAGUE = 15;

/**
 * Kurzy tahneme jen pro zápasy do tohoto okna před výkopem. Týden staré kurzy nemají
 * pro EV smysl (trh se hýbe); 72 h je kompromis „už actionable, pořád 1× za život
 * zápasu" – cron běží denně, takže okno každý zápas zachytí těsně před výkopem.
 */
const ODDS_LOOKAHEAD_HOURS = 72;

/**
 * Spočítá a uloží predikce nadcházejících zápasů. `leagueIds` umožní ruční/dávkový
 * běh jedné soutěže (mimo sezónu vrací prázdno). Idempotentní (upsert). Klubové ligy
 * staví týmy přes konfederačně-nezávislý `getCompareTeam`; reprezentační turnaje
 * (MS) staví týmy s meta z fixture (tým z libovolné konfederace).
 */
export async function runPredictUpcoming(
  leagueIds: number[] = ALL_PREDICTION_LEAGUES
): Promise<{ leagues: number; fixtures: number; predicted: number }> {
  let fixtures = 0;
  let predicted = 0;
  for (const leagueId of leagueIds) {
    let upcoming;
    try {
      upcoming = await fetchLeagueUpcomingFixtures(leagueId, UPCOMING_PER_LEAGUE);
    } catch {
      continue; // výpadek jedné ligy nezastaví ostatní
    }
    // Volba build módu týmu pro soutěž: klub → konfederačně-nezávislý getCompareTeam;
    // reprezentační finálový turnaj → venue-neutrální (meta z fixture); Liga národů →
    // venue-split (home/away z fixtures → predikce má domácí výhodu).
    const national = isNationalTournamentLeague(leagueId);
    const homeAway = national && isNationalHomeAwayLeague(leagueId);
    // Ligové měřítko pro λ – 1× per liga, z už cachované tabulky (0 API navíc).
    // Reprezentace tabulku nemají → null → predikce použije typický default.
    const baseline = (await getLeagueBaseline(leagueId)) ?? undefined;
    const buildSide = (t: { id: number; name: string; logo: string }) => {
      if (!national) return getCompareTeam(t.id, leagueId, false);
      const meta = { name: t.name, logoUrl: t.logo, country: t.name };
      return homeAway
        ? getCompareNationalHomeAwayTeamFromFixture(t.id, leagueId, meta)
        : getCompareNationalTeamFromFixture(t.id, leagueId, meta);
    };
    for (const f of upcoming) {
      fixtures++;
      try {
        const [home, away] = await Promise.all([
          buildSide(f.teams.home),
          buildSide(f.teams.away),
        ]);
        if (!home || !away) continue;
        const result = compareTeams(home, away, new Date(), { baseline });
        const p = result.prediction;
        if (!p) continue;
        await upsertPrediction({
          fixtureId: f.fixture.id,
          leagueId,
          season: f.league.season,
          kickoff: f.fixture.date,
          homeTeamId: f.teams.home.id,
          awayTeamId: f.teams.away.id,
          homeName: result.home.team.name,
          awayName: result.away.team.name,
          homeLogo: result.home.team.logoUrl,
          awayLogo: result.away.team.logoUrl,
          available: p.available,
          // Ukládej ZÁKLADNÍ λ (před zostřením) – z něj jde predikci přepočítat při
          // změně ρ/zostření (`npm run reprice`) bez resetu datasetu.
          lambdaHome: p.lambdaHomeBase,
          lambdaAway: p.lambdaAwayBase,
          homeWin: p.homeWin,
          draw: p.draw,
          awayWin: p.awayWin,
          bttsYes: p.bttsYes,
          over25: p.over25,
          lowConfidence: p.lowConfidence,
          readinessSample: p.readiness.sample,
          modelVersion: MODEL_VERSION,
        });
        predicted++;

        // Interní benchmark: predikce API-Footballu (1X2) na týž řádek. Jen klubové
        // ligy (reprezentace API predikce nemá), jen 1× za život zápasu (drží náklady
        // i srovnatelný okamžik). Výpadek/null nesmí shodit náš řádek.
        if (!national) {
          try {
            if (!(await hasBenchmark(f.fixture.id))) {
              const bench = await fetchPrediction(f.fixture.id);
              if (bench) await saveBenchmark(f.fixture.id, bench);
            }
          } catch {
            // benchmark je best-effort
          }

          // Referenční kurzy pro EV/value tipy. Jen klubové ligy, jen blízko výkopu
          // (kurzy jsou pak actionable), 1×/zápas (guard hasOdds). Best-effort jako benchmark.
          try {
            const hoursToKickoff =
              (new Date(f.fixture.date).getTime() - Date.now()) / 3_600_000;
            if (
              hoursToKickoff <= ODDS_LOOKAHEAD_HOURS &&
              !(await hasOdds(f.fixture.id))
            ) {
              const odds = await fetchOdds(f.fixture.id);
              if (odds) await saveOdds(f.fixture.id, odds);
            }
          } catch {
            // kurzy jsou best-effort
          }
        }
      } catch {
        // přeskoč problémový zápas, pokračuj dál
      }
    }
  }
  return { leagues: leagueIds.length, fixtures, predicted };
}

/** Dotáhne výsledky u predikcí, jejichž zápas už proběhl (batch po 20 ID). */
export async function runSettleResults(): Promise<{
  pending: number;
  settled: number;
}> {
  const pending = await getUnsettledPredictions();
  let settled = 0;
  for (let i = 0; i < pending.length; i += 20) {
    const chunk = pending.slice(i, i + 20);
    let fixtures;
    try {
      fixtures = await fetchFixturesByIds(chunk.map((p) => p.fixtureId));
    } catch {
      continue;
    }
    for (const f of fixtures) {
      if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
      // Skóre po 90 min (ne koncové) – model predikuje regulérní hrací dobu, viz `fullTimeGoals`.
      const ft = fullTimeGoals(f);
      await applyResult(
        f.fixture.id,
        f.fixture.status.short,
        ft?.home ?? null,
        ft?.away ?? null
      );
      settled++;
    }
  }
  return { pending: pending.length, settled };
}
