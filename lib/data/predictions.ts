import {
  getCompareTeam,
  getLeagueBaseline,
  getLeagueRatings,
  getNationalRatings,
} from "./repository";
import {
  getCompareNationalTeamFromFixture,
  getCompareNationalHomeAwayTeamFromFixture,
} from "./realRepository";
import {
  ALL_NATIONAL_PREDICTION_LEAGUE_IDS,
  CLUB_LEAGUES,
  dayOfYear,
  isNationalTournamentLeague,
  isNationalHomeAwayLeague,
  isNeutralNationalLeague,
  rotateLeagues,
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
  saveOdds,
  saveClosingOdds,
  saveOddsSeries,
  fixturesNeedingOdds,
} from "./predictionStore";
import {
  appendPoint,
  parseSeries,
  seriesPointFrom,
  snapshotPlan,
} from "@/lib/picks/oddsSeries";
import { logError } from "@/lib/logError";

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
export const MODEL_VERSION = 7;

/**
 * Ligy, kde model **neporazil naivní konstantu** (45/26/29) – predikce pro ně nemá cenu
 * počítat. Změřeno `npm run backtest` (sezóny 2024+2025, per liga):
 *   Polsko 106     log-loss 1.0807 vs konstanta 1.0694 → **−0.011 = horší než hádat**
 *   Švýcarsko 207  log-loss 1.0746 vs konstanta 1.0722 → **−0.002 = nic**
 * Nejde o „málo dat" (612 a 460 zápasů) ani o chybějící xG – ten nemají ani ligy, které
 * vedou (Portugalsko +0.117, Řecko +0.098, ČR +0.089). Tip z ligy bez hrany je čistý šum,
 * navíc stojí čas cronu a kvótu. Belgie (144) tu **není**: dřív označená za nejslabší,
 * v širším měření je +0.032 nad konstantou, tedy slabá, ale se skillem.
 * Před vyřazením další ligy vždy nejdřív změř – pořadí odporuje intuici.
 */
export const NO_SKILL_LEAGUES = [106, 207];

/**
 * Sledované klubové ligy pro predikci = `CLUB_LEAGUES` bez `NO_SKILL_LEAGUES`.
 * Predikční pipeline (tahle) a to, co appka denně NABÍZÍ v „Zápasy"/Tipovačce
 * (`PROGRAM_CLUB_LEAGUE_IDS`, užší Top 8 + ČR), jsou **vědomě oddělené seznamy**:
 * model počítá predikce nad co nejširší množinou (víc dat = víc hodnoty pro záložku
 * Predikce/Tipy), ale denní seznam zápasů zůstává komorní jen na ligy, které uživatel
 * chce vidět každý den. Záložka Výsledky (v Zápasech) proto navíc filtruje settlnuté
 * predikce zpět na `isProgramClubLeague` – jinak by tam vlivem širšího `PREDICTION_
 * LEAGUES` prosakovaly i ligy, které Program vůbec nenabízí (viz `repository.ts`).
 */
export const PREDICTION_LEAGUES = CLUB_LEAGUES.map((l) => l.id).filter(
  (id) => !NO_SKILL_LEAGUES.includes(id)
);

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
 * pro EV smysl (trh se hýbe); 72 h je kompromis „už actionable, pořád ne moc brzy".
 */
export const ODDS_LOOKAHEAD_HOURS = 72;

/**
 * Druhý snímek kurzu = **zavírací linie** (nejpřesnější odhad, jaký trh vydá).
 *
 * Proč dva snímky: s jedním se nedá rozlišit „model měl pravdu" od „chytili jsme starší
 * linii, než se trh pohnul". Rozdíl mezi naším snímkem a zavíracím je **CLV** – jediný
 * ukazatel hrany, který je vidět **hned po výkopu**, ne až po stovkách výsledků.
 * Prostor tam je: mezi otevřením a zavřením se linie hne v průměru o 9.7 % a u 52 %
 * zápasů o víc než 8 %.
 *
 * Cena: +1 volání na zápas (~30–50/den = pod 1 % denní kvóty).
 *
 * **Snímky NEBERE denní predikční cron, ale vlastní `/api/cron/snapshot-odds`, který
 * jede HODINOVĚ** – a je to nutnost, ne kosmetika. S jedním během v 04:30 UTC by
 * zavírací snímek dostaly jen zápasy s výkopem dopoledne; večerní zápas ve 21:45 SELČ
 * by další běh zastihl až po výkopu.
 *
 * **3 h, ne 12 (změněno 28. 7. 2026).** `fixturesNeedingOdds` bere **první** běh uvnitř
 * okna, takže při dvanáctihodinovém okně a cronu po 3 h padl „zavírací" snímek
 * **9–12 h před výkopem** – u večerního zápasu odpoledne předchozího dne. CLV pak měřilo
 * pohyb z T−72 h na T−10 h a **celý poslední den, kde je pohyb nejostřejší, chybělo**.
 * Se třemi hodinami a hodinovým cronem padne snímek kolem **T−3 h** a zbývají ještě dva
 * pokusy, kdyby běh vypadl (`schedule` v GitHub Actions je best-effort).
 *
 * **Kvótu to nezdraží ani o jedno volání**: guard `oddsFetchedAt`/`oddsCloseAt` drží dva
 * snímky na zápas za život bez ohledu na to, jak často se běží – mění se jen *kdy* se
 * ten druhý vezme. Kratší okno **nejde** kompenzovat řidším během; obojí musí sedět
 * dohromady, jinak zápasy zavírací snímek nedostanou vůbec.
 */
