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
npm run audit-leagues      # herní ligy: odvozené vs. kurátorované pohárové/sestupové příčky
npm run audit-leagues -- 345 39   # jen vybraná liga (id)
npm run sim-game     # balanc Manažera – bez API/DB. 4 sekce: (1) náročnost ligy + rozklad
                     # 1X2 a ⌀ góly, (2) křivka rozvoje vs kontrola bez rozvoje,
                     # (3) jak často se trefí clamp ADJUST_MIN/MAX, (4) kam investovat body
npm run sim-game -- --seasons=250 --careers=60 --maxSeasons=10
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
- **Ligová tabulka** (`getStanding`/`getLeagueStanding` + čistý `pickTeamStanding` ve
  `standings.ts`, endpoint `/api/standings`, UI `StandingContext.tsx`) – **líně** načítaný
  **FREE** kontext (pozice, body, V-R-P doma/venku/celkově dle přepínače). `/standings` přes
  TTL `ApiCache` **per liga** (6 h → 1 volání pokryje oba týmy stejné ligy); reprezentace
  tabulku nemají → `null` (graceful skip). Mimo `compareTeams`.
- **Nejlepší střelci** (`getTopScorers`/`getTeamTopScorers` + čistý `pickTeamScorers` ve
  `scorers.ts`, endpoint `/api/scorers`, UI `ScorerList.tsx`) – **líně** načítaný **FREE**
  kontext: hráči daného týmu ze žebříčku střelců ligy (`/players/topscorers`, TTL `ApiCache`
  **per liga** 12 h, sdílené pro oba týmy). Reprezentace/tým bez top střelce → prázdno (skip).
  Standings i střelci mají **rate-limit** (`allowRequest`, jako `/api/teams`) – FREE routy
  spouští upstream fetch na cold cache. Mimo `compareTeams`.
- **Pozice v seznamech** (`RankBadge.tsx`): Program (Zápasy) i řádek tipu (`PickRow`, sdílený
  i s digestem) ukazují u klubových zápasů pozici obou týmů. Obohacení je **server-side,
  batchově per liga** (`getRanks` → `stampPickRanks` v routách `/api/picks`+`/api/digest`;
  `enrichFixtureRanks` v `getFixturesByDates`), sdílí `standings:` cache → **0 API navíc**;
  `UpcomingFixture`/`MatchPick` nesou volitelné `homeRank`/`awayRank`. `warmCatalog` (denní
  cron) předehřívá i tabulky klubových lig → rank v seznamech je instantní. Reprezentace bez pozice.
- **Predikce** (`lib/stats/predict.ts`, `CompareResult.prediction`) – **Poisson** z očekávaných
  gólů (útok týmu × obrana soupeře, venue-specific, fallback TOTAL, volitelné zpevnění xG)
  s **Dixon–Coles korekcí** nízkých skóre (`DC_RHO`, `drawTau`; ρ<0 zvyšuje remízy 0:0/1:1).
  V/R/P, BTTS, Over 2.5 i **top-N nejpravděpodobnějších přesných skóre** (`topScores`) se
  počítají z téže opravené mřížky → vzájemně konzistentní (`topScores` je UI-only obohacení
  z živé mřížky, **neukládá se** do `PredictionRow`/`FixturePrediction`). Chybí-li gólová i xG
  data, vrací `available:false` (UI zobrazí „nedostatek dat", ne falešnou 50/50). UI `MatchPrediction.tsx`.
  **Připravenost predikce** (`lib/stats/readiness.ts`, `MatchPrediction.readiness`): kolik dat
  reálně stojí za λ = **nejslabší ze 4 vstupů** (útok×obrana obou týmů, efektivní vzorek
  `MetricValue.sampleSize` ve venue s fallbackem na TOTAL). Vrací `{sample, score 0–1, level
  low|medium|ok}` (`PREDICTION_READY_SAMPLE=4`). Na startu sezóny je LAST5/LAST10 tenké →
  predikce stojí na baseline minulé sezóny → odznak „málo dat". Ukládá se jako `readinessSample`
  (Float) na `FixturePrediction`/`PredictionRow`; v `PicksApp` rekonstruováno přes `readinessOf`.
  Čistá funkce, žádná nová data. UI: banner v `MatchPrediction`, `ReadinessTag` na řádku tipu.
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

## Platby (Stripe) — PRO předplatné [ROZPRACOVÁNO, dokončit příště]
- **Princip:** placený upgrade FREE→PRO přes **Stripe subscription**. `User.tier` zůstává
  **jediný spínač** PRO; jádro (`compareTeams`/`getEntitlement`/`toFreeResult`) se NEMĚNÍ.
  Allowlist `PRO_EMAILS` je dál nadřazený (vlastník je PRO bez ohledu na Stripe).
- **Kód (HOTOVO, typecheck+lint OK, Stripe SDK 22.3.0):**
  - `lib/stripe.ts` – singleton klient + `isStripeConfigured()` + `appBaseUrl()` (sdílí `AUTH_URL`).
  - `app/api/stripe/checkout/route.ts` (POST) – přihlášený uživatel, najde/vytvoří Stripe
    customer (uloží `stripeCustomerId`), vrátí Checkout URL (mode `subscription`, `STRIPE_PRICE_ID`).
  - `app/api/stripe/webhook/route.ts` (POST) – **JEDINÉ místo přepnutí `tier`**. Ověřuje podpis
    přes RAW body (`req.text()` + `constructEventAsync`, `STRIPE_WEBHOOK_SECRET`). Na
    `checkout.session.completed` + `customer.subscription.{created,updated,deleted}` → `syncSubscription`
    (`updateMany` dle `stripeCustomerId`: active/trialing→PRO+`proUntil`, jinak FREE). `periodEndOf`
    čte konec období best-effort napříč verzemi API (jen pro UI).
  - `app/api/stripe/portal/route.ts` (POST) – Stripe billing portal (správa/zrušení).
  - `prisma/schema.prisma`: `User` += `stripeCustomerId @unique`, `stripeSubscriptionId`, `proUntil`.
  - UI: `ProLock.tsx` po-trial větev = tlačítko „Upgradovat na PRO" (`/api/stripe/checkout`,
    event `upgrade_click`); `AccountMenu.tsx` pro PRO = „💳 Spravovat předplatné" (`/api/stripe/portal`).
- **ZBÝVÁ RUČNĚ (příště):**
  1. Stripe dashboard (test mód): produkt „Predictapp PRO" 99 Kč/měs → **Price ID**; aktivovat Customer portal.
  2. `NODE_OPTIONS=--use-system-ca npx prisma db push` (nová nullable pole; Neon sdílená s prod → nasadit kód hned).
  3. `.env`: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
  4. Lokální test: `stripe listen --forward-to localhost:3000/api/stripe/webhook` (dá `whsec_`),
     karta `4242 4242 4242 4242` → ověř PRO; `stripe trigger customer.subscription.deleted` → návrat FREE.
     (Stripe volání lokálně přes `--use-system-ca` jako api-sports/Google.)
  5. Go-live: live klíče + prod webhook endpoint `…/api/stripe/webhook` na Vercelu → redeploy.
  6. Mimo kód: obchodní podmínky + zásady + DPH/OSS (zvážit Stripe Tax) před ostrým provozem.
