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
  V/R/P, BTTS i Over 2.5 se počítají z téže opravené mřížky. Chybí-li gólová i xG data,
  vrací `available:false` (UI zobrazí „nedostatek dat", ne falešnou 50/50). UI `MatchPrediction.tsx`.
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
  řádky v `PicksApp` nemají proklik na plné porovnání (cross-konfederační deep-link by nesedl;
  detekce přes `isNationalTournamentLeague`).
- **Výběr tipů** (`lib/picks/rules.ts`, čisté + testy): `evaluateRule`/`filterPicks` nad
  `PredictionRow`; pravidlo `PickRule{market: win|over25|btts, venue, minProb}` (sdílené
  `ruleSchema`), presety `PICK_PRESETS`. API `app/api/picks` (nadcházející tipy; PRO přes
  `getEntitlement`, FREE→`{locked}`), `app/api/picks/stats` (`lib/picks/trackRecord.ts`:
  `computeTrackRecord` = globální track-record + `backtestRule` = backtest navoleného
  pravidla nad historií = úspěšnost „kdybys takhle sázel"). UI `PicksApp.tsx`.
- **Kalibrace:** `npm run calibrate` (`scripts/calibrate.ts`) = MLE `DC_RHO` z odehraných
  predikcí (reuse exportů `drawTau`/`poissonVector`) + Brier/log-loss. Ladění = ruční
  úprava `DC_RHO` v `predict.ts` + bump `MODEL_VERSION` (`predictions.ts`). Počítá **jen
  z `modelVersion=MODEL_VERSION`** (kalibrace je per verzi modelu) a chce **≥30 odehraných**
  predikcí, jinak je výsledek orientační. `DC_RHO` je zatím publikovaný default −0.13
  (Dixon–Coles 1997), nekalibrovaný na vlastních datech – čeká na dost settlnutých predikcí
  (první dataset se sbírá z MS 2026; settle dělá cron `settle-results`).
- **Mock režim:** `lib/data/mock/predictions.ts` (generátor) → záložka funguje i bez DB/API.
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

- **TODO: Benchmark predikcí vs. API-Football (interní měření přesnosti).** Cíl: poprvé
  zjistit, jestli náš Poisson+Dixon–Coles model poráží/prohrává s vlastními predikcemi
  API-Footballu. **Ne** produkční model – jen **interní srovnávací sloupec**, nikdy se
  nevystavuje ve FREE/PRO API a **nedotýká se `compareTeams`** (jádro zůstává čisté).
  Rozsah = **1X2** (home/draw/away). Over 2.5 / BTTS vědomě vynechat – API je dává jen
  jako volný text (`advice`/`under_over`), parsing by zanesl víc šumu než hodnoty.
  - **Co API vrací** (`/predictions?fixture=ID`): `percent.home/draw/away` jako řetězce
    `"45%"` → parsnout na 0.45 + normalizovat na součet 1. `goals`/`advice`/`winner`
    nepoužívat. Prázdná `response` (časté mimo top-5) → benchmark nedostupný.
  - **Krok 1 – schéma** (`prisma/schema.prisma`, model `FixturePrediction`): přidat
    **nullable** sloupce (paralelní benchmark na témže řádku → `settle-results` doplní
    výsledek 1× a skóruje oba modely zadarmo; nullable = `prisma db push` nedestruktivní):
    `benchAvailable Boolean @default(false)`, `benchHomeWin/benchDraw/benchAwayWin Float?`,
    `benchFetchedAt DateTime?`. Pak `npx prisma db push` (Neon je sdílená s prod → nasadit
    kód hned).
  - **Krok 2 – API vrstva** (`lib/data/apiFootball.ts`): `fetchPrediction(fixtureId)`
    + tolerantní zod schéma, vrací `{home,draw,away}|null`.
  - **Krok 3 – orchestrace** (`runPredictUpcoming` v `lib/data/predictions.ts`): po uložení
    naší predikce 1 volání `/predictions` **s pojistkami:** jen klubové ligy
    (`PREDICTION_LEAGUES`, ne reprezentace – tam API predikce nemá), **jen když ještě není
    uložená** (`benchHomeWin == null` → 1×/zápas za život, drží náklady ~desítky volání/den),
    `null`/výpadek nezastaví náš řádek (try/catch, `benchAvailable=false`).
  - **Krok 4 – store** (`lib/data/predictionStore.ts` + `PredictionRow` v `lib/types.ts`):
    rozšířit `toRow` o bench pole + **samostatná** `saveBenchmark(fixtureId, {home,draw,away})`
    (jiný životní cyklus než naše predikce, neruší ji).
  - **Krok 5 – skórování** (`scripts/calibrate.ts`): zobecnit `probScores()` na výběr
    sloupců, zavolat 2× nad stejnými settled řádky → side-by-side Brier/log-loss
    (bench jen na podmnožině `benchAvailable && available` = férové srovnání). To je jádro
    hodnoty – po dost settlnutých zápasech dá číslo „jsme lepší/horší/nastejno".
  - **Mimo 1. iteraci:** track-record do `lib/picks/trackRecord.ts` + UI sloupec v PicksApp –
    řešit až podle výsledku z `calibrate`.
  - **Pozor:** časování – my predikujeme při 1. zachycení, API updatuje blíž k výkopu →
    guard „fetch 1×" drží obě predikce ze srovnatelného okamžiku (záměrně neaktualizovat).
    `modelVersion` filtr v kalibraci drží srovnání konzistentní (bench je na stejném řádku).