export const ODDS_CLOSING_HOURS = 3;

/**
 * Kolik času smí jeden běh spotřebovat, než skončí čistě. Musí být **pod** `maxDuration`
 * routy – doběhnutí vlastní silou vrátí statistiku a nechá cache teplou pro příští běh,
 * kdežto zabití platformou zahodí i informaci, kam se pipeline dostala.
 *
 * **50 s, protože Vercel Hobby stropuje funkce na 60 s.** Dřív tu byly 4 minuty pod
 * `maxDuration = 300` – jenže tu hodnotu Hobby plán nectí, takže rozpočet **nikdy
 * nedoběhl** a běh vždycky zabila platforma. Přesně ten stav popisuje poznámka z 26. 7.
 * („běh v 04:30 byl zabit v 04:31:03"); zvýšení `maxDuration` ho neopravilo, jen skrylo.
 * Rotace soutěží je proto na Hobby o to důležitější: jeden běh pokryje jen část seznamu
 * a zbytek se dostane na řadu další dny.
 */
const DEFAULT_BUDGET_MS = 50_000;

export interface PredictUpcomingResult {
  leagues: number;
  /** Kolik soutěží se skutečně stihlo projít (< `leagues` = došel rozpočet). */
  covered: number;
  fixtures: number;
  predicted: number;
  /** Běh skončil kvůli časovému rozpočtu, ne proto, že by došly ligy. */
  stopped: boolean;
  /**
   * Kolik soutěží / zápasů běh přeskočil kvůli chybě (ne kvůli rozpočtu).
   *
   * Stejný důvod jako `errors` u `runSnapshotOdds`: běh, který hlásí `predicted: 0` a
   * `errors: 0` (mimo sezónu, nic k predikci), musí jít poznat od běhu, který hlásí
   * `errors: 24` (vypršel API klíč). Bez toho vypadají oba v logu identicky.
   */
  errors: number;
}

/**
 * Spočítá a uloží predikce nadcházejících zápasů. `leagueIds` umožní ruční/dávkový
 * běh jedné soutěže (mimo sezónu vrací prázdno). Idempotentní (upsert). Klubové ligy
 * staví týmy přes konfederačně-nezávislý `getCompareTeam`; reprezentační turnaje
 * (MS) staví týmy s meta z fixture (tým z libovolné konfederace).
 *
 * **Pořadí soutěží se každý den pootočí** (`rotateLeagues`) a běh má **časový rozpočet**.
 * Studená liga stojí desítky volání API, takže při 18 klubových + 8 reprezentačních
 * soutěžích se do jednoho běhu nemusí vejít všechno; bez rotace by konec seznamu nedostal
 * predikci nikdy. Ruční běh s explicitním `leagueIds` (`?league=ID`) se **nerotuje** –
 * tam si pořadí volí volající.
 */