- **Možné rozšíření:** roční cena = druhý Price ID + drobná úprava checkoutu.

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
- **Kalibrace:** `npm run calibrate` (`scripts/calibrate.ts`) = MLE `DC_RHO` z odehraných
  predikcí (reuse exportů `drawTau`/`poissonVector`) + Brier/log-loss. Ladění = ruční
  úprava `DC_RHO` v `predict.ts` + bump `MODEL_VERSION` (`predictions.ts`). Počítá **jen
  z `modelVersion=MODEL_VERSION`** (kalibrace je per verzi modelu) a chce **≥30 odehraných**
  predikcí, jinak je výsledek orientační. `DC_RHO` je zatím publikovaný default −0.13
  (Dixon–Coles 1997), nekalibrovaný na vlastních datech – čeká na dost settlnutých predikcí
  (první dataset se sbírá z MS 2026; settle dělá cron `settle-results`).
  **Zostření favoritů** (`LAMBDA_SHARPEN` v `predict.ts`, `sharpenLambdas`): reliability křivka
  ukázala, že 1X2 pravděpodobnosti jsou málo rozprostřené (model podsebevědomý na favoritech).
  `sharpenLambdas` zostří **jen rozdíl** λ (D = λ_home−λ_away) se zachováním součtu → narovná 1X2,
  Over 2.5 nechá být, mřížka zůstane konzistentní. `LAMBDA_SHARPEN=1.0` = **přesný no-op** (infra
  připravená, zatím nepoužitá). `calibrate` má grid search přes `s` (1X2 log-loss). **Pozor:**
  na malém vzorku optimum přestřeluje (44 zápasů → s≈2.05, plochá křivka = overfit) → měnit až
  na ~150–300 settlnutých, pak bump `MODEL_VERSION`. Stejná logika jako `DC_RHO`.
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

## Záložka Porovnání — kategorie, styl hry, ligový benchmark (FREE)
- **Přepínač pohledu** (`viewMode` state v `CompareApp.tsx`): 3 režimy — **Raw statistiky** (původní
  19 metrických řádků) / **Kategorie** / **Styl hry**. Přepínač `Segmented` nad metrikami,
  stav lokální per výsledek (reset při novém porovnání). **FREE**, žádné gating.
- **Kategoriové skóre** (`lib/stats/categories.ts`, `app/_components/CategoryScores.tsx`):
  čistá funkce `computeCategoryScores(homeValues, awayValues, venue, mode)` → 5 `CategoryScore` objektů
  (Útok / Obrana / Hra s míčem / Tvorba šancí / Disciplína), každý 0–10 pro oba týmy.
  Normalizace je **relativní** (ne absolutní): `ratio = home / (home + away)` → `score = ratio × 10`.
  Metriky s `LOWER_IS_BETTER` invertovány. Jeden nebo oba null → metrika se přeskočí (nezkresluje váhy).
  `available: false` pro národní týmy kde chybí klíčové metriky (`METRICS_BY_ENTITY`).
- **Styl hry** (`lib/stats/playStyle.ts`, `app/_components/PlayStyleChart.tsx`):
  čistá funkce `computePlayStyle(homeValues, awayValues, venue, mode)` → 4 `PlayStyleDimension` (Kontrola
  míče / Styl útoku / Pressing / Efektivita střel). Škálování je **absolutní** (fixní rozsahy), ne
  relativní vůči soupeři → říká „tenhle tým hraje kombinačně" nezávisle na soupeři.
  Formule: Kontrola míče = `clamp((POSSESSION−30)/40, 0,1)×10`; Styl útoku = `SHOTS_INSIDE/(inside+outside)×10`;
  Pressing = `clamp((FOULS−8)/12, 0,1)×10`; Efektivita = `SHOTS_ON_TARGET/SHOTS×10`.
  Dimenze Kontrola míče + Styl útoku: `available: false` pro národní týmy (chybí POSSESSION/SHOTS_INSIDE_BOX).
- **Ligový benchmark** (`lib/data/standings.ts`, `computeLeagueGoalsAvg`): průměrné góly
  vstřelené/obdržené **na tým za zápas** z celé ligy (z již cachovaného `ApiStandingRow[]`).
  Denominátor = `∑ played` (součet zápasů všech týmů) = správná měřítko pro porovnání s
  metrikou jednoho týmu (goals-per-team-game, ne per-unique-match). Zobrazeno jako text
  `⌀ liga X.XX gólů/zápas` pod kategoriemi Útok/Obrana. **0 nových API volání** — reuse
  `cachedLeagueStandings()`. `getStanding`/`getLeagueStanding` vrací `{ standing, leagueAvg }`.
  Benchmark z **domácí ligy** (cross-ligová porovnání: referenční bod je domácí prostředí).
- **Sdílená komponenta** `app/_components/TeamHeading.tsx`: extrahovaný `TeamHeading`
  (logo + jméno, mobilní/desktopová velikost), importovaný z `CategoryScores`, `PlayStyleChart`
  i `CompareApp` — žádné duplicity.
- **Nové typy** (`lib/types.ts`): `CategoryKey`, `CategoryScore`, `PlayStyleDimension`, `LeagueGoalsAvg`.

## Záložka Přestupy (category-first, zdroj = API-Football)
- **Princip:** přestupy top-5 lig se stahují **dávkově na pozadí** do tabulky `Transfer`;
  záložka `/transfers` i bilance **jen ČTOU z DB**. Zdroj je **API-Football** (`/transfers`) –
  je **aktuálnější** než dřívější TM dataset, ale **nemá ceny** (2 z 6326 řádků) → záložka je
  **category-first**: počty příchodů/odchodů po **typech** (`type`: trvalý/hostování/návrat/volný),
  ne peněžní bilance. Čtecí vrstva (`/api/transfers`, `getLeagueTransfers`/`getClubBalances`) je
  **na zdroji nezávislá** – čte tabulku `Transfer` bez ohledu na zapisovatele.
- **Stahování** (`lib/data/transfers.ts`): `runRefreshTransfers` – `/transfers` neumí filtr podle
  ligy → **iteruje přes všechny týmy top-5 lig** (`getTeamsByLeague`, ~20×5 ≈ 100 volání), proto
  **NIKDY ne živě per request**. `buildClubTransferRows` vybere přestupy v **aktuálním okně**, kterých
  se klub účastní, **z perspektivy klubu** (`clubId`/`clubLeagueId`); `classifyTransfer` z volného
  textu `type` určí kategorii, `parseTransferFee` zkusí cenu (skoro vždy null). Ukládá `upsertTransfer`
  (idempotentní) + `pruneTransfersBefore` (smaže předchozí okna). Spouštění: `npm run refresh-transfers`
  (lokálně; `--league=39` cold-fill, `--wipe` jednorázový reset) + cron `app/api/cron/refresh-transfers`
  (denně, `CRON_SECRET`, `?league=ID`).
- **Přestupové okno** (`transferWindowStart`, catalog.ts): zimní (od 1. 1.) / letní (od 1. 7.);
  mezi okny vrací start posledního otevřeného. Filtruje se i na čtení
  (`getLeagueTransfers`/`getClubBalances` – `date ≥ windowStart`). Pozor: zimní okno bývá chudé,
  hlavní objem je v létě (start 1. 7.).
- **Bilance** (`computeBalances`, transferStore.ts): per klub počty IN/OUT a **kategorie**
  (`inByCategory`/`outByCategory`) – ty pohání UI. Peněžní pole (`spendEur`/`earnEur`/`netEur` z
  `feeEur`) se počítají dál, ale jsou **dead code** (API-Football ceny nemá; žijí jen pro TM money view).
