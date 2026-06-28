# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Predictapp — statistické porovnání fotbalových týmů

Web (Next.js) pro porovnání klubů a reprezentací. Pro každý tým počítá **vážený
průměr** metrik ve variantách **Doma / Venku / Celkově** ze tří oken
(váhy 15 / 30 / 55 %) + automatické **insights**.
Data: API-Football (api-sports.io) přes read-through cache do Postgresu (Neon).
Metriky: góly vstřelené/obdržené, xG, střely (celkem / na branku / mimo / zblokované /
z vápna / mimo vápno), držení míče, přihrávky + přesnost, rohy, ofsajdy, fauly,
žluté/červené karty, zákroky brankáře (`ALL_METRICS` v `lib/types.ts`).

## Příkazy
```bash
npm run dev          # vývoj (http://localhost:3000)
npm run build        # produkční build
npm test             # Vitest – unit testy výpočetního jádra (jen lib/**/*.test.ts)
npx vitest run lib/stats/predict.test.ts   # jeden soubor
npx vitest run -t "název testu"            # jeden test dle názvu (substring)
npx vitest                                 # watch režim
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npx prisma db push   # promítnout změnu schématu do Neonu (+ regeneruje klienta)
npm run probe        # živá sonda API (status, kvóta, tvary odpovědí); též: discover, limits
```
**Pozn. (tento Windows stroj):** odchozí TLS na api-sports i `npm`/`prisma generate`
vyžaduje `NODE_OPTIONS=--use-system-ca` (firemní/AV TLS proxy). Na Vercelu netřeba.
Prisma `generate` občas selže na EPERM (zamčená DLL) – zabít běžící `next` server.
Sondy (`probe`/`discover`/`limits`) běží přes `tsx` (raw `node` neumí extensionless
importy). `esbuild` je v `package.json` připnutý na 0.25.12 (`overrides`) – stroj
neumí stáhnout novější binárku přes TLS proxy, novější verze TS toolchainu padá.

## Architektura
- **Katalog** (ligy, konfederace, seznamy týmů) – dynamicky z API, **cache** (`ApiCache`).
  Klubové ligy a konfederace jsou kurátorovaný seznam ID v `lib/data/catalog.ts`
  (~18 lig + 6 konfederací = WC-kvalifikace; reprezentace se táhnou z nich).
  Pořadatelé MS (autom. kvalifikace → nejsou v seznamu kvalifikace, např. USA/Kanada/
  Mexiko pro 2026) se doplňují ručně přes `Confederation.extraTeams`.
- **Zápasová data** (per-zápas statistiky) – stahují se **líně jen pro porovnané týmy**
  a cachují **natrvalo** (`MatchStatCache`). Žádný hromadný download.
- **Výpočetní jádro** `lib/stats/` je čistě funkční a **na zdroji nezávislé** – mock
  i reálná data tečou stejnou cestou (`compareTeams`).
- **Souhrn formy** (`lib/stats/summary.ts`, `TeamComparison.summary`) stojí **mimo** vážený
  průměr: forma = posl. 5 zápasů jako W/D/L, **čisté konto %** a **bez gólu %** = podíl
  z posl. 10 zápasů (jeden jasný jmenovatel `sampleSize`, ne vážený mix oken). Sleduje
  přepínač Doma/Venku/Celkově (sdílí `matchesVenue`). Vše odvozené z `GOALS_FOR/AGAINST`
  → žádný nový fetch, žádný bump cache verze. UI: `FormSummary.tsx` nad metrikami.
- **Zranění** (`getInjuries` v `repository.ts`, endpoint `/api/injuries`, UI `InjuryList.tsx`)
  – **líně** načítaná samostatná sekce, ne ze zápasových statistik. `/injuries` přes TTL
  `ApiCache` (6 h), dedup dle hráče. Pokrytí v API je nekonzistentní → **graceful**:
  prázdný/nedostupný seznam = sekce se nevykreslí. Mimo `compareTeams` (ta zůstává čistá).