export async function runPredictUpcoming(
  leagueIds?: number[],
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<PredictUpcomingResult> {
  const queue =
    leagueIds ?? rotateLeagues(ALL_PREDICTION_LEAGUES, dayOfYear());
  const deadline = Date.now() + budgetMs;
  let fixtures = 0;
  let predicted = 0;
  let covered = 0;
  let stopped = false;
  let errors = 0;
  for (const leagueId of queue) {
    if (Date.now() >= deadline) {
      stopped = true;
      break;
    }
    covered++;
    let upcoming;
    try {
      upcoming = await fetchLeagueUpcomingFixtures(leagueId, UPCOMING_PER_LEAGUE);
    } catch (e) {
      errors++;
      logError("predictions.runPredictUpcoming.league", e, { leagueId });
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
    // Síly s korekcí na soupeře (C2): klub → ratingy jeho ligy (z cachovaných zápasů, 0 API);
    // reprezentace → **globální pool všech národů** (srovnatelný napříč konfederacemi).
    const ratings = national
      ? await getNationalRatings()
      : await getLeagueRatings(leagueId);
    // Turnaje se hrají na neutrální půdě (Liga národů a kvalifikace ne).
    const neutral = isNeutralNationalLeague(leagueId);
    const buildSide = (t: { id: number; name: string; logo: string }) => {
      // Meta z fixture i pro kluby: seznam týmů nové sezóny nemusí být publikovaný
      // a nováček v něm chybí i pak – bez toho by se celý zápas tiše přeskočil.
      if (!national)
        return getCompareTeam(t.id, leagueId, false, {
          name: t.name,
          logoUrl: t.logo,
          country: "",
        });
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
        // Ratingy jen když je má liga pro OBA týmy (nováček bez historie → okenní model).
        const rh = ratings?.get(f.teams.home.id);
        const ra = ratings?.get(f.teams.away.id);
        const result = compareTeams(home, away, new Date(), {
          baseline,
          strength: rh && ra ? { home: rh, away: ra } : undefined,
          neutral,
        });
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
          } catch (e) {
            // Benchmark je best-effort a jeho výpadek NESMÍ shodit náš řádek – ale
            // „best-effort" znamená nezastavit běh, ne mlčet (viz rok bez kurzů).
            // Do `errors` se nepočítá: náš vlastní řádek se uložil v pořádku.
            logError("predictions.benchmark", e, { fixtureId: f.fixture.id });
          }

          // Kurzy se tady ZÁMĚRNĚ neberou – vlastníkem obou snímků je
          // `runSnapshotOdds` (`/api/cron/snapshot-odds`, hodinově). Denní běh by
          // zavírací linii u večerních zápasů nikdy nestihl (viz `ODDS_CLOSING_HOURS`)
          // a dva vlastníci téhož zápisu jsou zbytečná past.
        }
      } catch (e) {
        errors++;
        logError("predictions.runPredictUpcoming.fixture", e, {
          leagueId,
          fixtureId: f.fixture.id,
        });
        // přeskoč problémový zápas, pokračuj dál
      }
      // Rozpočet se kontroluje i uvnitř ligy: jedna studená liga umí sama sníst celý běh.
      if (Date.now() >= deadline) {
        stopped = true;
        break;
      }
    }
  }
  return { leagues: queue.length, covered, fixtures, predicted, stopped, errors };
}

/**
 * Kolik zápasů smí jeden běh snímků obsloužit (strop volání API na běh).
 *
 * 40 kvůli 60s stropu Hobby plánu: volání jdou sekvenčně přes rate limiter (~0.5 s
 * na zápas), takže 40 se pohodlně vejde. Zbytek dobere další běh – fronta se nikam
 * neztratí, `fixturesNeedingOdds` ji spočítá znovu.
 */
/**
 * Kolik zápasů se v jednom běhu vůbec **zváží** (ne kolik se jich stáhne).
 *
 * Od zavedení časové řady filtruje limit **kandidáty**, ne potřeby: většina zápasů
 * v okně nepotřebuje nic a `snapshotPlan` je zahodí bez volání API. Zvýšení je proto
 * skoro zadarmo (pár desítek malých řádků ze selectu) a chrání před tím, aby při
 * nabitém víkendu zůstal konec seznamu bez prvního snímku. Reálně je „due" ~16/hod.
 */
const SNAPSHOT_LIMIT = 120;