- **Gating:** přehled + počty klubů = **FREE**; **detail** klubu (kteří hráči) = **PRO**
  (`/api/transfers` vrací `balances` vždy, `transfers` jen PRO, jinak `detailLocked`).
- **UI `TransfersApp.tsx`** (klubocentrické, mobile-first): `MODE="category"` → `CategoryView`:
  tabulka klubů s počty ↓IN/↑OUT, přepínač **Jen trvalé** vs **Vše**, klik = detail (typ přestupu) pro PRO.
- **Dead code pro návrat = TM money view** (`MODE="money"` → `MoneyView` + peněžní bilance): zdroj
  **Transfermarkt dataset** (`lib/data/transfersDataset.ts`: `importTransfersFromDataset`, `parseCsv`,
  `clubCrosswalk.ts`, `replaceTransfers`) + skript `npm run import-transfers` + cron
  `app/api/cron/import-transfers`. **Nese reálné ceny** (`transfer_fee`), ale aktualizace jen týdně
  (mirror lag) → přepnuto pryč kvůli zastaralosti. Návrat: `MODE="money"` + cron zpět na `import-transfers`.
- **Migrace zdroje:** `runRefreshTransfers` je inkrementální (upsert+prune), nemaže in-window řádky
  jiného zdroje → **při přepnutí jednou vyčistit `Transfer`** (`npm run refresh-transfers -- --wipe`),
  jinak se TM a API-FB řádky smíchají na duplicity (různé ID prostory, dedup je nezachytí).
- **Mock režim:** `lib/data/mock/transfers.ts` (FEE_TYPES vč. Loan/Free) → category view funguje bez DB/API.
- Vědomá výjimka ze scope „jen statistiky" (nová tabulka/modul), jako predikce.

## Záložka Hra: Manažer (klubový simulátor ligy + kariéra) — vázaná na profil
- **Princip:** hratelný **manažer klubu** — vyber **reálnou ligu a tým**, zvol **taktiku** a
  odehraj sezónu; napříč sezónami **kariéra** s reputací, job marketem a historií. **Naučný hák:**
  simulace běží na **témže predikčním jádru** jako reálné tipy (Poisson + Dixon–Coles) → před
  každým zápasem se ukáže **predikce modelu (1X2) + analýza** ve stylu Porovnání. FREE pro přihlášené.
- **Klíčová myšlenka:** každý tým = **dvě čísla (síla útoku/obrany)** → `λ` do Poissonu → sampluje
  se skóre. Trenérova rozhodnutí (**zápasový plán + counter, morálka, eventy**) hýbou λ **jen tvého
  týmu**; AI soupeři jedou neutrálně. Bez sestav hráčů/přestupů (vědomě mimo scope).
- **Realismus sil** (Phase 1): `SPREAD`+`amplifySpread(teams)` (`teams.ts`, laděno v `balance.ts`)
  roztáhne rozptyl kolem ligového průměru → mistr silný, dno slabé. Volá se na **konci každého
  trychtýře ratingů** (`generateLeague`/`standingsToTeams` i po `driftTeams`). Empiricky: nejsilnější
  tým vyhraje titul ~33 %, nejslabší ~0 %, Ø mistr ~80 b / poslední ~26 b (náročné, ne walkover).
  `leagueStars(team, league)` = hvězdy 1–5 dle **percentilu** síly v lize.
- **Reálné týmy = z ligové tabulky** (`getGameLeague` v `repository.ts` → `getLeagueGameTeams` v
  `realRepository.ts`): ratingy útoku/obrany = **góly na zápas** z tabulky (shrink k ligovému
  průměru), domácí výhoda z home splitu, loga+jména z API. **1 cachované volání/liga** (sdílí
  `standings:` cache). **Mezisezóna** (0 odehraných) → fallback na **předchozí sezónu**. Mock/bez API
  → fiktivní `generateLeague`. Pool lig = `GAME_LEAGUES` (`lib/game/leagues.ts`, Top-5 + Portugalsko/
  Nizozemsko/**Belgie/Skotsko/Rakousko/Řecko**/Česko; malé ligy = předkola v `LEAGUE_ACCESS`).
  Výběr kariéry nabízí **i 2. ligy** (`SECOND_TIERS`, `tier: 2` z `/api/game/leagues`) – nízká
  prestiž → projdou `isHireable` na startovní reputaci = kariéra „zdola nahoru".
