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
- **Čisté jádro `lib/game/`** (na zdroji nezávislé jako `lib/picks/`, testy `game.test.ts`):
  `simulate.ts` (`matchLambdas`/`predictProbs`/`simulateMatch` staví normalizovanou mřížku z
  **reused** `poissonVector`+`drawTau`; přijímá per-stranu `SideAdjust{attack,concede}`, AI =
  `NEUTRAL_ADJUST`), `teams.ts` (`generateLeague`+`standingsToTeams`+`amplifySpread`), `schedule.ts`
  (`roundRobin`), `standings.ts` (`buildTable`), `engine.ts` (`newSeason`/`setPlan`/`playRound`/
  `simulateToEnd`/`yourNextMatch`+`resolveYourAdjust` = plán×counter×morálka×eventy, **per-kolo RNG**
  `deriveSeed(seed,round)`), `career.ts` (`summarizeSeason` vč. `objectiveMet`, `startNextSeason`
  s driftem, `careerStats`), `leagues.ts` (prestiž, `evaluateSeason`, `LEAGUE_ACCESS`, `leagueStars`,
  `seasonObjective`), `reputation.ts` (`updateReputation` dle příčky+over/under-performance+**cíle**,
  `isHireable`/`expectedRank`/`HIRE_MARGIN`), `analysis.ts` (`teamSeasonStats`), `balance.ts`
  (**laditelné konstanty**).
- **Manažerská agency (Phase 2):** `scouting.ts` (`scoutOpponent` → styl attacking/defensive/balanced
  + traity + CZ popis), `plans.ts` (5 plánů `balanced/open/low_block/press/counter`, `resolvePlan(plan,
  oppStyle)` = base × counter; správný protitah = výhoda, špatný = postih, ±`COUNTER_*`), `morale.ts`
  (`moraleFactor` ±6 % λ, `updateMorale` po kole dle výsledku+překvapení), `events.ts` (deterministické
  eventy dle `(seed,round)`, `maybeEvent`/`applyEventChoice` → morálka / dočasný `Modifier{untilRound}`).
  `SeasonState` nese `plan`/`morale`/`objective`/`modifiers`/`pendingEvent`. Empiricky: adaptivní plán
  ~+2.4 b/sezónu vs vždy balanced (znatelné, ne overpowered).
- **Kariéra + role:** UI ukazuje **profil trenéra** + „RoleNote" (koho vedeš, prestiž, očekávání, dosah
  reputace, **sezónní cíl**). Konec sezóny → hodnocení (`seasonHeadline`/`seasonTone`) + změna reputace
  (vč. bonusu za splněný cíl); pak **Pokračovat s klubem** (drift) nebo **Změnit tým** = job market
  (`isHireable`). **Start kariéry** je gated: nová kariéra startuje na `STARTING_REPUTATION` (~30) →
  první výběr klubu jde jen po `isHireable` (ne rovnou top klub).
- **Trvalý manažerský profil (síň slávy)** (`lib/game/profile.ts` + `lib/game/achievements.ts`,
  čisté + testy): profil (`ManagerProfile{allTime:AllTimeRecords, achievements}`) **přežívá „Novou
  kariéru"** (meta-progrese) — reset ukončí jen aktuální běh (`current:null`, `history:[]`, reputace),
  profil zůstane. `foldSeason` inkrementálně skládá trvalé rekordy (tituly, nejlepší umístění, max
  bodů/gólů, nejvyšší reputace, lig trénováno, neporažené sezóny) po každé dohrané sezóně
  (`finishAndAdvance`). **Achievementy** (~16, `ACHIEVEMENTS` + `evaluateAchievements`/`newlyEarned`,
  bronze/silver/gold) se vyhodnocují na konci sezóny nad `allTime`+poslední sezónou+reputací a ukládají
  trvale. Reputace zůstává **per-kariéra** (žádné lifetime skóre).
- **Perzistence = profil (DB), přihlášení povinné.** Tabulka `GameSave` (`userId @id`, `state Json`).
  API `app/api/game/route.ts`: `GET`/`PUT` (upsert, zod validace vč. `profile`/`plan`/`morale`/… +
  `current` nullable + size cap 512 KB + rate-limit; ukládá **původní** objekt)/`DELETE`.
  `app/api/game/leagues` + `app/api/game/league?id=`. `SaveState` = `{version, profile:ManagerProfile,
  manager:{reputation}, current:SeasonState|null, history[]}`; `SAVE_VERSION` bump = zahodit
  nekompatibilní save (aktuálně **5**). „Nová kariéra" už nemaže profil (jen `current:null`).
- **UI `HraApp.tsx`** (client, mobile-first): anonym → přihlášení; **bez aktivní kariéry → `ManagerHub`**
  (profil + „Začni kariéru" → gated výběr ligy→klubu); s kariérou → sezóna (predikce + **scouting** +
  **morálka** + analýza + **plán** + **event karta**, popup `MatchResultToast`, tabulka, forma, cíl) +
  taby **Kariéra** a **Profil**. `ProfilePanel` (sdílený hub/tab): hlavička + kariérní rekordy +
  **klub vs reprezentace** (reprezentace = placeholder „🔜 připravujeme", Phase 4) + `AchievementsGrid`
  (odemčené barevně dle tier, zamčené šedé). `SeasonDone` ukazuje nově odemčené („🏅 Odemčeno").
  Ligová tabulka **zvýrazňuje pohárové/sestupové zóny** (barevný okraj + legenda, přes `evaluateSeason`/
  `EUROPE_LABEL`: LM=home, EL=away, KL=positive, sestup=negative). Historie kariéry ukazuje u sezóny
  **reputační zisk/ztrátu** (`reputationDeltas`). Reálná loga přes `TeamLogo`. `app/hra/`, nav 🎮, sitemap.
- **Možná rozšíření (TODO):** Phase 3 (refaktor SaveState + klubový pohár/Liga mistrů) a Phase 4
  (reprezentační pohár Euro/MS) z roadmapy; dále rozpočet.
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