/**
 * **Snímky kurzů** – otevírací, zavírací a body **časové řady** pro zápasy v okně.
 *
 * Všechny tři účely obsluhuje **jeden fetch**: `/odds` vrací všechno naráz, takže když
 * zápas potřebuje třeba jen bod řady, stojí to stejně jedno volání – a když zrovna padne
 * i zavírací okno, uloží se z téže odpovědi obojí. Co se má stát, rozhoduje čistá
 * `snapshotPlan` (`lib/picks/oddsSeries.ts`), takže je to testovatelné bez DB.
 *
 * Proč vlastní cron a ne součást `runPredictUpcoming`: predikční cron běží 1×/den ve
 * 04:30 UTC, takže by zavírací snímek dostaly **jen zápasy s výkopem mezi
 * 04:30 a 16:30 UTC** – večerní zápasy, tedy většina, nikdy. CLV by pak stálo na
 * vychýlené menšině. Tenhle běh je proti tomu levný (jen `/odds`, žádné `compareTeams`)
 * a jezdí **hodinově**.
 *
 * Kvótu to nezdraží: `fixturesNeedingOdds` čte jen DB a každý zápas dostane nejvýš dva
 * snímky za život (guard `oddsFetchedAt`/`oddsCloseAt`). Častější běh mění jen *kdy*
 * se ta dvě volání provedou, ne kolik jich je. Hodinový běh navíc znamená **méně
 * zápasů na jeden běh**, takže je dál od `SNAPSHOT_LIMIT` i od časového rozpočtu.
 *
 * **Chyby se počítají a vracejí, nepolykají se.** Fetch kurzů je best-effort a přesně
 * proto rok tiše nefungoval (zod schéma padalo na numerickém `value` a nikdo se to
 * nedozvěděl) – běh, který hlásí `errors: 0` a `saved: 0`, musí jít poznat od běhu,
 * který hlásí `errors: 40`.
 */
export async function runSnapshotOdds(limit = SNAPSHOT_LIMIT): Promise<{
  due: number;
  open: number;
  close: number;
  /** Kolik zápasů dostalo nový bod časové řady. */
  series: number;
  empty: number;
  errors: number;
}> {
  const now = new Date();
  const candidates = await fixturesNeedingOdds({
    // Jen klubové ligy: reprezentace kurzy prakticky nemají a napříč konfederacemi
    // by stejně nebyly srovnatelné (týž důvod jako u benchmarku).
    leagueIds: PREDICTION_LEAGUES,
    now,
    lookaheadHours: ODDS_LOOKAHEAD_HOURS,
    limit,
  });

  let open = 0;
  let close = 0;
  let series = 0;
  let empty = 0;
  let errors = 0;
  let due = 0;

  for (const item of candidates) {
    // Čisté rozhodnutí: co se má z tohohle zápasu udělat. Zápas, který nepotřebuje nic,
    // se kvóty ani nedotkne.
    const plan = snapshotPlan(item, now, ODDS_CLOSING_HOURS);
    if (!plan.fetch) continue;
    due++;
    try {
      // JEDEN fetch pro všechny tři účely – `/odds` vrací všechno naráz, takže
      // otevírací snímek, zavírací snímek i bod řady stojí dohromady jedno volání.
      const odds = await fetchOdds(item.fixtureId);
      if (!odds) {
        // API pro zápas kurzy nemá (běžné daleko před výkopem i u menších lig).
        empty++;
        continue;
      }
      if (plan.open) {
        await saveOdds(item.fixtureId, odds);
        open++;
      }
      if (plan.close) {
        await saveClosingOdds(item.fixtureId, odds);
        close++;
      }
      if (plan.series) {
        const minutesToKickoff = (item.kickoff.getTime() - now.getTime()) / 60_000;
        const point = seriesPointFrom(odds.books ?? [], minutesToKickoff);
        if (point) {
          await saveOddsSeries(
            item.fixtureId,
            appendPoint(parseSeries(item.oddsSeries), point),
            now
          );
          series++;
        }
      }
    } catch (e) {
      errors++;
      logError("snapshot-odds", e, { fixtureId: item.fixtureId, plan });
    }
  }
  return { due, open, close, series, empty, errors };
}

/** Dotáhne výsledky u predikcí, jejichž zápas už proběhl (batch po 20 ID). */
export async function runSettleResults(): Promise<{
  pending: number;
  settled: number;
  /** Kolik dávek po 20 se nepodařilo stáhnout (viz `errors` u ostatních běhů). */
  errors: number;
}> {
  const pending = await getUnsettledPredictions();
  let settled = 0;
  let errors = 0;
  for (let i = 0; i < pending.length; i += 20) {
    const chunk = pending.slice(i, i + 20);
    let fixtures;
    try {
      fixtures = await fetchFixturesByIds(chunk.map((p) => p.fixtureId));
    } catch (e) {
      errors++;
      // Nesettlnutá predikce zůstane ve frontě a příští běh ji zkusí znovu – ale když
      // selhává trvale, dataset tiše přestane růst a track-record zamrzne.
      logError("predictions.runSettleResults", e, { batch: i / 20 });
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
  return { pending: pending.length, settled, errors };
}