- **Pohárové/sestupové příčky** (`deriveLeagueAccess` v `lib/data/standings.ts`): odvozují se ze
  sloupce `description` reálné tabulky, kurátorovaná `LEAGUE_ACCESS` je jen **fallback** (mock /
  výpadek dat). `accessFor` je slučuje **po polích** (sloty z dat, sestup z curated když v datech
  není) – ne all-or-nothing. Tři pasti, na které to naráželo (všechny pokryté testy + `npm run
  audit-leagues`, který tiskne odvozené vs. kurátorované per liga):
  1. **`relegBottom: null` ≠ `0`.** Ligy s nadstavbou značí spodní skupinu jen fázově
     („Relegation Round/Group") → sestup z dat neodvodíš. Nula by znamenala „liga bez sestupu"
     a zkratovala fallback → *nikdo nikdy nesestoupil* (ČR/Skotsko/Belgie/Rakousko).
  2. **Baráž není jistý sestup.** Jistý pád popisek **začíná** slovem `Relegation`
     („Relegation - Championship"); baráž má tvar `"<Liga> (Relegation)"` nebo
     `"Relegation Play-offs"`, fázový split `"Relegation Round"`.
  3. **Soutěž se hledá jen PŘED závorkou** + sloty se ořežou na **souvislou řadu od 1. místa**.
     Jinak `"Promotion - Eredivisie (Conference League - Play Offs)"` (domácí play-off o Evropu)
     dá Nizozemsku 9 evropských míst z 18, a `15.→UEL` (vítěz FA Cupu) rozsvítí evropský pruh
     u 15. místa Premier League. Hra domácí pohár nemodeluje.
- **Čisté jádro `lib/game/`** (na zdroji nezávislé jako `lib/picks/`, testy `game.test.ts`):
  `simulate.ts` (`matchLambdas`/`predictProbs`/`simulateMatch` staví normalizovanou mřížku z
  **reused** `poissonVector`+`drawTau`; přijímá per-stranu `SideAdjust{attack,concede}`, AI =
  `NEUTRAL_ADJUST`), `teams.ts` (`generateLeague`+`standingsToTeams`+`amplifySpread`), `schedule.ts`
  (`roundRobin` – **Bergerova orientace**: prostředí se bere z indexu dvojice v kole, ne z čísla
  kola; rotace kruhové metody by `(r+i)` vyrušila a tým by hrál celou půlsezónu jen doma/jen venku.
  Každý tým `n-1`× doma i venku, max. **3 zápasy v kuse** ve stejném prostředí. `newSeason` navíc
  **míchá pořadí id seedem**, jinak by `injectYourTeam` (index 0) dal hráči privilegovanou pozici
  fixního týmu a každá sezóna kariéry by měla identický rozpis kol),
  `standings.ts` (`buildTable`), `engine.ts` (`newSeason`/`setPlan`/`setInstruction`/`playRound`/
  `simulateToEnd`/`yourNextMatch`+`resolveYourAdjust` = plán×counter×**instrukce**×morálka×**kondice**
  ×eventy, **per-kolo RNG** `deriveSeed(seed,round)`), `career.ts` (`summarizeSeason` vč.
  `objectiveMet`, `startNextSeason` s driftem+investicemi, `careerStats`), `leagues.ts` (prestiž,
  `evaluateSeason`, `LEAGUE_ACCESS`, `leagueStars`, `seasonObjective`), `reputation.ts`
  (`updateReputation` dle příčky+over/under-performance+**cíle**, `isHireable`/`expectedRank`/
  `HIRE_MARGIN`; **strop reputace** `applyCeiling`: kladný přírůstek nesmí vytlačit reputaci nad
  `prestiž vedeného týmu + REP_CEILING_MARGIN` → série titulů se slabým klubem nevynese na elitní
  tým, viz níže „Paralelní kariéra"), `analysis.ts` (`teamSeasonStats` + `venueStats`/
  `leagueGoalsPerTeamGame` pro panel „Čísla soupeře"),
  `development.ts`/`fitness.ts`/`instructions.ts`
  (Phase B, viz níže), `balance.ts` (**laditelné konstanty**).
- **Agency je oddělená od ligy** (`lib/game/agency.ts`, příprava na reprezentační turnaje):
  `resolveAdjust`/`scoutOpponent`/`maybeEvent`/`applyEventChoice` berou **`AgencyState`** — 12 polí
  bez rozpisu, tabulky, sezónního cíle i rozvoje klubu. `SeasonState` je jeho strukturální
  nadmnožina, takže ligový kód se nemění. (`MatchContext` je obsazený v `lib/data/cache.ts`,
  proto `Agency*`.) Tři místa, kde agency dřív sahala na ligu:
  - **forma** — `scoutOpponent` volal `teamSeasonStats`, ale bral z něj jen `.form`; `analysis.ts`
    přitom importuje `engine.ts` → existoval **skutečný cyklus** `engine → scouting → analysis →
    engine`, který `events.ts` obcházel duplikací výpočtu. Vytknuto do **`form.ts`** (list bez
    závislostí na jádru). `analysis.ts` zůstal čistě UI vrstva (tabulka/rank/body).
  - **příští soupeř** — `events.ts` četlo `state.schedule[state.round]`. Teď ho `maybeEvent(state,
    nextOpponentId)` dostává **parametrem**; `nextOpponentOf` (`engine.ts`) ho odvodí z rozpisu,
    turnaj z pavouka. **Neukládá se do stavu** — odvozená kopie by se mohla rozejít.
  - **kariérní pole** — `youth`/`devBonus` jsou na `AgencyState` volitelné (`?? 0`); v turnaji
    chybí, takže `youth_spark` prostě nepadne. 14 ze 16 eventů jede v turnaji beze změny.
  - **`rngSalt`** (`RNG_SALT_LEAGUE` 0 / `RNG_SALT_TOURNAMENT`) odděluje RNG proudy režimů —
    jinak by turnaj se stejným `seed` a `round` dostal identické eventy i scoutské omyly jako liga.
  - **Opravená kolize scout seedu:** `deriveSeed(seed, 70000 + round*101 + oppId)` kolidovalo
    (reálná id týmů jdou do tisíců → kolo 0/soupeř 101 == kolo 1/soupeř 0; 15 kolizí na mřížce
    6 kol × 8 soupeřů). Teď vnořeně `deriveSeed(deriveSeed(seed + rngSalt, 70000 + round), oppId)`,
    0 kolizí. Mění to determinismus scoutských omylů (ne balanc — `sim-game` sekce 1 je bit-identická).
- **Manažerská agency (Phase 2):** `scouting.ts` (`scoutOpponent` → styl attacking/defensive/balanced
  + traity + CZ popis; hlásí **s proměnlivou konfidencí**, viz „Scouting" níže), `plans.ts` (5 plánů
  `balanced/open/low_block/press/counter`, `resolvePlan(plan, oppStyle)` = `PLAN_BASE` ×
  `COUNTER_MATRIX[plan][styl]`), `morale.ts`
  (`moraleFactor` ±6 % λ, `updateMorale` po kole dle výsledku+překvapení), `events.ts` (deterministické
  eventy dle `(seed,round)`, `maybeEvent`/`applyEventChoice` → morálka / dočasný `Modifier{untilRound}`).
  `SeasonState` nese `plan`/`morale`/`objective`/`modifiers`/`pendingEvent`.
  - **Counter je explicitní tabulka, ne čtyři šablony.** `COUNTER_MATRIX` (`balance.ts`) dá každé
    dvojici plán×styl vlastní tvar; `balanced` je řádek samých 1.0 = vědomě bezpečná volba. Rozsah
    hlídá `COUNTER_MAX_EFFECT` (0.12) + test — není to násobič, ale **dokumentovaný rozpočet**.
  - **`counter` dřív dominoval `balanced`.** Základ 1.02/0.90 byl proti všem třem stylům zdarma lepší
    než 1.0/1.0 a na kondici taky (`PLAN_FATIGUE` 2 vs 3) → „Vyvážený" byla mrtvá volba. Dnes
    **0.94/0.90** (cenu nese útok) a únava 3. Obranu **nesnižovat na 0.88** – podlaha
    `0.88 × counter 0.90 × morálka × instrukce × event` prorazí `ADJUST_MIN` a `sim-game` sekce 3
    vyskočí z 0.16 % na 0.28 % clampnutých zápasů. Kryto testem „žádný plán nedominuje balanced"
    (λ osy **i** `PLAN_FATIGUE`; jedinou povolenou výjimkou na kondici je pasivní `low_block`).
  - `recommendPlan(styl)` = argmax `planScore` (útok − obdržené). Sdílí ho doporučení skautů
    i `pickPlan` v `scripts/simGame.ts` → jeden zdroj pravdy.
- **Kariéra + role:** UI ukazuje **sezónní cíl** („RoleNote" nad zápasem). Kdo tě vede, prestiž klubu,
  očekávané umístění a dosah reputace se v sezóně nemění → jsou v Profilu (`EngagementNote`), ne nad
  každým zápasem; **přehled manažera** (jméno/reputace/rekordy) je jen v Profilu, jinde byl duplicita.
  Konec sezóny → hodnocení (`seasonHeadline`/`seasonTone`) + změna reputace
  (vč. bonusu za splněný cíl); pak **Pokračovat s klubem** (drift) nebo **Změnit tým** = job market
  (`isHireable`). **Start kariéry** je gated: nová kariéra startuje na `STARTING_REPUTATION` (~30) →
  první výběr klubu jde jen po `isHireable` (ne rovnou top klub).
- **Sestup/postup mezi 1. a 2. ligou** (`nextTransition` v `leagues.ts`, čisté + testy): konec sezóny
  vyhodnotí přechod — **nejvyšší liga Top-5 + sestup → reálná 2. liga** (`SECOND_TIERS`: Championship 40,
  LaLiga 2 141, Serie B 136, 2.BL 79, Ligue 2 62; navázané na svou nejvyšší přes `firstTierId`,
  `promoSpots=2`), **2. liga + postupová zóna (top 2) → zpět nahoru**, **2. liga/sestup nebo malá liga
  bez modelu 2. ligy → vyhazov** (`sacked` → nucený job market, žádné „Pokračovat"). `evaluateSeason`
  vrací i `promoted` (jen 2. liga; Evropa z 2. ligy = vždy `NONE`); `seasonObjective` ve 2. lize míří na
  postup, ale zná i **záchranu** (kariéru lze ve 2. lize začít se slabým klubem → outsider nesmí
  dostat cíl „zabojuj o postup — skonči 21."). Přechod nahoru/dolů dotáhne UI (`SeasonDone.moveTo` → `/api/game/league?id=` s 2. ligami v
  allowlistu `SECOND_TIER_IDS`) a **vloží tvůj klub s jeho ratingy** do cílové ligy (`injectYourTeam` —
  soupeři z reálné tabulky, tvůj tým bez přepočtu spreadem, sudý počet pro `roundRobin`). Tabulka
  zvýrazňuje **postupovou zónu** (positive) vedle sestupové. **Pojistka proti uvíznutí kariéry:**
  `isHireable` bere kluby s prestiží ≤ `MIN_HIREABLE_PRESTIGE` (40) **vždy** → po sérii sestupů existuje
  klub k převzetí. Postup dá reputační bonus (`PROMOTION_REP`) + achievement „Návrat mezi elitu".
- **Trvalý manažerský profil (síň slávy)** (`lib/game/profile.ts` + `lib/game/achievements.ts`,
  čisté + testy): profil (`ManagerProfile{allTime:AllTimeRecords, achievements}`) **přežívá „Novou
  kariéru"** (meta-progrese) — reset ukončí jen aktuální běh (`current:null`, `history:[]`, reputace),
  profil zůstane. `foldSeason` inkrementálně skládá trvalé rekordy (tituly, nejlepší umístění, max
  bodů/gólů, nejvyšší reputace, lig trénováno, neporažené sezóny) po každé dohrané sezóně
  (`finishAndAdvance`). **Achievementy** (~16, `ACHIEVEMENTS` + `evaluateAchievements`/`newlyEarned`,
  bronze/silver/gold) se vyhodnocují na konci sezóny nad `allTime`+poslední sezónou+reputací a ukládají
  trvale. Reputace zůstává **per-kariéra** (žádné lifetime skóre).
- **Perzistence = profil (DB), přihlášení povinné.** Tabulka `GameSave` (`userId @id`, `state Json`).
  API `app/api/game/route.ts`: `GET`/`PUT` (upsert, zod validace vč. `profile`/`plan`/`instruction`/
  `morale`/`fitness`/`scouting`/… + `current` nullable + size cap 512 KB + rate-limit; ukládá **původní**
  objekt)/`DELETE`. `app/api/game/leagues` + `app/api/game/league?id=`. `SaveState` = `{version,
  profile:ManagerProfile, manager:{reputation}, current:SeasonState|null, history[]}`;
  `SAVE_VERSION` = **9**. Appka běží živě → bump **nesmí zahodit rozehranou kariéru**: `migrateSave`
  (`HraApp.tsx`) migruje **řetězeně** (5 → 6 → 7 → 8 → 9) a jen doplní nová pole; teprve neznámá verze se
  zahodí. „Nová kariéra" nemaže profil (jen `current:null`).
- **UI `HraApp.tsx`** (client, mobile-first): anonym → přihlášení; **bez aktivní kariéry → `ManagerHub`**
  (profil + „Začni kariéru" → gated výběr ligy→klubu, sekce „Nejvyšší ligy" / „2. ligy"); s kariérou →
  sezóna (predikce + **scouting** (`ScoutCard`: hlášený styl / „styl neznámý", konfidence obarvená dle
  `quality`, odhalené traity, u `detailed` řádek „🎯 Skauti radí") + **morálka** + **kondice**
  (`FitnessBar`, ukazuje i posun kondice za kolo dle plánu) + **„Čísla soupeře"** (`EvidencePanel`) +
  **plán** + **vedlejší instrukce**
  (`InstructionPicker`) + **event karta**, popup `MatchResultToast`, tabulka, forma, cíl) +
  taby **Kariéra** a **Profil**. `ProfilePanel` (sdílený hub/tab): hlavička + kariérní rekordy +
  **klub vs reprezentace** (reprezentace = placeholder „🔜 připravujeme", Phase 4) + `AchievementsGrid`
  (odemčené barevně dle tier, zamčené šedé). `SeasonDone` ukazuje nově odemčené („🏅 Odemčeno") a
  **`DevelopmentPanel`** (rozdělení rozvojových bodů před „Pokračovat"/postupem/sestupem).
  Ligová tabulka **zvýrazňuje pohárové/postupové/sestupové zóny** (barevný okraj + legenda, přes
  `evaluateSeason`/`EUROPE_LABEL`: LM=home, EL=away, KL/postup=positive, sestup=negative; legenda
  dedupuje podle **popisku**, ne klíče – Francie má 1.–2. „LM" a 3. „LM (předkolo)" pod týmž klíčem).
  Historie kariéry ukazuje u sezóny **jen logo klubu** (`TeamLogo`, název v `title`) + ligu +
  **reputační zisk/ztrátu** (`reputationDeltas`). Kariérní statistiky mají i **Postupy**.
  `app/hra/`, nav 🎮, sitemap.
- **Domácí výhoda** (`homeBoost` na `GameTeam`, jediné místo použití = `matchLambdas`):
  per-tým číslo, **ne globální konstanta a ne `SideAdjust`** — má ho i AI. Je to **poměr reálných
  gólů** (domácí góly/zápas ÷ celkové góly/zápas; u mocku náhodné `1.05–1.15`), který
  `homeAdvantage` převede na **aditivní posun λ v gólech**:
  `λ_domácích += (hb−1)·HOME_ADV_SCALE`, `λ_hostů −= (hb−1)·HOME_ADV_SCALE·HOME_DEFENSE_SHARE`.
  Typický tým (`hb` 1.10) → +0.20 gólu domácím, −0.14 hostům. Laděno gridem přes všechny
  uspořádané dvojice ligy (= co dvoukolový round-robin odehraje). Dnes **44,8/24,3/30,9 %**
  při ⌀ 3,03 gólu; dřív 38,6/25,3/36,1 → domácí měli jen +2,5 p.b. místo reálných ~+15.
  - **Proč aditivně, ne násobičem ratingů.** Multiplikativní verze (útok ×mult, obdržené ÷mult)
    sice 45/25/30 trefila, ale doma se útok NÁSOBIL a obrana DĚLILA → `∂λ/∂útok` zesílené,
    `∂λ/∂obrana` tlumené. Investice do útoku byla proto strukturálně výnosnější (+1.16 vs +0.84
    bodu za sezónu) a **žádná hodnota `DEV_DEFENSE_STEP` to nespravila** (ověřeno gridem
    0.08/0.10/0.12). Aditivně je `∂λ/∂rating = 1/2` pro obě strany i oba typy zápasů → parita
    (+1.02 vs +0.95, kryto testem „λ-parita"). Sedí to i na to, jak se domácí výhoda reálně
    měří (~+0,35 gólu), a dá realističtější počet gólů.
  - **Bonus nesmí záviset na ratingu týmu.** Kdyby se násobil útokem, asymetrie se vrátí.
  - **`homeBoost` se počítá z hrubých gólů, ne z ratingů** (`standingsToTeams`) → `amplifySpread`
    na něj nesmí sáhnout. Kdyby se dělil post-spread útokem, dostaly by slabé týmy (kterým spread
    útok stlačí) nejvyšší poměr: v lize, kde všichni doma dávají +18 %, by nejlepší tým dostal
    +0.26 gólu a nejhorší +0.50. Kryto testem („nekoreluje se silou týmu").
  - **`HOME_BOOST_CAP` (1.25) je jediný zdroj pravdy** — platí pro odvození z reálné tabulky,
    pro investice do stadionu i jako pojistka v `matchLambdas` (starý save / ručně upravená data).
- **Rozvoj klubu mezi sezónami** (`lib/game/development.ts`, čisté + testy; laděno `npm run sim-game`):
  za dohranou sezónu dostaneš **rozvojové body** (`developmentPoints`: percentil umístění + splněný
  cíl + titul/Evropa/postup + reputace ≥ 65, sestup ubírá, `devBonus` z eventů) a rozdělíš je mezi
  **útok / obranu / mládež / stadion / skauting** (`DevSpend`, UI `DevelopmentPanel` v `SeasonDone`).
  Progrese je záměrně pomalá — **jedna dobrá sezóna nesmí udělat top tým**. Drží to tři stropy:
  `MAX_DEV_POINTS` (6/sezónu), malý zisk na bod (`DEV_ATTACK_STEP` 0.08) a `DEV_LEAGUE_CEILING`
  (nesmíš přeskočit špičku ligy o víc než 5 %). Empiricky: ze středu 20týmové ligy do Evropy kolem
  5.–6. sezóny, medián prvního titulu 7.–8. sezóna; **bez rozvoje** tým visí na ~10. místě napořád.
  Nevyužité body propadají; při **změně klubu** se ztrácí mládež i skauting (patří klubu).
  Postup/sestup si klub bereš s sebou → investice, mládež i skauti jdou s ním.
  - **Skauting je jediná oblast, která nesahá na λ** (`SeasonState.scouting`, `nextScouting`,
    strop `SCOUT_LEVEL_MAX` 5). Kupuje **informaci**: `SCOUT_LEVEL_STEP` (0.04/bod) zvedá konfidenci
    hlášení. Bez investice se hráč nikdy nedostane na `detailed` (strop je 0.45 + vzorek 0.25 +
    odveta 0.08 = 0.78) → **doporučení skautů je odměna za investici**. `applyDevelopment` ho proto
    ignoruje a `sim-game` sekce 4 ho **nezměří** (nemá λ efekt) — ladí se playtestem.
  - Oblasti se liší **výnosem i trvanlivostí** (mezní hodnota 1 bodu, průměrný tým, 19+19 zápasů):
    útok **+1.02 b/sezónu**, obrana **+0.95**, stadion **+0.43 — zato navždy** (drift `homeBoost`
    neregreduje, na rozdíl od útoku/obrany). Mládež (`youthRegression`) je podpůrná: sama o sobě
    nic nedá, jen tlumí mezisezónní propad. Stadion je **konečná** investice: 1.10 → `HOME_BOOST_CAP`
    stojí 15 bodů (≈ 4 sezóny) a dá +6.2 b/sezónu natrvalo, pak je hotový (UI další body nepustí,
    jinak by je `applyDevelopment` tiše ořízl).
  - **Útok vs obrana:** λ-parita kroků (`DEV_ATTACK_STEP == DEV_DEFENSE_STEP`) sama nestačila —
    dokud byla domácí výhoda multiplikativní, byl útok o ~38 % výnosnější bez ohledu na krok.
    Rozhodla až **aditivní domácí výhoda**. Dnes `sim-game` sekce 4 (vše do jedné oblasti,
    12 sezón): útok Ø 3.9. místo / 85 titulů, obrana Ø 5.2. / 32, stadion Ø 6.4. / 16.
    Zbylý náskok útoku je **fyzikální**: `DEV_LEAGUE_CEILING` dá průměrnému týmu 14 bodů prostoru
    v útoku, ale jen 10 v obraně — obranu zdola omezuje nula, útok shora nic.
- **`driftTeams` (`career.ts`) — tři opravené chyby.** Mezisezónní drift teď regreduje ke
  **skutečnému průměru ligy** (dřív ke konstantě 1.65 = středu generovaného rozsahu, což reálným
  ligám s průměrem ~1.35 každou sezónu nafukovalo útok), **nevolá `amplifySpread`** (ten patří jen
  na čerstvě postavenou ligu; ×1.35 každou sezónu proti regresi ×0.9 = net ×1.215 → liga se za
  ~10 sezón polarizovala do clampů, std útoku 0.56 → 0.91) a clampuje na `SPREAD_*` meze místo
  `ATTACK_MIN/MAX` (ty ořezávaly reálné špičky nad 2.35). Místo re-amplifikace se po driftu
  **renormalizuje na původní průměr a rozptyl**; teprve pak se aplikují tvoje investice (ty mají
  rozptyl posunout). AI týmy dostaly výkonovou zpětnou vazbu (`DRIFT_PERFORMANCE`).
  `startNextSeason` navíc **předává `leagueAccess`** — dřív ho zahodil, takže od 2. sezóny se
  tiše přepnulo na kurátorovaný fallback (odtud „jedna sezóna vypadala správně, další ne").
- **Tři páky navíc k zápasovému plánu** (všechny míří na to, aby nebyl zjevně nejlepší tah):
  - **Kondice** (`fitness.ts`, `SeasonState.fitness` 0–100, start 100): `press`/`open` unavují víc
    (`PLAN_FATIGUE` 8), než stihne `FITNESS_RECOVERY` (5) doplnit; `low_block` regeneruje.
    `fitnessFactor` = **jen postih** (plná kondice 1.0, nula 0.9), skládá se jako morálka
    (útok ×, obdržené ÷). „Vždycky presuj" tím přestane být zadarmo.
  - **Scouting = škála od mlhy k jistotě** (`scouting.ts`). `scoutOpponent` vrací **dvě vrstvy**:
    pravdu (`style`, `traits` – čte je `resolvePlan`/`resolveInstruction`) a hlášení
    (`reportedStyle`, `reportedTraits` – jen ty patří do UI). Konfidence **není konstanta**
    (dřív fixních 0.75 → scouting byl dekorace): `scoutConfidence` = `SCOUT_CONFIDENCE_MIN` (0.45)
    + vzorek odehraných zápasů soupeře (max +0.25) + odveta `hasMet` (+0.08) + investice
    (`scouting × 0.04`), strop 0.95. Event „Nabídka skautského týmu" ji na pár kol vytáhne rovnou
    na strop (`scoutBoostUntilRound`). V turnaji vychází nízká sama (soupeř má 0–3 zápasy) →
    **žádná speciální větev**; `AgencyState.scouting?` je volitelné jako `youth?`.
    - Z konfidence plyne `ScoutQuality`: **`vague`** (< 0.60) styl vůbec neurčí (`reportedStyle:
      null`), **`standard`** (< 0.85) zašuměné hlášení, **`detailed`** = hlášení + **doporučený
      protitah** (`suggestion` = `recommendPlan(reportedStyle)` + `recommendInstruction(reportedTraits)`).
      Doporučení se staví **z hlášení, ne z pravdy** → nejde jím obejít nejistotu (kryto testem).
    - **Traity nikdy nelžou, jen nemusí být vidět.** `reportedTraits ⊆ traits` podle *síly* traitu
      (`SCOUT_REVEAL_VAGUE` 0.6 / `SCOUT_REVEAL_STANDARD` 0.25), deterministicky a **bez dalšího RNG**.
      Skrytý `punishedBy` trait tě pokousá → **instrukce přestala být jistota** (dřív byla: šum
      dostával jen styl). Tím má stejnou míru nejistoty jako counter plánu.
    - Šum stylu je deterministický dle `(seed, kolo, soupeř)` (vlastní RNG stream, salt 70000) →
      stabilní přes rendery i reload.
  - **Vedlejší instrukce** (`instructions.ts`, `Instruction`): druhá volba vedle plánu, která čte
    **dřív mechanicky mrtvé `scout.traits`** (do `resolvePlan` šel jen `style`). Správná instrukce
    proti odpovídajícímu traitu = bonus, špatná = postih; efekt ±5 % (menší než ±10 % u counteru).
  - **Anti-exploit:** `yourNextMatch` počítá náhled predikce s `("balanced", "none")` → plán ani
    instrukci nejde proklikat a vzít nejvyšší %. Morálka/kondice/eventové modifikátory se ukázat
    smí (hráč je v tu chvíli nezmění). Kryto testem.
  - **Pozor na stropy:** `ADJUST_MIN/MAX = 0.7/1.4` je dosažitelný už při plán × counter × morálka
    × 2 eventy. Přidávání dalších násobících pák tlačí kombinace do clampu, kde volby přestanou být
    cítit → držet efekty malé, **neroztahovat clamp**. `npm run sim-game` clamp měří (dnes ~0.1 %).
- **Eventy** (`events.ts`, 23): `EVENT_CHANCE = 0.3` na kolo, losuje se **jen z eventů se splněnou
  `condition`** (dřív uniformně ze všech → „Krizová porada" padala i ve vítězné sérii). Volba dá
  morálku / kondici / `devBonus` / scout boost a/nebo `Modifier{attack?, concede?, untilRound}` =
  násobič λ na 1–3 kola (multiplikativně s plánem, counterem, instrukcí, morálkou i kondicí;
  prořezává se v `playRound`). Sada je vyvážená tak, že **žádná volba není zadarmo lepší** — dřív
  `derby_motivation` A dával +5 morálky *i* +6 % útoku bez postihu, `captain_dispute` A a
  `fan_protest` A byly čistě ztrátové. Kryto testem („zisk bez ceny"). `events.ts` **nesmí
  importovat `analysis.ts`** (to importuje `engine.ts` → cyklus) – formu si počítá lokálně.
  **Číselné efekty na kartě:** `describeEffect(effect)` rozloží volbu na barevné chip-y
  (Morálka +7 / Útok +6 % · 2 kola / Obrana pevnější / Kondice −8 / Scouting jistější / ±rozvojový
  bod; `concede<1` = dobré, `>1` = špatné) → `EventCard` je zobrazuje, hráč nevybírá naslepo.
- **Panel „Čísla soupeře"** (`EvidencePanel` v `HraApp.tsx`, dřív „Analýza sezóny") = **objektivní
  protiváha skautskému hlášení**. `scoutOpponent` odvozuje styl z útoku/obrany soupeře vůči ligovému
  průměru, ale hlásí ho zašuměně → panel ukazuje **tatáž čísla**, aby si je hráč mohl ověřit sám:
  Ø vstřelené / Ø obdržené **ve venue tohoto zápasu** (`venueStats` – ty doma × soupeř venku, dřív
  mrtvá pole `homeAvgFor`/`awayAvgFor`) porovnané s `leagueGoalsPerTeamGame`, + forma a velikost
  vzorku (ta koresponduje s konfidencí). Pozice, body a čistá konta z panelu **zmizely** – s volbou
  taktiky nesouvisí a duplikovaly tabulku. Panel je jen v lize (`analysis.ts` importuje `engine.ts`).
- **Turnajové jádro** (`lib/game/tournament.ts`, čisté + `tournament.test.ts`; sdílené pro
  reprezentační turnaje i budoucí klubový pohár): skupiny + vyřazovací pavouk, deterministické
  dle seedu, **offline**. Formáty `EURO_FORMAT` (6×4, top 2 + 4 nejlepší třetí = 16 → osmifinále)
  a `WORLD_CUP_FORMAT` (12×4, top 2 + 8 třetích = 32 → šestnáctifinále). Agency (plán, counter,
  instrukce, morálka, kondice, eventy) běží beze změny přes `AgencyState`; AI jede `NEUTRAL_ADJUST`.
  - **Neutrální půda zadarmo:** `homeBoost: 1` → `homeAdvantage(1) === {0, 0}`, takže `homeId`/
    `awayId` ve skupině je jen nominální. Pořadatel může mít `homeBoost > 1` a výhodu dostane.
  - **`singleRoundRobin`** (`schedule.ts`) vytknuto z `roundRobin` – skupina 4 týmů = 3 kola po
    2 zápasech. `roundRobin` z něj skládá dvoukolový rozpis přidáním zrcadla.
  - **`groupTable`** (`standings.ts`): body → **vzájemné zápasy** → gólový rozdíl → vstřelené →
    **seedovaný los**. Ligový `buildTable` řadí při shodě podle `teamId` — ve skupině o 3 kolech
    by o postupu rozhodovalo databázové id. Řadí se **po blocích stejného počtu bodů**, ne jedním
    komparátorem: minitabulka vzájemných zápasů nemusí být tranzitivní (trojitá shoda A>B>C>A)
    a nekonzistentní komparátor by ve V8 vrátil libovolné pořadí. Los má klíč
    `deriveSeed(deriveSeed(seed, salt), teamId)`, takže **nezávisí na pořadí vstupu**.
  - **`bracketSeedOrder`**: rekurzivní klíč pavouka (`[1,2]` → `[1,4,2,3]` → `[1,8,4,5,2,7,3,6]`).
    Naivní `1v16, 2v15, …` s párováním sousedních vítězů by poslalo jedničku na dvojku už ve
    čtvrtfinále. `seedBracket` se navíc snaží vyhnout odvetě ze stejné skupiny v prvním kole.
  - **`playKnockoutTie`** nikdy nevrátí remízu: 90 min → prodloužení (`matchLambdas(…, lambdaScale)`
    škáluje **celou** λ včetně domácího bonusu, `EXTRA_TIME_LAMBDA = 30/90`) → penalty (vážený los,
    `p = 0.5 + PENALTY_ATTACK_WEIGHT × Δútok`, clamp `±PENALTY_MAX_EDGE` — rozstřel kvalitou
    rozhodnutý skoro není). Empiricky **~25 % KO zápasů do prodloužení, ~12 % na penalty** — sedí realitě.
  - `yourStage` = „kam jsi to dotáhl" (mistr má `"final"`, ne `"done"`); titul se pozná
    z `champion === yourTeamId`. Vypadnutí neukončí turnaj — dohraje se, aby byl znám mistr.
  - **Pole se ZÁMĚRNĚ neroztahuje `amplifySpread`** — `SPREAD = 1.35` je kalibrovaný na 20týmovou
    ligu; reprezentační pole je už seříznuté kvalifikací a ratingy jdou z reálných dat.
  - `npm run sim-game` sekce 5 měří titul favorita (turnaj je loterie: Euro ~15–23 %, MS ~9 %)
    a poměr prodloužení/penalt. Malý počet běhů = velký šum.
- **Reprezentační turnaje (Euro/MS) — HOTOVO** (`lib/game/nationalCompetitions.ts`, čisté +
  `nationalCompetitions.test.ts`/`nationalCareer.test.ts`): samostatný režim vedle klubové
  kariéry, **sdílená reputace** (buduje se napříč turnaji, nereset jako klub). Vedeš buď klub,
  nebo reprezentaci — invariant `SaveState.current` XOR `SaveState.tournament`.
  - **Registr `COMPETITIONS`** = EURO (24, jen UEFA, host Německo) + WC (48, kvóty per
    konfederace UEFA 16 / CONMEBOL 6 / CAF 9 / AFC 9 / CONCACAF 7 / OFC 1 = 48, host USA).
    Kvóty se sečtou **přesně na velikost pole**; MS je vědomé zaokrouhlení (reálně 46 + hostitelé).
  - **Kvalifikace = vědomé zjednodušení** (reálné formáty se cyklus od cyklu mění): hráč hraje
    JEDNU skupinu své konfederace 6 týmů **dvoukolově doma/venku** (tady `homeBoost` = `QUAL_HOME_BOOST`
    dává smysl, ne 1 jako v turnaji), postup do `QUAL_ADVANCE` (3.) místa. Soupeři stratifikovaně
    dle síly (ne celá slabá/silná skupina). **Ostatní místa** (jiné konfederace + doplnění té tvé)
    obsadí **los vážený ratingem** s garancí pořadatele a postupujících z tvé skupiny.
  - **`TournamentRun`** orchestruje fáze `qualification → final → done`: `playRunRound` odehraje
    kolo kvalifikace, po jejím dohrání postaví pole (`buildTournamentField`) a buď spustí závěrečný
    turnaj (`newTournament`, reuse `tournament.ts`), nebo skončí (nekvalifikoval ses). Agency
    (plán/counter/instrukce/morálka/kondice/eventy) běží beze změny přes `AgencyState`; kvalifikace
    má vlastní RNG proud (`RNG_SALT_QUALIFICATION`), ať kolo 0 kvalifikace ≠ kolo 0 turnaje.
  - **Past (opravená, kryto testem):** konfederace s méně místy než počet garantovaných
    postupujících (OFC = 1 místo, ale garantujeme 3 z tvé skupiny) dřív oříznutím na `slots`
    vyhodila i kvalifikovaného HRÁČE z pole → crash v `newTournament`. Fix: v garancích je **TY
    první**, takže tě malá kvóta nikdy nevyhodí.
  - **Kariéra/profil:** `summarizeRun` → `TournamentSummary` (agreguje kvalifikaci i turnaj),
    `foldTournament` plní **vlastní pole** `AllTimeRecords` (`tournamentsPlayed`/`majorTitles`/
    `finalsReached`/`nationsCoached`) — NErecykluje `SeasonSummary` (`champion:true` z poháru by
    rozbil ligové `titles`). `updateReputationTournament` (paralelní k `updateReputation`).
    Druhý registr `TOURNAMENT_ACHIEVEMENTS` + `newlyEarnedTournament`; `owned:Set<string>` pokryje
    oba registry, sloučí se v `ALL_ACHIEVEMENTS` (UI grid). `SaveState.tournament`/`tournamentHistory`
    (`import type` v types.ts = bez runtime cyklu), `SAVE_VERSION` beze změny (pole nullable,
    čtou se s `?? null`/`?? []`).
  - **UI:** rozcestník Klub/Reprezentace v `ManagerHub`, `NationPicker` (soutěž + národ gated
    reputací, pořadatel označen), `TournamentView` (kvalifikace/skupina/pavouk + `TournamentNextMatch`
    s celou agency, `MiniTable` postupová zóna, „Tvoje cesta pavoukem"), `TournamentDone`,
    `ProfilePanel` skutečné reprezentační rekordy.
- **Paralelní kariéra klub + reprezentace** (`HraApp.tsx`): invariant `current` XOR `tournament`
  **zrušen** — klubová sezóna a reprezentační běh běží současně. `ModeBar` (Klub/Reprezentace) se
  ukáže když existují oba; `mode = hasClub&&hasNation ? careerMode : …`. Vstup do druhé z běžící
  kariéry přes `PickerScreen` (`picking` stav; tlačítko „🌐 Repre" v `GameView` / „🏟️ Klub" v
  `TournamentView`). Per-kariéra `onEndClub`/`onEndNation` (uvolní slot, reputace + síň slávy
  zůstanou; opuštěná reprezentace se NEfolduje) vs. `onReset` = „Nová kariéra od nuly" (smaže obě +
  reputaci). `startGame`/`startTournament` už reputaci NEresetují (sdílená, `prev?.manager.reputation`).
  - **Sdílená reputace se stropem úrovně** (uživatelův požadavek): reputace se buduje napříč klubem
    i reprezentací, ALE `applyCeiling` (`reputation.ts`) drží **kladné** přírůstky pod
    `prestiž vedeného týmu + REP_CEILING_MARGIN` (12). Empiricky: 20 titulů se Spartou (prestiž ~60)
    → strop reputace ~72 → Španělsko (prestiž 95, brána ~91) zůstane „🔒 mimo dosah"; k elitě se
    musíš propracovat přes silnější klub (prestiž ~92 → reputace 100). Prestiž se nese na summary
    (`SeasonSummary.yourPrestige` = `teamPrestige`, `TournamentSummary.teamPrestige` = `nationPrestige`,
    fallback bez ní = strop 100). Ladicí konstanta – `sim-game` reputaci mezi ligami neměří.
- **Přehled klubu** (`ClubOverview` v záložce Sezóna): síla útoku/obrany vs ⌀ ligy (barevně), hvězdy,
  stadion jako progres ke `HOME_BOOST_CAP` (**trvalý, neregreduje**), mládež, skauting + legenda co mezi
  sezónami regreduje. Čistě čte `SeasonState`. `DEV_AREA_HINT` texty zpřesněny o trvanlivost.
- **Historie v profilu:** `ProfilePanel` ukazuje `SeasonRows` (klubové sezóny, vytknuto z `HistoryView`)
  i `TournamentRows` (reprezentační turnaje z `tournamentHistory`) — v Profil tabu klubu, v `ManagerHub`
  i přes přepínač „Profil" v `TournamentView` (jinak by národní režim profil neměl).
- **Napínavější odhalení výsledku** (`MatchResultToast`): dvoufázové — zapečetěná obálka (soupeř +
  tlukoucí „?–?" **bez barvy výsledku**), skóre se po ~1,1 s samo odhalí `reveal-pop` animací
  (globals.css) nebo klepnutím. Remount přes `key={toastSeq}` (žádný `setState` v effectu).
- **Reprezentační achievementy** (12 v `TOURNAMENT_ACHIEVEMENTS`): vč. „David proti Goliášovi"
  (semifinále s prestiží ≤ 65 — čte `TournamentSummary.teamPrestige`), „Neporažený mistr", „Ofenzivní
  smršť" (15+ gólů), „Kočovný selektor" (5 národů). Slučují se s ligovými v `ALL_ACHIEVEMENTS`.
- **Možná rozšíření (TODO):** klubový pohár / Liga mistrů (znovupoužije `tournament.ts`);
  víc soutěží (Copa/AFCON…) = položka v `COMPETITIONS`.
- Vědomá výjimka ze scope „jen statistiky" (nová tabulka/modul), jako predikce a přestupy.

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
  zařízení (Safari Web Inspector). **Pozn.:** pravděpodobně nepatří k Manažerovi
  (`HraApp.tsx` nemá žádný `<select>`/`<input>`, výběr ligy/klubu jsou čistá tlačítka) –
  hledat spíš ve výběru týmu v `/porovnani` nebo `/predikce`.

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