- **Predikce** (`lib/stats/predict.ts`, `CompareResult.prediction`) – **Poisson** z očekávaných
  gólů (útok týmu × obrana soupeře, venue-specific, fallback TOTAL, volitelné zpevnění xG)
  s **Dixon–Coles korekcí** nízkých skóre (`DC_RHO`, `drawTau`; ρ<0 zvyšuje remízy 0:0/1:1).
  V/R/P, BTTS, Over 2.5 i **top-N nejpravděpodobnějších přesných skóre** (`topScores`) se
  počítají z téže opravené mřížky → vzájemně konzistentní (`topScores` je UI-only obohacení
  z živé mřížky, **neukládá se** do `PredictionRow`/`FixturePrediction`). Chybí-li gólová i xG
  data, vrací `available:false` (UI zobrazí „nedostatek dat", ne falešnou 50/50). UI `MatchPrediction.tsx`.
- **Insights = rule-engine** (`lib/insights/`): `engine.ts` spustí registry pravidel
  (`rules/team.ts` per-tým napříč metrikami, `rules/form.ts` série/PPG z `lib/stats/streaks.ts`,
  `rules/matchup.ts` syntéza obou týmů + vysvětlení predikce, `rules/verdict.ts` verdikt).
  Každé pravidlo vrací `Candidate{strength}`; engine skóruje (`strength × váha kategorie ×
  confidence`), **řadí a vybere top N** klíčových signálů (`InsightReport`). Čistá funkce
  nad výstupem `compareTeams` – žádná nová data. UI: `MatchVerdict`/`KeySignals`/`InsightChips`.
  Prahy/váhy laditelné na jednom místě; nové pravidlo = jedna položka v registru + test.
  **Perspektivní venue** (`TeamContext.venue`, `context.ts`): pravidla i predikce čtou
  hodnoty z varianty relevantní pro zápas – **klub domácí → HOME, host → AWAY, reprezentace
  → TOTAL** (sdílené gettery `mv`/`lc`/`perspectiveSummary`/`perspectiveMatches`).
- **`lib/data/repository.ts`** přepíná real/mock podle env (`isRealDataConfigured`).
  Reálné: `realRepository.ts`; mock: `mock/seed.ts` + `generate.ts`.

## Záložka Zápasy (domovská obrazovka `/` = rychlý vstup k predikci)
- **Princip:** úvodní obrazovka `/` má **přepínač Program / Výsledky** (`ZapasyApp`,
  lokální `view` state nad už načtenými daty – obojí přijde ze serveru, žádný další fetch):
  - **Program** = seznam **nadcházejících zápasů (dnes + dalších 6 dní, `LOOKAHEAD_DAYS=7`
    v `app/page.tsx`) seskupený podle ligy**; klik na zápas otevře **Porovnání s předvyplněnými
    týmy**, které se samo přepočítá včetně predikce → **žádné ruční vybírání týmů**.
  - **Výsledky** = jak dopadly **naše nedávné predikce** (skóre + ✓/✗ zda 1X2 trefilo) – viz níže.
  Porovnání se proto přesunulo z `/` na **`/porovnani`** (`app/porovnani/page.tsx`).
- **Seznam je jen navigace – nic se nepočítá živě tady.** Predikce vzniká až klikem přes
  existující deep-link do `CompareApp` (auto-`runCompare`) → **žádný nový výpočetní kód**,
  `compareTeams` ani gating (`toFreeResult`) se nemění (predikce zůstává PRO jako dnes). Stejný
  deep-link staví i `PicksApp` (`PickRow`) a Výsledky (`ResultRow`) – sdílený stavitel
  **`buildCompareHref`** (`app/_components/compareHref.ts`, vrací `string|null` = klikací jen
  když známe „ligu" obou stran; jeden zdroj pravdy pro všechny tři řádky).
- **Data (Program):** `fetchFixturesByDate(date)` (`apiFootball.ts`) = **1 volání `/fixtures?date=`
  na den** (timezone `Europe/Prague`) → levné. `getFixturesByDates(dates)`
  (`realRepository.ts`, TTL `ApiCache` 1 h, paralelně, výpadek dne nezhasne ostatní) profiltruje přes
  **`FIXTURE_LIST_LEAGUE_IDS`** (`catalog.ts` = 18 klubových lig + reprezentace), vyřadí
  dohrané (`FINISHED_STATUSES`) a normalizuje čistou **`normalizeUpcomingFixtures`**
  (`lib/data/fixtures.ts`, testy `fixtures.test.ts`) na `UpcomingFixture`. Mock:
  `lib/data/mock/fixtures.ts` (funguje bez DB/API).
- **Data (Výsledky):** `getRecentResults()` (`repository.ts`) = posledních ~14 dní settlnutých
  predikcí (`getRecentSettledPredictions` z `predictionStore`, jen čte DB) → čistý mapper
  **`summarizeSettled`** (`lib/picks/results.ts`, testy `results.test.ts`) na `SettledMatch`
  (skóre + predikovaná strana 1X2 + `outcomeHit`, sdílí `argmaxOutcome`/`actualOutcome` s
  `trackRecord.ts`). **FREE** (jen historie, žádný budoucí tip). Reprezentačním řádkům dohledá
  konfederace (`getNationalConfedMap`). Mock: `mockSettledPredictions` → funguje bez DB/API.
- **Deep-link target (klub i reprezentace):** `compareMode` + `home/awayCompareLeagueId`
  (na `UpcomingFixture`, `MatchPick` i `SettledMatch`). Klub → CLUB mód, „liga" = `leagueId`
  u obou. Reprezentace → **NATIONAL mód, kde „ligou" každého týmu je jeho konfederace** – tu
  dotáhne reverzní mapa `teamId→konfederace` z cachovaných reprezentačních seznamů
  (`buildNationalConfedMap`, exportovaná jako `getNationalConfedMap`; lazy jen když jsou v rozpisu
  reprezentační zápasy). Cross-konfederační zápas (MS: Portugalsko UEFA vs Uzbekistán AFC) →
  `homeLeague=<konfA>&awayLeague=<konfB>`. Tím klik **znovupoužije existující
  `/api/compare`+`CompareApp`+gating beze změny** (`getCompareTeam`→`buildNationalTeam` přes
  konfederaci = venue-neutrální, shodné s predikční pipeline). Když se konfederace nedohledá
  (`null`), řádek je neklikací.
- **UI `ZapasyApp.tsx`** (client, mobile-first): přepínač Program/Výsledky; v Programu
  **horizontálně scrollovatelný pásek dní** (Dnes/Zítra/„So 28. 6.", víkendy zvýrazněné),
  v rámci dne **skupiny podle ligy**; ve Výsledcích plochý seznam nejnovější první + souhrn
  „trefeno X z Y". Řádky klikací dle `buildCompareHref` (klub vždy; reprezentace po dohledání konfederací).
- **Zpětná kompatibilita:** starý sdílený odkaz `/?home=&away=` v `app/page.tsx`
  **přesměruje** na `/porovnani?…` (zachová sdílení i OG kartu). Nav „Zápasy" (📅) + přesměrování
  „Porovnání" na `/porovnani` je napříč `CompareApp`/`PicksApp`/`TransfersApp`.

## Datový model / okna (DŮLEŽITÉ)
- `MatchStat` nese `season` (ligová sezóna) + odvozené `isBaseline` (dopočítá se při
  sestavení v `realRepository`, neukládá se → odolné vůči přechodu sezón).
- Klubová okna (`lib/stats/windows.ts`):
  - **SEASON** („minulá sezóna", 15 %) = nejnovější **dokončená** sezóna (`isBaseline`).
    Baseline se určuje dynamicky: je-li aktuální sezóna v podstatě dohraná
    (≥ `SEASON_COMPLETE_MIN`), je baseline ona (mezisezóna) → naplní se i nováčkům.
  - **LAST10 / LAST5** (30 / 55 %) = nejnovějších 10 / 5 zápasů dle data (napříč sezónami).
- Reprezentace = časová okna BASE (12–24 m) / LAST12 / LAST6; soutěžní zápasy
  mají vyšší váhu než přáteláky. Mají **užší sadu metrik** (`METRICS_BY_ENTITY` –
  bez xG, držení, přihrávek, zákroků… které u nich v API/mocku chybí).
  Reprezentační zápasy jsou **venue-neutrální** (`isNeutral: true` v `realRepository`
  i mocku) → doma/venku se nedělí (hrají na neutrální půdě a API to nehlásí spolehlivě),
  vše jde do TOTAL; UI v režimu Reprezentace přepínač Doma/Venku skrývá.
- Vážený průměr re-normalizuje váhy, když okno chybí (`weightedAverage.ts`).
- Metriky z `/fixtures/statistics` mapuje `STAT_TYPE_MAP` (`apiFootball.ts`);
  hodnoty čistí `parseStatValue` (ošetří „65 %"/null/„N/A"). `LOWER_IS_BETTER`
  (`types.ts`) značí metriky, kde je nižší hodnota lepší (obdržené góly, karty…).

## Rate-limiting / výkon
- api-sports limit 300/min, ale edge nás reálně stropuje ~5 úspěšných volání/s a občas
  odmítá i pod limitem (distribuované nody). `lib/data/rateLimiter.ts` = semafor
  souběžnosti 3 + klouzavý minutový strop; `apiGet` retry s krátkým backoffem.
- Cold porovnání ~8 s (mezisezóna nestahuje předchozí sezónu), warm ~0.15 s.
- **Předehřívání:** `GET /api/warm` (katalog, lehké, denní cron ve `vercel.json`);
  `GET /api/warm?league=ID` předehřeje zápasová data ligy (těžké, na vyžádání).

## Účty / tiering / oblíbené (FREE vs PRO)
- **Auth:** Auth.js v5 (`next-auth`) + `@auth/prisma-adapter`, session strategie **database**
  (tabulky `User`/`Account`/`Session`/`VerificationToken` v Neonu). Konfigurace `auth.ts`
  (root), handlery `app/api/auth/[...nextauth]/route.ts`, provider **Google**. Session se
  čte bezpečně přes `getCurrentUser()` (`lib/authUser.ts`) – když auth není nakonfigurovaná
  (chybí `AUTH_SECRET`) nebo selže, vrací `null` → app běží dál jako anonym (FREE).
- **Tiering = gating na hranici route, jádro zůstává čisté.** `compareTeams` se NEMĚNÍ;
  PRO obsah ořezává `toFreeResult` (`lib/entitlements.ts`) až v `/api/compare`. FREE =
  metriky + souhrn formy + sdílení URL; PRO = predikce, insights, zranění, oblíbené.
  `CompareResult.prediction`/`insightReport` jsou proto **volitelné** + flag `locked`.
- **Trial:** přihlášený FREE uživatel může **1×** odemknout plnou PRO verzi jednoho
  porovnání (`User.proTrialUsed`). UI volá `/api/compare?unlock=1`; server přes
  `getEntitlement` spotřebuje trial. Zranění (`/api/injuries`) jsou **plně PRO** (mimo trial).
- **Always-PRO allowlist:** env `PRO_EMAILS` (čárkami oddělené e-maily) → `isProEmail`
  (`lib/entitlements.ts`) v session callbacku `auth.ts` přepíše tier na PRO bez ohledu na DB
  (přežije reset DB i nové přihlášení). Vlastníkův účet patří sem, ne do ručního DB updatu.
- **Oblíbené (PRO):** `SavedComparison` drží IDs (re-run) **i JSON `snapshot`** celého
  `CompareResult` (okamžité zobrazení „jak to bylo" bez fetchu) + `snapshotVersion`.
  API `app/api/favorites` (GET/POST upsert) + `[id]` (DELETE). UI `FavoritesSection.tsx`;
  načtení snapshotu přeskočí auto-fetch (`skipAutoRef` v `CompareApp`), „Aktualizovat" re-runne.
- **Gating v UI:** `ProLock.tsx` (zámek + CTA dle stavu: přihlásit / trial 1× / upgrade),
  `AccountMenu.tsx` (přihlášení Google, tier odznak, odhlášení). PRO sekce v `CompareApp`
  se renderují jen když `!result.locked`.

## Predikční záložka (PRO) + dataset predikce-vs-skutečnost
- **Princip:** predikce nadcházejících zápasů se počítají **jen na pozadí (cron), dávkově**
  a ukládají do tabulky `FixturePrediction` (predikce + po odehrání výsledek). Záložka
  `/predikce` i track-record **jen ČTOU z DB** – nikdy se nepočítá živě per request
  (1 zápas ≈ 26–35 API volání → drahé). Studené naplnění dělej lokálně / `?league=ID`.
- **Pipeline** (`lib/data/predictions.ts`, real data): `runPredictUpcoming`
  (`ALL_PREDICTION_LEAGUES` = Top-5 klubových lig `PREDICTION_LEAGUES` + reprezentační
  soutěže z `catalog.ts`: finálové turnaje `NATIONAL_TOURNAMENT_LEAGUE_IDS` (MS=1, EURO=4,
  Copa América=9, AFCON=6, Asian Cup=7, Gold Cup=22) stavěné **venue-neutrálně**, a soutěže
  s reálným domácí/venku `NATIONAL_HOME_AWAY_LEAGUE_IDS` (UEFA NL=5, CONCACAF NL=536)
  stavěné s **HOME/AWAY splitem** → predikce u nich zachytí domácí výhodu)
  → `fetchLeagueUpcomingFixtures` + ×2 build týmů + `compareTeams` → `upsertPrediction`
  (`predictionStore.ts`). Build se větví: klub → `getCompareTeam`; reprezentační turnaj →
  `getCompareNationalTeamFromFixture` (meta název/logo **z fixture**, ne z konfederace –
  tým může být z libovolné konfederace; forma z `fetchLastFixtures`, venue-neutrální).
  `runSettleResults` dotáhne skóre dle `fixtureId` (`fetchFixturesByIds`) bez ohledu na ligu.
  Crony `app/api/cron/{predict-upcoming,settle-results}` (denně ve `vercel.json`,
  `CRON_SECRET`, `?league=ID` override). Mimo sezónu = prázdno (UI to zvládá). Reprezentační
  řádky v `PicksApp` **jsou klikací**: `/api/picks` jim dohledá konfederaci každého týmu
  (`getNationalConfedMap`) a deep-link míří do NATIONAL Porovnání (stejně jako Zápasy);
  `MatchPick` proto nese `compareMode`+`home/awayCompareLeagueId`, klikatelnost řeší
  `buildCompareHref` (tým bez dohledané konfederace → `null` = neklikací).
- **EV / value tipy vůči kurzům** (`lib/picks/value.ts`, čisté + testy): predikční pipeline
  dotahuje **referenční kurzy sázkovky** (`fetchOdds` v `apiFootball.ts`, decimal odds 1X2 +
  Over 2.5 + BTTS od jedné preferované sázkovky) a ukládá je na `FixturePrediction`
  (`odds*` sloupce, `saveOdds`/`hasOdds`). Životní cyklus jako benchmark: **jen klubové ligy,
  1×/zápas (guard `hasOdds`), jen do `ODDS_LOOKAHEAD_HOURS=72` před výkopem** (týden staré kurzy
  nemají pro EV smysl; cron běží denně → každý zápas se chytí těsně před výkopem; rozpočet
  ~1 volání/zápas). Ukládáme **syrové kurzy** → `impliedProb=1/kurz` i `edge=p_model×kurz−1`
  se dopočítají čistou funkcí (`valueOf`/`rowValue`), takže přepočet při změně modelu nevyžaduje
  nový fetch. Kurzy žijí **jen na uložených řádcích** (DB), ne v živém `compareTeams` → `MatchPrediction`
  je nemá (živé Porovnání zůstává bez odds fetchu). EV se zobrazuje jen v `PicksApp`.
- **Výběr tipů** (`lib/picks/rules.ts`, čisté + testy): `evaluateRule`/`filterPicks` nad
  `PredictionRow`; pravidlo `PickRule{market: win|over25|btts, venue, minProb, minEdge?}` (sdílené
  `ruleSchema`), presety `PICK_PRESETS`. **`minEdge`** (volitelný) = value režim: tip projde jen
  se známým kurzem a edge ≥ prahu (bez něj = chování jako dřív, čistě `minProb`); UI přepínač
  „Jen value tipy" v `RuleControls` posílá `minEdge=0`, `PickRow` ukazuje kurz + edge (`ValueBadge`).
  `MatchPick.value` nese `{odds, impliedProb, edge}`. API `app/api/picks` (**nadcházející tipy = PRO** přes
  `getEntitlement`, FREE→`{locked}` → v UI `ProLock` jen místo seznamu tipů), `app/api/picks/stats`
  (**FREE** – agregátní/historické metriky nic konkrétního neprozrazují; `lib/picks/trackRecord.ts`:
  `computeTrackRecord` = globální track-record + `computeBenchmarkTrackRecord` = side-by-side
  náš model vs. API-Football na společné podmnožině (viz benchmark níže) + `backtestRule` =
  backtest navoleného pravidla nad historií = úspěšnost „kdybys takhle sázel"). UI `PicksApp.tsx`
  (panely `TrackRecordPanel` / `BenchmarkPanel` / `StrategyPanel` + `RuleControls` se renderují
  **vždy = FREE**; zamčený `ProLock` je jen na místě seznamu konkrétních nadcházejících tipů).
- **Kalibrace:** `npm run calibrate` (`scripts/calibrate.ts`) = MLE `DC_RHO` z odehraných
  predikcí (reuse exportů `drawTau`/`poissonVector`) + Brier/log-loss. Ladění = ruční
  úprava `DC_RHO` v `predict.ts` + bump `MODEL_VERSION` (`predictions.ts`). Počítá **jen
  z `modelVersion=MODEL_VERSION`** (kalibrace je per verzi modelu) a chce **≥30 odehraných**
  predikcí, jinak je výsledek orientační. `DC_RHO` je zatím publikovaný default −0.13
  (Dixon–Coles 1997), nekalibrovaný na vlastních datech – čeká na dost settlnutých predikcí
  (první dataset se sbírá z MS 2026; settle dělá cron `settle-results`).
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

## Záložka Přestupy (money-first, zdroj = Transfermarkt dataset)
- **Princip:** přestupy top-5 lig se importují **dávkově na pozadí** do tabulky `Transfer`;
  záložka `/transfers` i bilance **jen ČTOU z DB**. Zdroj je **volný Transfermarkt dataset**
  (`dcaribou/transfermarkt-datasets`, CC0, R2 bucket, aktualizace týdně) – jediný, který nese
  **reálné ceny** (`transfer_fee`); API-Football ceny prakticky nemá (2 z 6326). Dataset nemá
  typ (hostování/trvalé) → bilance je **peněžní** (nákupy − prodeje), kategorie se odvozují jen
  z ceny (placené vs ostatní).
- **Import** (`lib/data/transfersDataset.ts`): `importTransfersFromDataset` → `fetch` `transfers.csv.gz`
  (R2 URL) → `gunzipSync` → `parseCsv` (vlastní RFC4180, bez závislosti) → filtr **aktuálního okna**
  (`windowStart ≤ date ≤ dnes`, vyřadí budoucí/junk data) **a** našich klubů přes
  **`clubCrosswalk.ts`** (statická mapa TM club_id → API-Football team id + leagueId; vygenerováno
  `scripts/buildCrosswalk.ts`, ruční kontrola). Řádek je **z perspektivy našeho klubu**
  (`clubId`/`clubLeagueId`), logo z API-Football, `feeEur`/`marketValueEur` z TM. `replaceTransfers`
  tabulku **plně nahradí** (TM = jediný zapisovatel). Spouštění: `npm run import-transfers` (lokálně)
  + cron `app/api/cron/import-transfers` (denně, `CRON_SECRET`).
- **Přestupové okno** (`transferWindowStart`, catalog.ts): zimní (od 1. 1.) / letní (od 1. 7.);
  mezi okny vrací start posledního otevřeného. Filtruje se i na čtení
  (`getLeagueTransfers`/`getClubBalances` – `date ≥ windowStart`). Dokončené okno **zůstane**,
  dokud nezačne další (kdy ho import **nahradí**). Pozor: zimní okno bývá chudé (málo placených
  přestupů), hlavní objem je v létě; TM má navíc dost cen „nezveřejněno" → `feeEur` 0/null.
- **Bilance** (`computeBalances`, transferStore.ts): per klub `spendEur`/`earnEur`/`netEur`
  (z `feeEur`) + počty IN/OUT; řazení dle `netEur` (největší investor první). Kategorie
  (`inByCategory`…) se počítají dál, ale UI je nepoužívá (viz dead code níže).
- **Gating:** přehled + bilance klubů (počty, peníze) = **FREE**; **detail** klubu (kteří hráči,
  za kolik) = **PRO** (`/api/transfers` vrací `balances` vždy, `transfers` jen PRO, jinak `detailLocked`).
- **UI `TransfersApp.tsx`** (klubocentrické, mobile-first): tabulka klubů s **net spend** + počty,
  přepínač **Jen placené** (default) vs **Vše**, klik = detail (cena + datum) pro PRO. Filtr lig = chips.
- **Dead code pro návrat** (`MODE` v `TransfersApp.tsx` = `"money" | "category"`): předchozí
  kategoriové řešení (počty po typech z API-Footballu) zůstává jako `CategoryView` + API-Football
  pipeline `lib/data/transfers.ts` (`runRefreshTransfers`, `fetchTeamTransfers`, `classifyTransfer`,
  `parseTransferFee`) a route `app/api/cron/refresh-transfers` – nepoužité, přepnutelné.
- **Mock režim:** `lib/data/mock/transfers.ts` → záložka funguje bez DB/API.
- Vědomá výjimka ze scope „jen statistiky" (nová tabulka/modul), jako predikce.

## PWA (instalace na iOS/Android)
- Manifest `app/manifest.ts` (Next metadata route → `/manifest.webmanifest`), ikony
  v `public/` (`icon-192/512`, `icon-maskable-512`, `apple-touch-icon`) generované ze
  `logoapp.png` přes `sharp`. iOS meta (`appleWebApp`) + `themeColor` v `app/layout.tsx`.
- Service worker `public/sw.js` (app-shell cache, **necachuje** `/api/*` ani HTML porovnání),
  registrace `PWARegister.tsx` **jen v produkci**.
- **Interaktivní instalační pomůcka** `InstallPrompt.tsx`: Android/Chromium nativní
  `beforeinstallprompt`; iOS Safari vizuální návod Sdílet → Přidat na plochu (Safari nemá
  prompt); detekce standalone (už nainstalováno → skryto), „odloženo" v `localStorage` (7 dní).
  Ruční vyvolání z menu/patičky přes `installBus.ts` (`InstallLink.tsx`).

## SEO / sdílení / analytika
- **Dynamický OG obrázek** `app/og/route.tsx` (`ImageResponse` z `next/og`, 1200×630):
  čte názvy týmů z query `?h=&a=` a vykreslí „Tým A vs Tým B" kartu (bez query = obecná).
  **Záměrně bez server lookupu** v routě → scraper odkazu nespustí žádné API volání.
  Pozn.: statická OG text je bez diakritiky (default font satori).
- **`generateMetadata` v `app/porovnani/page.tsx`** (server komponenta; Porovnání žije na
  `/porovnani`, viz „Záložka Zápasy"): u konkrétního porovnání (oba `home`/`away` známé)
  dohledá názvy **1× kešovaným** `getTeamsByLeague` (katalogový read, ne drahý per-match
  fetch), složí `title`/`description`, `alternates.canonical` (`/porovnani?…`, dedup permutací
  parametrů) a OG/twitter (`summary_large_image`) s odkazem na `/og?h=&a=`. Lookup selže-li →
  vrátí `{}` a dědí statická metadata z `layout.tsx`. Metabase = `AUTH_URL`.
- **`app/sitemap.ts` + `app/robots.ts`** (Next metadata routes): sitemap = 4 hlavní záložky
  (`/` Zápasy, `/porovnani`, `/predikce`, `/transfers`; konkrétní porovnání se neindexují
  plošně – kombinatorika + canonical), robots povolí vše kromě `/api/`. BASE z `AUTH_URL`
  (fallback prod doména).
- **Analytika:** Vercel Web Analytics (`@vercel/analytics`), `<Analytics/>` v `layout.tsx`
  (pageviews zdarma, bez cookies; aktivní jen na Vercelu v produkci). Vlastní eventy přes
  `track(...)`: `share` (`AppHeader`), `signin_from_prolock` / `trial_unlock` (`ProLock`).
  **JSON-LD vynecháno záměrně** (`SportsEvent` sémanticky nesedí na statistické porovnání).

## DB
Prisma 6 + Postgres (Neon). Tabulky `ApiCache` (TTL) + `MatchStatCache` (trvalá)
+ účty (`User`/`Account`/`Session`/`VerificationToken`) + `SavedComparison` (oblíbené).
**Pozor:** Neon je sdílená pro lokál i Vercel → změna schématu (`prisma db push`)
ovlivní i produkci; nasaď nový kód hned.
**Verzování cache:** `MatchStatCache` má `schemaVersion`; po přidání metrik bumpni
`CURRENT_CACHE_VERSION` (`cache.ts`) → staré řádky se přestanou číst a samy se
dotáhnou znovu (zadarmo) s plnou sadou. Žádné plošné mazání. `saveMatchStats`
proto dělá upsert (ne createMany). Po nasazení případně urychli přes `/api/warm?league=ID`.

## Deployment
GitHub `Daifyyy/statapp` → Vercel (auto-deploy na push do `main`). Env na Vercelu:
`API_FOOTBALL_KEY`, `DATABASE_URL` (Neon pooled), `AUTH_SECRET`, `AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, volitelně `CRON_SECRET` a `PRO_EMAILS`
(always-PRO allowlist; změna env vyžaduje redeploy). `postinstall:
prisma generate` zajistí klienta při buildu. Live: https://statapp-uvol.vercel.app
**Auth host (DŮLEŽITÉ):** `trustHost: true` → bez `AUTH_URL` bere Auth.js host z requestu,
což je u Vercelu **deployment-specific URL** (`…-<hash>-…vercel.app`, mění se každým buildem)
→ `redirect_uri` neodpovídá whitelistu a Google vrací `Error 400: redirect_uri_mismatch`.
Proto **`AUTH_URL=https://statapp-uvol.vercel.app`** (stabilní doména) → redirect je vždy
konzistentní. Přihlašovat se přes produkční doménu, ne přes deployment URL.
**Google OAuth (Cloud Console → Credentials):** Authorized redirect URI
`https://statapp-uvol.vercel.app/api/auth/callback/google` + `http://localhost:3000/api/auth/callback/google`
(lokál); Authorized JavaScript origin `https://statapp-uvol.vercel.app`. Musí sedět znak po
znaku (https, bez koncového `/`).
**Pozn. (lokál):** Google token exchange = odchozí TLS → `npm run dev` spouštěj s
`NODE_OPTIONS=--use-system-ca` (jako probe/prisma). Bez auth env app běží jako anonym (FREE).

## Známé problémy / TODO
- **iOS Safari zoom na mobilu:** po kliknutí na „Vyber tým" se stránka stále přibližuje,
  i přes `font-size: 16px` na inputech/selectech (`text-base`) + globální media rule
  v `globals.css`. Hypotézy k ověření: skutečná computed font-size na fokusovaném
  inputu v mobilním Safari; jestli zoom netriggeruje jiný prvek; alternativně řešení
  přes `visualViewport` / `meta viewport interactive-widget`. Nutno ladit přímo na
  zařízení (Safari Web Inspector).

- **HOTOVO: Benchmark predikcí vs. API-Football** – viz „Interní benchmark vs. API-Football"
  v sekci o predikční záložce výše. Implementováno (schéma `bench*`, `fetchPrediction`,
  guard v `runPredictUpcoming`, `saveBenchmark`, side-by-side v `calibrate`). Čeká na data
  (klubové ligy v sezóně) → spusť `npm run calibrate` po dost settlnutých zápasech.
  - **HOTOVO i track-record benchmarku v UI:** `computeBenchmarkTrackRecord`
    (`lib/picks/trackRecord.ts`, sdílí `scoreProbs` s `calibrate`) → `api/picks/stats` →
    `BenchmarkPanel` v `PicksApp`. Reálná čísla naskočí po dost settlnutých klubových zápasech.

## Go-to-market / dostat web do oběhu (postup k provedení)
Technické základy jsou hotové (viz „SEO / sdílení / analytika"). Tohle je **ruční**
checklist mimo kód, seřazený podle poměru přínos/úsilí. Provádět postupně.

**Ověření po deployi (po každém nasazení Fáze 2):**
- Analytics: Vercel → projekt → **Analytics** (návštěvy, top stránky, referrers) a
  **Events** (vlastní eventy `share` / `signin_from_prolock` / `trial_unlock` = konverzní
  trychtýř). Web Analytics je třeba **1× zapnout v dashboardu** (Project → Analytics → Enable).
- OG náhled: zkopíruj URL porovnání → vlož do [opengraph.xyz] nebo Messengeru; má se ukázat
  karta „Tým A vs Tým B". Sítě OG **cachují** → změny protlač [FB Sharing Debugger].
- SEO soubory žijí: `/(robots.txt)` a `/(sitemap.xml)` na prod doméně.

**Krok 1 — Google Search Console (nutnost, ~15 min, zdarma):**
- [search.google.com/search-console] → přidat doménu → ověřit (DNS nebo HTML meta tag
  v `layout.tsx`) → **Sitemaps → vložit `sitemap.xml` → Submit**. Performance pak ukáže
  dotazy, na které tě lidi nacházejí. Totéž volitelně Bing Webmaster Tools.

**Krok 2 — Long-tail SEO (největší dlouhodobá páka):**
- Lidi googlí konkrétní zápasy („Sparta Slavia statistiky", „kdo vyhraje … predikce").
  Porovnání už mají **dynamický titulek/popis** přesně na to (`generateMetadata`).
- Zvážit generování odkazů na **vybraná derby/zápasy sezóny** do sitemapy (ať je Google
  objeví bez čekání). Držet rychlost (Core Web Vitals → už loading skeletony + cache).

**Krok 3 — Komunity (přímý provoz hned, než naběhne SEO):**
- FB skupiny o fotbale/sázení (CZ/SK), Discord/Reddit (r/fotbal, r/soccerbetting),
  X/Twitter před velkými zápasy. **Vždy sdílet konkrétní zápas, ne homepage** (konkrétní
  OG karta = klik). Přidat hodnotu (číslo/tip), ne spam.

**Krok 4 — Benchmark jako marketing:**
- Až `BenchmarkPanel` ukáže, že vedeme nad API-Footballem, je to nejsilnější hook:
  „náš model trefil 1X2 v X %". Screenshot → příspěvek do sázkařských komunit.

**Krok 5 — Vlastní doména (důvěra + CTR):**
- `statapp-uvol.vercel.app` je těžko zapamatovatelné. Koupit doménu, nastavit ve Vercelu
  **a v `AUTH_URL`**. Pozor: po změně projít Google OAuth redirect URI + `AUTH_URL`
  (viz Deployment výše) – jinak `redirect_uri_mismatch`.

**Krok 6 — PWA retence:**
- Aktivně nabízet „Přidej na plochu" vracejícím se (už máš `InstallPrompt`). Instalovaný
  uživatel se vrací častěji – nezíská nové, ale udrží stávající.

**Doporučené pořadí pro 1. vlnu:** (1) Search Console + sitemap → (2) vlastní doména →
(3) pár příspěvků do komunit s konkrétním zápasem (okamžitý provoz + první data v Analytics).
