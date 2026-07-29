# Predikční záložka, pipeline, backtest, verzování a kalibrace

## Predikční záložka (PRO) + dataset predikce-vs-skutečnost
- **Princip:** predikce nadcházejících zápasů se počítají **jen na pozadí (cron), dávkově**
  a ukládají do tabulky `FixturePrediction` (predikce + po odehrání výsledek). Záložka
  `/predikce` i track-record **jen ČTOU z DB** – nikdy se nepočítá živě per request
  (1 zápas ≈ 26–35 API volání → drahé). Studené naplnění dělej lokálně / `?league=ID`.
- **Pipeline** (`lib/data/predictions.ts`, real data): `runPredictUpcoming`
  (`ALL_PREDICTION_LEAGUES` = 16 klubových lig `PREDICTION_LEAGUES` + reprezentační
  soutěže z `catalog.ts`: finálové turnaje `NATIONAL_TOURNAMENT_LEAGUE_IDS` (MS=1, EURO=4,
  Copa América=9, AFCON=6, Asian Cup=7, Gold Cup=22) stavěné **venue-neutrálně**, a soutěže
  s reálným domácí/venku `NATIONAL_HOME_AWAY_LEAGUE_IDS` (UEFA NL=5, CONCACAF NL=536)
  stavěné s **HOME/AWAY splitem** → predikce u nich zachytí domácí výhodu)
  → `fetchLeagueUpcomingFixtures` + ×2 build týmů + `compareTeams` → `upsertPrediction`
  (`predictionStore.ts`). Build se větví: klub → `getCompareTeam`; reprezentační turnaj →
  `getCompareNationalTeamFromFixture` (meta název/logo **z fixture**, ne z konfederace –
  tým může být z libovolné konfederace; forma z `fetchLastFixtures`, venue-neutrální).
  `runSettleResults` dotáhne skóre dle `fixtureId` (`fetchFixturesByIds`) bez ohledu na ligu;
  ukládá **skóre po 90 minutách** (`fullTimeGoals` v `fixtures.ts` → `score.fulltime`, ne
  `fixture.goals` = koncové). U vyřazovacích zápasů (`AET`/`PEN`) by koncové skóre dalo remíze
  po 90 min podobu výhry → zkazilo by 1X2, Over 2.5, BTTS i MLE `DC_RHO`. `SettledMatch` proto
  nese `afterExtraTime` a UI u skóre ukazuje „90′“. Starší řádky přepočítá `npm run resettle`.
  Crony `app/api/cron/{predict-upcoming,settle-results}` (denně, viz „Plánované úlohy",
  `CRON_SECRET`, `?league=ID` override). Mimo sezónu = prázdno (UI to zvládá).
  **Cron má časový rozpočet a rotuje pořadí soutěží** (`rotateLeagues(…, dayOfYear())`,
  `budgetMs` 4 min pod `maxDuration = 300`). Bez toho se při 16+8 soutěžích a studené cache
  stihl vždy jen **začátek** seznamu a konec nedostal predikci **nikdy** – změřeno 26. 7. 2026:
  běh v 04:30 byl zabit v 04:31:03 (`maxDuration` byla 60 s) a v DB bylo 8 lig z 18. Rotace
  z toho dělá „každý den se začne jinde", takže i zkrácený běh pokryje zbytek další dny;
  jakmile je cache teplá a běh doběhne celý, rotace nedělá nic. Ruční `?league=ID` se nerotuje.
  Reprezentační
  řádky v `PicksApp` **jsou klikací**: `/api/picks` jim dohledá konfederaci každého týmu
  (`getNationalConfedMap`) a deep-link míří do NATIONAL Porovnání (stejně jako Zápasy);
  `MatchPick` proto nese `compareMode`+`home/awayCompareLeagueId`, klikatelnost řeší
  `buildCompareHref` (tým bez dohledané konfederace → `null` = neklikací).
- **Rozsahy lig: TŘI různé seznamy, vědomě oddělené.**
  `CLUB_LEAGUES` (18, katalog – Porovnání a Tabulky) ⊃ `PREDICTION_LEAGUES`
  (16 = katalog bez `NO_SKILL_LEAGUES`, predikce/tipy) a zvlášť `PROGRAM_CLUB_LEAGUE_IDS`
  (9 = Top 8 + ČR 345 → `FIXTURE_LIST_LEAGUE_IDS` = denní Program, Výsledky, Tipovačka).
  Model počítá nad co nejširší množinou, denní seznam zůstává komorní. Důsledek, se kterým
  je třeba počítat: tip z ligy mimo devítku je v Predikci klikací do Porovnání, ale
  **v Programu ho uživatel nenajde a nejde ho tipovat**; `getRecentResults` proto filtruje
  na `isProgramClubLeague` – a **filtr musí jít do dotazu**, ne až nad `take: 40`
  (jinak ve dnech menších lig zůstane ve Výsledcích pár řádků, nebo nic).
- **Ligy bez skillu se vyřazují MĚŘENÍM, ne odhadem** (`NO_SKILL_LEAGUES` v `predictions.ts`).
  **Přidání lig nezpřesňuje jádro** – ratingy jsou ligově-lokální (normalizované na ligový
  průměr 1.0) a `LeagueBaseline` je per-liga, takže žádná cross-league chyba k opravě není
  (na rozdíl od reprezentací). Hodnota širšího seznamu je **pokrytí + živoucí dataset**, ne
  přesnost. Fitnuté konstanty se rozšířením nepohnuly (ρ −0.04→−0.045, zostření λ s=1.00 =
  „sharpen nezapínat", Platt kalibrace na hranici gridu = overfit; viz `predict.ts`).
  **Per-liga log-loss (backtest 2024+2025, 10 981 predikcí, bez xG) proti naivní konstantě:**
  Portugalsko **0.9644** (+0.117) > Řecko 0.9861 > **ČR 0.9784** (+0.089) > Itálie 1.0067 >
  Turecko 0.9820 > Španělsko 0.9950 > Německo/Francie/NL/Anglie (+0.05…+0.07) >
  Skotsko 1.0125 > Norsko 1.0171 > **Belgie 1.0510 (+0.032)** > Dánsko/Rakousko/Championship
  (+0.014…+0.018) > **Švýcarsko 1.0746 (−0.002)** a **Polsko 1.0807 (−0.011)**.
  Dvě věci proti intuici: **Belgie není nejhorší** (dřívější závěr z užšího vzorku; nadstavba
  s dělením bodů jí škodí, ale skill má) a **malá liga ≠ špatná predikce** – ČR, Řecko a
  Turecko patří ke špičce, zatímco Championship s 1 114 zápasy je u dna. xG rozdíl nedělá
  (Portugalsko bez xG poráží všechny xG ligy) → rozhoduje **struktura ligy**: čím
  polarizovanější (pár dominantních klubů), tím lépe predikovatelná.
  **Polsko (106) a Švýcarsko (207) jsou proto z `PREDICTION_LEAGUES` vyřazené** – model tam
  neporazil hádání, takže tip odtud je šum a stojí čas cronu i kvótu. Zůstávají v katalogu
  (Porovnání/Tabulky je mají). Před vyřazením/přidáním další ligy **vždy nejdřív změř**
  (`npm run backtest -- --leagues=ID`); pořadí odporuje intuici.
- **Výběr tipů** (`lib/picks/rules.ts`, čisté + testy): `evaluateRule`/`filterPicks` nad
  `PredictionRow`; pravidlo `PickRule{market: win|over25|btts, venue, minProb, minEdge?, minReadiness?}`
  (sdílené `ruleSchema`), presety `PICK_PRESETS`. **`minEdge`** (volitelný) = value režim: tip projde
  jen se známým kurzem a edge ≥ prahu (bez něj = chování jako dřív, čistě `minProb`); UI přepínač
  „Jen value tipy" v `RuleControls` posílá `minEdge=0`, `PickRow` ukazuje kurz + edge (`ValueBadge`).
  `MatchPick.value` nese `{odds, impliedProb, edge}`. **`minReadiness`** (volitelný) = readiness gate:
  skryje tipy s tenkým vzorkem (`readinessSample < práh`); UI přepínač „Skrýt málo dat" (**default ON**,
  posílá `PREDICTION_READY_SAMPLE`) gatuje **jen seznam tipů `/api/picks`**, NE backtest
  `/api/picks/stats` (ten běží nad celou historií); `ReadinessTag` na řádku. API `app/api/picks` (**nadcházející tipy = PRO** přes
  `getEntitlement`, FREE→`{locked}` → v UI `ProLock` jen místo seznamu tipů), `app/api/picks/stats`
  (**FREE** – agregátní/historické metriky nic konkrétního neprozrazují; `lib/picks/trackRecord.ts`:
  `computeTrackRecord` = globální track-record + `computeBenchmarkTrackRecord` = side-by-side
  náš model vs. API-Football na společné podmnožině (viz benchmark níže) + `backtestRule` =
  backtest navoleného pravidla nad historií = úspěšnost „kdybys takhle sázel" +
  **`computeReliability`** (`lib/picks/reliability.ts`) = kalibrační křivka: predikce rozbinované
  dle pravděpodobnosti vs. skutečnost per trh (1X2 pooled one-vs-rest = 3 body/zápas, Over 2.5,
  BTTS) + ECE (Expected Calibration Error, nižší = lepší). UI `PicksApp.tsx`
  (panely `TrackRecordPanel` / `BenchmarkPanel` / `ReliabilityPanel` / `StrategyPanel` + `RuleControls`
  se renderují **vždy = FREE**; zamčený `ProLock` je jen na místě seznamu konkrétních nadcházejících tipů).
- **Týdenní digest value tipů** (`lib/picks/digest.ts`, `buildDigest`, čisté + testy): top value
  tipy nejbližších 7 dní = per zápas **nejvyšší edge napříč trhy** (home/away výhra, Over 2.5, BTTS),
  jen kladná hrana, seřazeno sestupně, top 5. Sdílí `buildPick` (`rules.ts`) s `filterPicks` (jeden
  zdroj deep-linku/value/vysvětlení) a `PickRow` (`app/_components/PickRow.tsx`, vytknuto z `PicksApp`)
  s tipovací záložkou. **0 API** (čte uložené řádky vč. kurzů). Route `app/api/digest` (**PRO** jako
  picks, FREE→`{locked}`), stránka `/digest` + `DigestApp.tsx`. Owner (always-PRO) má osobní přehled,
  zároveň screenshot do komunit (marketing). Záměrně **mimo sitemap** (PRO-locked = tenká stránka pro indexaci).
- **Offline backtest** (`lib/picks/backtest.ts` + `npm run backtest`, čisté + testy): přehraje
  historii klubových lig **stejným jádrem** (`compareTeams`) a vydá `PredictionRow[]` → jde rovnou
  do `computeTrackRecord`/`computeReliability`/`fit.ts`. **Point-in-time** (`matchStatsBefore` bere
  jen zápasy s datem < výkop → žádný leak, kryto testem). Data: `fetchLeagueSeasonFixtures` =
  **1 volání na ligu+sezónu** (5 lig × 3 sezóny = 15 volání, ~5 300 zápasů) + disková cache
  `.cache/backtest` → iterace nad modelem běží **offline za ~8 s**. Model se tak ladí na tisících
  zápasů, ne rychlostí, jakou se plní DB. **Omezení:** bez xG (to je 1 volání/zápas → produkční λ
  má navíc xG složku) a bez pohárů. Fit ρ/zostření je sdílený (`lib/picks/fit.ts`) s `calibrate`.
- **Dvě úrovně verzování (DŮLEŽITÉ):** `MODEL_VERSION` (`predictions.ts`) verzuje **jen to, co
  generuje λ** (okna, váhy, xG zpevnění, build týmů) – bump **vynuluje dataset** (kalibrace
  i track-record běží per verzi). **ρ a zostření λ pod něj nepatří**: jsou to post-parametry
  aplikované až NA λ (`PREDICT_PARAMS` v `predict.ts`), takže po jejich změně stačí přepočítat
  mřížku nad uloženými λ – čistá matematika, **0 API volání**, historie zůstane (`npm run reprice`).
  Proto `FixturePrediction.lambdaHome/Away` drží **základní** λ (před zostřením; `MatchPrediction`
  má `lambdaHomeBase`/`lambdaAwayBase`) a řádek nese `rho`/`sharpen` = čím byly pravděpodobnosti
  odvozené → `reprice` pozná zastaralý řádek. Mřížku staví jediná čistá funkce `gridProbs`
  (sdílí ji živý `predictMatch` i `reprice`) → nemůžou se rozejít.
- **Kalibrace:** `npm run calibrate` (`scripts/calibrate.ts`) = MLE `DC_RHO` z odehraných
  predikcí (reuse exportů `drawTau`/`poissonVector`) + Brier/log-loss. Ladění = ruční
  úprava `DC_RHO` v `predict.ts` + **`npm run reprice`** (žádný bump `MODEL_VERSION`!).
  Počítá **jen z `modelVersion=MODEL_VERSION`** a chce **≥30 odehraných**
  predikcí, jinak je výsledek orientační. `DC_RHO = −0.03` je **fitnuté backtestem**
  (3 511 klubových zápasů; publikovaný default −0.13 z DC 1997 seděl na jiná λ, na hold-out
  sezóně byl o chlup horší). Ladit dál přes `backtest`, ne přes 60 zápasů z DB.
  **Zostření favoritů** (`LAMBDA_SHARPEN` v `predict.ts`, `sharpenLambdas`): zostří **jen rozdíl**
  λ (D = λ_home−λ_away) se zachováním součtu. `LAMBDA_SHARPEN=1.0` = **přesný no-op**.
  **NEZAPÍNAT — backtest (3 511 klubových zápasů) ukázal PŘESNÝ OPAK toho, co naznačovalo
  62 zápasů z MS:** model je na favoritech **přesebevědomý** (predikce 64 % → realita 57 %;
  83 % → 67 %) a na outsiderech podsebevědomý (7 % → 14 %). `fitSharpen` nad backtestem dává
  **s = 1.00 (žádné zlepšení)**. Zostření by model zhoršilo. Příčina není komprese λ, ale **šum**:
  55 % váhy nese LAST5 (pět zápasů!) → λ přestřeluje na krátkodobé sérii a extrémní
  pravděpodobnosti neustojí. Léčba je **shrinkage/regularizace λ**, ne zostření (viz plán C1/C2).
- **Kalibrace 1X2 (Platt scaling, `CALIB_A`/`CALIB_B` v `predict.ts`, `calibrateOutcome`) –
  PŘIPRAVENO, ZATÍM NEFITNUTO:** `LAMBDA_SHARPEN` škáluje jen rozdíl λ jedním číslem a na
  backtestu nepomohlo, protože chyba je **nesouměrná** (přesebevědomí na favoritech A
  podsebevědomí na outsiderech zároveň) – jeden multiplikátor nemůže narovnat oba konce.
  Platt scaling na logitu (`p' = σ(a·logit(p)+b)`) to umí: `a<1` stlačí favority i outsidery
  k 1/3 najednou. Aplikuje se AŽ na hotové V/R/P z mřížky (po ρ+zostření), Over 2.5/BTTS/
  topScores nedotčené. Stejný cyklus jako ρ/zostření: post-parametr nad λ (`FixturePrediction.
  calibA/calibB`, **ne** pod `MODEL_VERSION`), `npm run reprice` ho umí dorovnat na historii
  bez API volání. Fit `fitCalibration`/`outcomeScoreAtCalibration` (`lib/picks/fit.ts`, grid
  search `a∈[0.4,1.6]`/`b∈[-0.3,0.3]`) sdílený mezi `calibrate.ts` (živá DB) a `backtest.ts`
  (offline historie) – stejná zásada jako u zostření: fituj na tisících zápasů z backtestu,
  ne na desítkách z DB. **`CALIB_A=1.0`/`CALIB_B=0.0` je zatím přesný no-op** (default) –
  čeká na `npm run backtest` (potřebuje `.cache/backtest`, tj. API klíč pro první stažení
  historie) a ověření, že grid search nekončí na hranici (overfit).
- **Interní benchmark vs. API-Football** (jen offline měření, **nikdy ve FREE/PRO API**,
  **nesahá na `compareTeams`**): paralelní sloupce `bench*` na řádku `FixturePrediction`
  (predikce API-Footballu 1X2). `fetchPrediction` (`apiFootball.ts`) parsne `percent`
  (`"45%"`→0.45) a normalizuje na součet 1; `runPredictUpcoming` ji po uložení naší predikce
  dotáhne **jen pro klubové ligy** (`!national`) a **1×/zápas** (`hasBenchmark` guard →
  srovnatelný okamžik + nízké náklady), výpadek nezastaví náš řádek. `saveBenchmark`
  (`predictionStore.ts`) má vlastní cyklus (mimo `upsertPrediction`/`PredictionUpsert`).
  Výsledek doplní `settle-results` (společný). Skórování oboumodelů na **stejné podmnožině**
  (`benchAvailable && available`) je sdílené: `scoreProbs`/`ourProbs`/`benchProbs` v
  `lib/picks/trackRecord.ts` (jeden zdroj pravdy) používá jak `calibrate` (CLI Brier/log-loss),
  tak `computeBenchmarkTrackRecord` (API `picks/stats` → `BenchmarkPanel` v `PicksApp`,
  verdikt dle log-loss, `n<30` orientační). Rozsah jen **1X2** (Over 2.5/BTTS dává API jen
  volným textem → vynecháno).
- **Mock režim:** `lib/data/mock/predictions.ts` (generátor) → záložka funguje i bez DB/API.
  Odehrané mock řádky nesou i syntetický benchmark (naše predikce regresovaná k 1/3) →
  `BenchmarkPanel` se vykreslí i v mocku.
- Vědomá výjimka ze scope „jen statistiky" (nové tabulky/modul). H2H se NEdělá.

