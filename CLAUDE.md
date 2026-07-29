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
npm run calibrate    # MLE DC_RHO + Brier/log-loss z odehraných predikcí (jen MODEL_VERSION)
npm run backtest     # offline backtest na historii klubových lig (point-in-time, stejné jádro);
                     # 1 volání/liga+sezóna, pak .cache/backtest → další běhy offline
npm run backtest -- --leagues=39,140 --seasons=2024,2025 --minMatches=5 --refresh
npm run backtest -- --no-stats      # bez xG/střel (měření, co statistiky přidávají)
npm run backtest -- --no-odds       # bez sekce „vs. TRH" (jen kvalita modelu)
npm run backtest -- --team-totals   # TÝMOVÉ TOTALY (marginály mřížky): úroveň, disperze,
                     # kalibrace na liniích 0.5/1.5/2.5 pro domácí i hosty. 0 nových dat.
npm run backtest -- --cards         # MODEL KARET: úroveň λ, overdisperze, kalibrace po
                     # liniích 2.5–6.5, rozptyl mezi rozhodčími + ABLACE (přidává sudí?)
                     # a sweep jeho shrinkage. --cards-grid = fit útlum × shrinkage sudího
                     # --cards-tune=6,0.5,1.2,50,1 = k,t,v,refShrink,refWeight
npm run backtest -- --ah            # ASIJSKÝ HENDIKEP jako MĚŘÍTKO (ne trh k sázení):
                     # rozloží naši chybu proti trhu na PŘEVAHU (kdo je lepší) a SOUČET
                     # (kolik padne gólů) a zregresuje skutečnost na tržní odhad + naši
                     # odchylku → β₂ = kolik z naší odchylky je pravda. Po ligách taky.
npm run backtest -- --corners       # MODEL ROHŮ: úroveň λ, overdisperze, kalibrace po liniích
                     # --corners-grid = fit shrinkage × útlum součtu
                     # --corners-grid-nb = fit útlum × overdisperze (negativně binomické)
                     # --corners-tune=6,0.3,1.2 = konkrétní k,t,v (fit na jedné sezóně,
                     #   ověření na druhé). Data zdarma z import-odds (HC/AC);
                     #   rohy jedou MIMO produkční predikci.
npm run import-odds  # ZAVÍRACÍ KURZY z football-data.co.uk → .cache/backtest (0 volání API).
                     # Bez nich backtest neumí měřit hranu proti trhu ani ROI.
                     # --leagues=39,140 --seasons=2024,2025
npm run backtest-national           # backtest REPREZENTACÍ (turnaje + Liga národů);
                     # --ratings=1095,2,1 = globální ratingy, --grid, --from=/--to=
npm run backfill-stats              # xG/střely k historii: 1 volání/zápas, --limit stropuje
                     # den; ukládá i do produkční MatchStatCache (= předehřeje appku)
npm run reprice      # po změně DC_RHO/LAMBDA_SHARPEN přepočte uložené predikce z λ (0 API);
                     # suchý běh, zápis až `-- --apply`. NAHRAZUJE bump MODEL_VERSION.
npm run resettle     # přepočet uložených výsledků na skóre po 90 min (AET/PEN); suchý běh,
                     # zápis až `npm run resettle -- --apply`
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
- **Kvalita formy** (`lib/stats/formQuality.ts`, `TeamComparison.formQuality`) – doplněk
  souhrnu formy, který odpovídá na „**sedí výsledky s výkony?**". Pro každý zápas okna
  spočítá **očekávané body (xB)** z xG obou stran a porovná je se skutečnými; nad oknem
  z toho udělá verdikt nadstavená / sedí / podhodnocená forma. Je to tentýž rozpor mezi
  hrou a skóre, kvůli kterému vznikl `matchReport.ts`, jen agregovaný přes formu.
  - **Není to `matchReport.ts` per zápas.** Ten je konstruovaný jako **podíl dvou stran
    jednoho zápasu** (součet pruhů je vždy 10) a potřebuje obě poloviny odpovědi
    `/fixtures/statistics`. Tady je soupeř pokaždé jiný a `MatchStat` nese jen **vlastní**
    metriky + `GOALS_AGAINST`/`XG_AGAINST` – soupeřovo držení, střely ani fauly v tom
    řádku nejsou, takže podíl by nešlo ani spočítat, ani by nic neznamenal.
  - **xB jede stejnou mřížkou jako predikce** (`gridProbs`, λ = xG týmu a xG soupeře →
    `3·V + R`) → žádná druhá implementace Poissona, která by se mohla rozejít. Zostření λ
    a Platt kalibrace se ale **vypínají explicitně** (`XP_PARAMS`): jsou to post-parametry
    fitnuté na *predikční* λ, kdežto xB je **retrodikce** odehraného zápasu. Dnes jsou obojí
    no-op, ale zapnutí `LAMBDA_SHARPEN` by jinak tiše pokřivilo očekávané body. **ρ zůstává**
    (Dixon–Coles je vlastnost gólového rozdělení, ne prediktivní post-param).
  - **Výběr zápasů sdílí s `computeSummary`** přes vytknutý `orderedMatches` (`summary.ts`).
    Dvě nezávislé kopie filtru by se mohly rozejít a UI by kreslilo hodnocení k jinému
    zápasu, než ukazuje badge formy. Kryto testem přes všechny tři venue.
  - **Verdikt nad oknem vzniká až od 4 zápasů s xG** (`T.minXgSample`) – xB z pěti zápasů
    má obrovský interval. Jednotlivé zápasy se hodnotí i pod prahem (mají vlastní čísla
    vedle sebe). Body i xB se agregují **jen ze zápasů s xG**, ať mají stejný jmenovatel.
    **Jednostranné xG se zahazuje** – soupeř by v mřížce neměl šance vůbec.
  - **Degraduje po částech** jako `matchReport.ts`: bez xG zůstane výsledek a góly, zbytek
    je `null` a sekce zmizí. U reprezentací je to **běžný stav** (xG má 30,9 % zápasů se
    statistikami, přáteláky 2,0 %) – nedopočítávat odhadem.
  - **Popisný kontext, NE signál.** Do λ, insights ani tipů nevstupuje: pět zápasů je
    z valné části šum, proto má LAST5 v `PREDICTION_WINDOW_WEIGHTS` jen 5 %. Kdyby to
    někdy mělo do modelu, tak přes `npm run backtest`, ne dojmem.
  - **0 volání API** (čte už cachovanou `MatchStatCache`), žádný bump cache verze, **FREE**
    (`toFreeResult` posílá `home`/`away` vcelku). Mock má kvůli tomu `XG_AGAINST`
    (v realitě chodí ze soupeřovy půlky téže odpovědi jako `XG` → váže se na jeho dostupnost).
    UI: proužek pod badgem formy + řádek „Body vs. xG" ve `FormSummary.tsx`.
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
  gólů s **Dixon–Coles korekcí** nízkých skóre (`DC_RHO`, `drawTau`; ρ<0 zvyšuje remízy 0:0/1:1).
  **λ se staví multiplikativně vůči ligovému měřítku** (Maher/DC, `expectedGoals`):
  `λ = ref × (útok/ref)^s × (obdržené soupeře/ref)^s`, kde `ref` = **kolik gólů dá v této lize
  průměrný domácí, resp. hostující tým** (`LeagueBaseline`, z home/away splitů tabulky přes
  `computeLeagueBaseline` → `getLeagueBaseline`, sdílí `standings:` cache = **0 API navíc**).
  Na **startu sezóny** má tabulka málo zápasů (`computeLeagueBaseline` chce 20 doma i venku,
  jinak vrací `null`) → `getLeagueBaseline` spadne na **loňskou tabulku téže ligy**, teprve
  pak na `DEFAULT_BASELINE` (1.5/1.2). Generický default je průměr přes ligy a nízkoskórovým
  soutěžím (Řecko, Turecko, ČR) systematicky nadsazuje góly, takže by prvních pár kol tlačil
  Over 2.5 i BTTS nahoru – a stejným číslem se normalizují i ratingy.
  Domácí výhoda je **v rozdílu ref**, λ ji nepřidává zvlášť.
  `ref` se řídí tím, odkud data přišla (venue rozpad vs. fallback TOTAL) → **venue-neutrální
  reprezentace domácí výhodu nedostanou** a prohození týmů dá zrcadlovou predikci.
  Dvě pojistky proti šumu (`PredictTuning`, fitnuté `npm run backtest`): **shrinkage**
  (`shrinkMatches=6`: `(n·hodnota + k·ref)/(n+k)` → malý vzorek = skoro liga) a exponent
  **`strength`** (dnes 1.0). Chybí-li jedna strana (útok/obrana), bere se za ni ligový průměr;
  až když chybí obě, vrací `available:false`.
  **Predikce má VLASTNÍ vážení oken** (`PREDICTION_WINDOW_WEIGHTS` = 70/25/5 vs. zobrazovacích
  15/30/55): metriky v UI mají popisovat *formu*, λ má *odhadovat góly* a pět zápasů je z valné
  části šum. Proto `compareTeams` počítá tři metriky za λ (`PREDICTION_METRICS`) znovu s jinými
  vahami; UI/insights/souhrny běží beze změny na zobrazovacích hodnotách.
  **Útlum rozptylu součtu λ** (`totalSpread = 0.5`, `dampenTotal`): 1X2 stojí na **rozdílu** λ
  (kdo je lepší) a je kalibrované; Over 2.5 / BTTS stojí na **součtu** λ (kolik gólů padne) a ten
  měl moc velký rozptyl – chyby útoku a obrany se v rozdílu ruší, ale v součtu sčítají. `dampenTotal`
  proto stlačí součet k ligovému průměru a **drží rozdíl** (přesný protějšek `sharpenLambdas`)
  → 1X2 se nedotkne. Over 2.5: ECE **0.054 → 0.014**, log-loss 0.6919 → **0.6817** (základní míra
  0.6911) – **teprve teď Over 2.5 vůbec něco přidává**, předtím byl horší než konstanta.
  **xG na OBOU stranách** (`xgWeight = 0.5`): útok = `XG` týmu, obrana = **`XG_AGAINST`** = xG,
  které soupeř **inkasoval** (kvalita obrany bez šumu z proměňování). Plní se z téže odpovědi
  `/fixtures/statistics` (nese oba týmy) → **0 volání navíc**; sloupec `xgAgainst` v `MatchStatCache`.
  Dřív se xG používalo **jen na útok** a přínos byl mizivý (log-loss −0.002); s xG i na obraně je
  to **−0.0075** (1.0191 → 1.0116 na sezóně 2025; potvrzeno i na 2024). Čisté xG (w=1) je **horší**
  než mix → góly a xG se doplňují, nenahrazují.
- **Síly týmů = ratingy s korekcí na soupeře** (`lib/stats/ratings.ts`, `computeRatings`, „C2“):
  λ se **primárně** staví z nich, okenní průměry metrik jsou už jen **fallback** (reprezentace,
  cross-league porovnání, studená cache). Maherovo iterativní schéma: `góly ≈ ref × útok(i) ×
  slabost_obrany(j)`, útoky se odhadnou při daných obranách a naopak (5 iterací), s
  **exponenciálním časovým útlumem** (`halfLifeDays = 270` – nahrazuje tři pevná okna) a
  shrinkage (2). Odpovídá to na „**s kým se hrálo**“ – tým po losu s elitou dosud vypadal slabě.
  Zdroj: **už cachované zápasy** (`MatchStatCache`; domácí řádek nese góly i xG obou stran přes
  `goalsAgainst`/`xgAgainst` → zápas jde složit bez párování) → `getLeagueRatings`, **0 volání API**,
  výsledek cachovaný per liga (TTL 6 h). **Ratingy platí jen uvnitř jedné ligy** (jsou normalizované
  na ligový průměr 1.0) → cross-league porovnání zůstává na okenním modelu.
  Backtest: log-loss **1.0116 → 1.0001** (2025) a **1.0010 → 0.9869** (2024, hold-out).
- **Reprezentace: GLOBÁLNÍ ratingy** (`getNationalRatings`, `NATIONAL_RATING_OPTIONS`) – **jeden
  pool všech ~600 národů**, ne pool per konfederace. Ratingy per konfederace by chybu zopakovaly
  (každý normalizovaný na svou 1.0); v jednom poolu propojí konfederace **přáteláky a mezikontinentální
  zápasy** a síla se po těch hranách propaguje (jako Elo). Tím se opravuje **strukturální** chyba:
  dosud se góly Portugalska (nastřílené v UEFA) srovnávaly s góly Uzbekistánu (v AFC), jako by
  pocházely ze stejného rozdělení – a přesně na takové zápasy (MS) model sází.
  Zdroj: `NATIONAL_HISTORY_LEAGUE_IDS` (turnaje + Liga národů + kvalifikace všech konfederací +
  **přáteláky**), `fetchLeagueSeasonFixtures` = 1 volání/soutěž+sezóna, cache 24 h (dohrané sezóny
  30 dní) + hotové síly TTL 6 h. **Neutrální půda** (`isNeutralNationalLeague` → `PredictOptions.neutral`):
  turnaj = obě strany stejným měřítkem, Liga národů a kvalifikace mají doma/venku.
  **Backtest** (`npm run backtest-national`, 675 zápasů 2024–2026, ověřeno na dvou obdobích zvlášť):
  log-loss **1.0182 → 0.9352**, přesnost **49.5 → 55.3 %**, ECE 0.024 → 0.019. Na MS 2026 samotném
  přesnost **52.5 → 57.5 %**. **Pětkrát větší zisk než u klubů** – protože se opravuje chyba, ne šum.
  Dvě věci proti intuici: **delší paměť je lepší** (poločas **3 roky**; reprezentace hrají málo a mění
  se pomalu) a **přáteláky mají mít PLNOU váhu** (`NATIONAL_FRIENDLY_WEIGHT = 1`, přestože okenní
  model je přes `matchWeight` tlumí) – jsou to hlavně ony, co propojují konfederace.
  Kontrola: `scripts/checkRatings.ts national` (nahoře Argentina/Španělsko/Maroko/Japonsko, dole
  San Marino/Seychely). **Pozor:** tým s odříznutým programem (Rusko – jen přáteláky se slabými)
  má rating nespolehlivý; korekce na soupeře potřebuje propojený graf.
  **Změřeno backtestem** (3 511 zápasů): ráno (aritmetický průměr útoku a obrany, váhy 15/30/55)
  log-loss **1.0494**, přesnost 46.6 %, ECE 0.022 → dnes **0.9924**, **51.8 %**, ECE 0.011
  (naivní konstanta 1.0770). Pořadí přínosů: **váhy oken** > **ratingy (C2)** > **xG na obraně**.
  `MODEL_VERSION = 7` (λ se změnila → dataset predikcí se počítá od verze 7; verze 6 = klubové
  ratingy C2, verze 7 = globální ratingy reprezentací).
- **BTTS („oba skórují") NEMÁ signál** – doložené, ne dojem. Poissonova mřížka ho měla **horší
  než konstanta** „54.7 % vždy" (0.6920 vs. 0.6888) a přestřelený (ECE 0.033). Proto je BTTS
  **jediný trh, který nepochází z mřížky**: `scoringProb` ho staví z **empirických frekvencí**
  `SCORED` / `CLEAN_SHEET` (odvozené metriky, `metricOf` v `aggregate.ts` je dopočítá z gólů →
  **0 API navíc, neukládají se, nejsou v `ALL_METRICS`** = v UI se nezobrazují, cache se nebumpuje).
  Poisson jev „dá tým gól?" jen **odvozuje** z průměru (`P(≥1) = 1 − e^−λ`) a průměr zahodí, jak
  byly góly rozdělené; frekvence tu informaci nesou. Výsledek: log-loss **0.6885**, ECE **0.019**
  → BTTS už **neškodí a je kalibrované**, ale skill nemá (konstanta 0.6888; hold-out 2025: 0.6894
  vs 0.6901). `scoringStrength = 0.15` = **týmovou frekvenci ber jen z 15 %** (naplno je log-loss
  0.7188!) → přesně to říká, že signál tam prakticky není.
  **Zkoušeno a zamítnuto:** ρ (hne s BTTS o 0.0001 – sahá jen na 4 nejnižší skóre) a **bivariační
  Poisson** se společným šokem λ₃ (0.6920 → 0.6915 = šum, a 1X2 se zhorší 1.0125 → 1.0140).
  Nezkoušej to znovu bez **nového vstupu** (xG, střely na branku, sestavy). **Pozor:** `reprice`
  proto `bttsYes` **nepřepisuje** (nejde odvodit z uložených λ). A nabízet BTTS jako value tip
  je sporné – trh bez edge dá jen šum.
  V/R/P, BTTS, Over 2.5 i **top-N nejpravděpodobnějších přesných skóre** (`topScores`) se
  počítají z téže opravené mřížky → vzájemně konzistentní (`topScores` je UI-only obohacení
  z živé mřížky, **neukládá se** do `PredictionRow`/`FixturePrediction`). Chybí-li gólová i xG
  data, vrací `available:false` (UI zobrazí „nedostatek dat", ne falešnou 50/50). UI `MatchPrediction.tsx`.
  **Připravenost predikce** (`lib/stats/readiness.ts`, `MatchPrediction.readiness`): kolik dat
  reálně stojí za λ = **nejslabší ze 4 vstupů** (útok×obrana obou týmů, efektivní vzorek
  `MetricValue.sampleSize` ve venue s fallbackem na TOTAL). Vrací `{sample, score 0–1, level
  low|medium|ok}` (`PREDICTION_READY_SAMPLE=4`). Na startu sezóny je LAST5/LAST10 tenké →
  predikce stojí na baseline minulé sezóny → odznak „málo dat".
  **To ale dlouho NEPLATILO** (opraveno 26. 7. 2026): `computeMetricValue` sčítal
  `effectiveSample` přes okna, jenže okna se **překrývají** (LAST5 ⊂ LAST10) a na startu
  sezóny splývají úplně – SEASON je celý loňský pool a LAST10/LAST5 jeho novější řezy, tedy
  tytéž zápasy. Vzorek proto hlásil až trojnásobek, readiness vycházelo „ok" a přepínač
  „Skrýt málo dat" (default ON) v srpnu nefiltroval nic. Dnes se váhy sbírají do mapy podle
  `fixtureId` → **jeden zápas se počítá jednou** (viz test „zápas ve VÍCE oknech"). Vedlejší
  efekt: `sampleSize` (a tím i `lowConfidence`) je napříč appkou nižší a znamená
  „kolik zápasů za tím reálně stojí" – prahy `LOW_CONFIDENCE_SAMPLE`/`PREDICTION_READY_SAMPLE`
  se **nezměnily**, ale nově je splní až 4 skutečné zápasy místo dvou.
  Ukládá se jako `readinessSample`
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
- **Hranici dne určuje KLIENT, ne server (statický ISR).** `app/page.tsx` je `force-static`
  + `revalidate=600` → serverem upečený „dnes" může být **o den starý** (regenerace běží až na
  požadavek + stale-while-revalidate; přes noc bez návštěvy zůstane včerejší snapshot a první
  načtení ho servíruje, teprve druhé dostane čerstvý). Dřív navíc byly popisky dní **podle indexu**
  (`days[0]` = vždy „Dnes") → po otevření svítil včerejšek. `ZapasyApp` proto **reconciluje** pražský
  „dnes" na klientovi: počítá ho při mountu **i při návratu do popředí** (`visibilitychange`+`focus`
  → pokrývá PWA reopen přes noc, kdy JS stav přežije a mount effect neběží), **odfiltruje minulé dny**
  (`visibleDays`) a labely určuje **podle data** (ne indexu). Do prvního renderu (SSR/hydratace) padá
  zpět na index → **žádný hydration mismatch**; statický/CDN benefit zůstává. Snapshot fetchuje dnes+6,
  takže i včerejší snapshot pořád obsahuje dnešní zápasy. **Nevracet na index-based labely** – rozbije
  to Program po půlnoci i po probuzení PWA.
- **Seznam je jen navigace – nic se nepočítá živě tady.** Predikce vzniká až klikem přes
  existující deep-link do `CompareApp` (auto-`runCompare`) → **žádný nový výpočetní kód**,
  `compareTeams` ani gating (`toFreeResult`) se nemění (predikce zůstává PRO jako dnes). Stejný
  deep-link staví i `PicksApp` (`PickRow`) a Výsledky (`ResultRow`) – sdílený stavitel
  **`buildCompareHref`** (`app/_components/compareHref.ts`, vrací `string|null` = klikací jen
  když známe „ligu" obou stran; jeden zdroj pravdy pro všechny tři řádky).
- **Data (Program):** `fetchFixturesByDate(date)` (`apiFootball.ts`) = **1 volání `/fixtures?date=`
  na den** (timezone `Europe/Prague`) → levné. `getFixturesByDates(dates)`
  (`realRepository.ts`, TTL `ApiCache` 1 h, paralelně, výpadek dne nezhasne ostatní) profiltruje přes
  **`FIXTURE_LIST_LEAGUE_IDS`** (`catalog.ts` = **`PROGRAM_CLUB_LEAGUE_IDS`, tj. Top 8 + ČR (9 lig)**
  + reprezentace; **ne** všech 18 `CLUB_LEAGUES` – denní seznam je vědomě užší než rozsah
  predikcí, viz „Rozsahy lig" níže), vyřadí
  dohrané (`FINISHED_STATUSES`) a normalizuje čistou **`normalizeUpcomingFixtures`**
  (`lib/data/fixtures.ts`, testy `fixtures.test.ts`) na `UpcomingFixture`. Mock:
  `lib/data/mock/fixtures.ts` (funguje bez DB/API).
  **Do Programu patří zápas, který ještě NEZAČAL, NEBO právě běží** – `normalizeUpcomingFixtures`
  pustí buď **živý** zápas (`LIVE_STATUSES`), nebo **nadcházející** (status mimo `NOT_UPCOMING`
  = dohrané + `PST`/`CANC`/`ABD`/`AWD`/`WO` **a** výkop v budoucnu, parametr `now`); vše navíc jen
  z našich lig. Ta časová podmínka pro nadcházející je pojistka proti stavu, ne kosmetika: rozpis dne
  je v `ApiCache` až hodinu starý, takže odehraný zápas v něm ještě může nést `NS` (odtud
  „Argentina–Švýcarsko se hraje ve 3:00", ačkoli skončilo `AET 3:1`) – status sám o sobě nestačí.
  **Živost čteme VÝHRADNĚ z API statusu**, ne z „výkop proběhl" (drží tentýž invariant: stale-`NS`-
  po-výkopu jde stále ven). Živý zápas nese `live/elapsed/liveHome/liveAway` pro první paint.
- **Živé skóre (Program nezhasne, svítí):** samostatný lehký endpoint **`GET /api/fixtures/live`**
  (FREE, rate-limit) → `getLiveFixtures` = **1 sdílené upstream volání za `fixlive` cache (~90 s)**
  napříč všemi uživateli (`fetchLiveFixtures(FIXTURE_LIST_LEAGUE_IDS)` = `/fixtures?live=<ids>`, malý
  payload). Klientský hook `useLiveScores` v `ZapasyApp` pollí ~90 s, ale **jen** když (a) je aktivní
  Program, (b) `!document.hidden` (pauza při skryté záložce) a (c) je plausibilně živo (aspoň jeden
  zápas dne má výkop v `[now−2.5 h, now]`) → offseason = 0 pollů. `mergeLive` je **autoritativní**:
  přepíše minutu/skóre ze SSR a zápas, který ze živé sady vypadl (dohráno), z Programu **odebere**
  (opraví i stale SSR); dokud poll neproběhl, věří SSR. `LiveScore` typ, mock vrací `[]`.
- **Data (Výsledky):** `getRecentResults()` (`repository.ts`) = posledních ~14 dní settlnutých
  predikcí (`getRecentSettledPredictions` z `predictionStore`, jen čte DB) → čistý mapper
  **`summarizeSettled`** (`lib/picks/results.ts`, testy `results.test.ts`) na `SettledMatch`
  (skóre + predikovaná strana 1X2 + `outcomeHit`, sdílí `argmaxOutcome`/`actualOutcome` s
  `trackRecord.ts`). **FREE** (jen historie, žádný budoucí tip). Reprezentačním řádkům dohledá
  konfederace (`getNationalConfedMap`). Mock: `mockSettledPredictions` → funguje bez DB/API.
- **Přehled zápasu ve Výsledcích** (`lib/stats/matchReport.ts` – čisté + testy, endpoint
  `/api/match-report`, UI `MatchReportPanel.tsx`): po rozkliknutí řádku **kategorický obraz
  odehraného zápasu** místo devatenácti řádků syrových čísel – verdikt jednou větou, chipy
  povahy zápasu (otevřený/uzavřený, jednostranný/vyrovnaný, ostrý/klidný), čtyři rozměry
  jako protilehlé pruhy (**Kontrola hry / Nebezpečnost / Proměňování / Důraz**) a 2–4
  konkrétní pozorování.
  - **Rozměry jsou PODÍL, ne absolutní výkon** (součet obou stran je vždy 10, kryto testem;
    druhá strana se dopočítá až ze zaokrouhlené první, jinak dá 6.4 + 3.7 = 10.1).
  - **Vyrovnanost se čte z nebezpečnosti, ne z výsledku** – smysl celé věci je pojmenovat
    rozpor mezi hrou a skóre („ovládli zápas, ale body bere soupeř"), což je přesně to,
    co se ze syrové tabulky čte nejhůř.
  - **Proměňování bez xG NENÍ dostupné** – „efektivita" bez očekávání je jen skóre.
    Každý rozměr degraduje sám za sebe (`available`), nikdy se nic nedopočítává odhadem;
    bez držení míče spadne Kontrola na přesné přihrávky, bez xG jede Nebezpečnost ze střel.
  - **Líné a FREE**: statistiky se tahají až na vyžádání (`getMatchStatsPair`, 1 volání,
    vrací obě strany). **Čte, ale NEZAPISUJE do `MatchStatCache`** – zápis potřebuje
    `season`/`isNeutral`/`competitive`, které tahle cesta nezná, a špatná `season` by tiše
    otrávila okna, na kterých stojí λ predikcí. Repeat views pokrývá CDN cache routy
    (1 h / 24 h stale) a většina prokliknutých zápasů v cache už je (dotáhlo je Porovnání).
  - Tlačítko je **mimo `Link`** řádku – uvnitř by klik navigoval do Porovnání.
  - **Verdikt NESMÍ mluvit o „ovládnutí" zápasu** – stojí na nebezpečnosti, ne na držení
    míče, a tým si může vytvořit dvakrát víc s třetinou míče (reálně: Bournemouth 33 %
    držení, xG 1.78 vs 0.78). Formulace „ovládli" si odporovala s pruhem Kontroly hry
    hned pod tím; dnes „si vytvořili mnohem víc". Kryto testem s těmi čísly.
  - **Ověřeno na reálných zápasech** (Premier League, La Liga, MS 2026, Fortuna liga):
    turnajové reprezentační zápasy xG **mají** (na rozdíl od přáteláků), Fortuna liga je
    smíšená – část zápasů má 15 metrik **bez xG** (Nebezpečnost spadne na střely na
    branku, Proměňování se skryje), část jen 2 metriky (přehled se nevykreslí vůbec).
    Známá hrubá hrana: bez xG se otevřenost počítá ze střel na branku, takže zápas
    s málo střelami dostane „uzavřený", i když skončil 3:0. Prahy jsou v `T`.
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
  v rámci dne **rozbalovací kontejnery podle ligy** (`LeagueContainer`): klikací hlavička
  (logo + název + počet + nejbližší výkop + **pulzující červená tečka**, má-li liga živý zápas),
  **výchozí = vše sbaleno, žádné auto-rozbalení** (rozhodnutí uživatele). Živý řádek ukazuje místo
  času výkopu **🔴 minutu + živé skóre** (`LiveDot` blik = `bg-negative` + `animate-ping`). Ve
  Výsledcích plochý seznam nejnovější první + souhrn „trefeno X z Y". Řádky klikací dle
  `buildCompareHref` (klub vždy; reprezentace po dohledání konfederací).
- **Oblíbené zápasy + ligy + filtr (PRO):** tabulky **`FavoriteLeague`/`FavoriteFixture`** (userId FK,
  cascade; bez snapshot meta – filtr pracuje jen nad už načteným 7denním Programem, stačí id).
  Route **`GET/POST /api/fixtures/favorites`** (PRO přes `getEntitlement`; anon/FREE → `{locked}`/403,
  rate-limit `fav:`), store `favoritesStore.ts` (idempotentní upsert/deleteMany). **Logika
  oblíbenosti = sjednocení:** zápas je oblíbený, když je jeho `fixtureId` ve `FavoriteFixture` **nebo**
  `leagueId` ve `FavoriteLeague`. UI (`useFavorites`, optimistic toggle s revertem): **hvězda** na
  hlavičce ligy i na řádku zápasu, **primární sekce „⭐ Oblíbené" nahoře** (živé první, pak dle výkopu),
  přepínač **„⭐ Jen oblíbené"**. Non-PRO klik → PRO CTA (`signIn`/banner), žádná perzistence.
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
  mají vyšší váhu než přáteláky.
  **Reprezentace mají skoro plnou sadu metrik** (`METRICS_BY_ENTITY`) – vyloučené je **jen xG**.
  Dřív se jim vynechávalo i držení, přihrávky, střely z/mimo vápno, zákroky a zblokované střely
  s odůvodněním „u reprezentací statistiky chybí". **Změřeno na 1 533 reprezentačních řádcích
  `MatchStatCache` a je to jinak:** když něco chybí, chybí **celá odpověď `/fixtures/statistics`**
  (~třetina reprezentačních zápasů) – ne jednotlivé metriky. Mezi zápasy, které statistiky mají,
  je držení míče v **99,5 %** (přesnost přihrávek 99,1 %, střely z vápna 99,4 %) = stejně dostupné
  jako střely a rohy, které se zobrazovaly celou dobu. Důsledkem starého blocklistu byla trvale
  prázdná kategorie „Hra s míčem" a dimenze „Kontrola míče"/„Styl útoku" u reprezentací.
  **xG je jediná skutečná výjimka** (jen 30,9 % zápasů se statistikami; přáteláky **2,0 %**) →
  zůstává vyloučené a λ reprezentací jede na gólech. Chybějící třetina se řeší sama: metrika bez
  dat nemá vzorek (`weightedAverage` renormalizuje váhy, `lowConfidence` odznak varuje).
  Reprezentační zápasy jsou **venue-neutrální** (`isNeutral: true` v `realRepository`
  i mocku) → doma/venku se nedělí (hrají na neutrální půdě a API to nehlásí spolehlivě),
  vše jde do TOTAL; UI v režimu Reprezentace přepínač Doma/Venku skrývá.
- Vážený průměr re-normalizuje váhy, když okno chybí (`weightedAverage.ts`).
- Metriky z `/fixtures/statistics` mapuje `STAT_TYPE_MAP` (`apiFootball.ts`);
  hodnoty čistí `parseStatValue` (ošetří „65 %"/null/„N/A"). `LOWER_IS_BETTER`
  (`types.ts`) značí metriky, kde je nižší hodnota lepší (obdržené góly, karty…).

## Rate-limiting / výkon
- **Cachovací vrstva je JEN Postgres** (`ApiCache` s TTL per endpoint + trvalá `MatchStatCache`).
  `apiGet` proto fetchuje s **`cache: "no-store"`** – Next data cache tam **nesmí** být. Seděla
  nad naší vrstvou s pevnou 24h revalidací a **přebíjela každý kratší TTL**: `cachedJson` po hodině
  správně sáhl pro nový denní rozpis, dostal 24 h starou odpověď a uložil si ji s čerstvou expirací
  → dohraný zápas se v Programu tvářil jako nadcházející a stejně tiše zastarávaly tabulky (6 h),
  zranění (6 h) i střelci (12 h). Nevracet zpět.
- api-sports limit 300/min, ale edge nás reálně stropuje ~5 úspěšných volání/s a občas
  odmítá i pod limitem (distribuované nody). `lib/data/rateLimiter.ts` = semafor
  souběžnosti 3 + klouzavý minutový strop; `apiGet` retry s krátkým backoffem.
- **Denní kvóta (plán Pro) = 7500.** Odhad spotřeby v rozjeté sezóně ≈ **700–900/den**
  (seznamy zápasů ~200 + statistiky nově odehraných ~120 + kurzy ~50–100 + benchmark ~120 +
  tabulky/kola/warm/settle ~80) → **rezerva ~88 %**. Číslo vyskočilo z původních 450–600
  rozšířením predikcí z 8 na 16 klubových lig. Predikce **nestojí volání na zápas**:
  `compareTeams` čte z trvalé `MatchStatCache`, takže zápas se stahuje **1× za život**.
- **Verze zápasové cache má DVĚ konstanty** (`cache.ts`): `CURRENT_CACHE_VERSION` (čím se
  zapisuje) a **`MIN_READABLE_CACHE_VERSION` (co se ještě čte)**. Bump té první při přidání
  **kosmetického** pole (verze 3 = metadata o soupeři pro logo u formy) by jinak zahodil
  ~9 000 cachovaných zápasů a znovu je stáhl po 1 volání – práh proto zvedej jen tehdy, když
  by starší řádky daly **špatná čísla** (chybějící metrika = tichý posun průměru), ne když jde
  o zobrazení. Lokálně stažené statistiky jde do produkční cache přepsat **zdarma**:
  `npm run backfill-stats -- --from-cache`.
- **`cachedJson` neukládá `null` a prázdné pole cachuje krátce** (3 h). `null` do
  non-nullable `payload` házelo výjimku, kterou volající `catch` spolkl (u ratingů to
  znamenalo sken celé ligy při každém volání); prázdná odpověď na plné TTL zase umí
  na startu sezóny **oslepit ligu na 24 h**, když se na `teams:<liga>:<sezóna>` sáhne
  pár dní před publikací nové sezóny.
- **`/fixtures/statistics` vrací OBA týmy v jedné odpovědi.** `assemble` (`realRepository`)
  proto z ní ukládá i **soupeřův** `MatchStat` – dřív se druhá půlka zahodila a týž zápas se
  stáhl podruhé, až přišel na řadu soupeř (**2× dražší**). Nejdražší opakující se položka
  v sezóně; nevracet zpět.
- Cold porovnání ~8 s (mezisezóna nestahuje předchozí sezónu), warm ~0.15 s.
- **Předehřívání:** `GET /api/warm` (katalog, lehké, denní cron – viz „Plánované úlohy");
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
- **EV / value tipy vůči kurzům** (`lib/picks/value.ts`, čisté + testy): predikční pipeline
  dotahuje **referenční kurzy sázkovky** (`fetchOdds` v `apiFootball.ts`, decimal odds 1X2 +
  Over 2.5 + BTTS **od jedné** preferované sázkovky) a ukládá je na `FixturePrediction`
  (`odds*` sloupce, `saveOdds`/`saveClosingOdds`, guard `oddsSnapshotState`). Životní cyklus
  jako benchmark: **jen klubové ligy, dva snímky na zápas** (`ODDS_LOOKAHEAD_HOURS=72`
  a zavírací `ODDS_CLOSING_HOURS=12` – viz CLV níže), rozpočet ~2 volání/zápas.
  **VŠECH ~13 SÁZKOVEK se ukládá** (`oddsBooks`/`oddsCloseBooks`, JSON, od 27. 7. 2026):
  odpověď `/odds` je nese všechny a dřív se 12 z nich zahazovalo ve prospěch jedné
  „preferované" – přitom **nejlepší cena napříč knihami byla jediná páka, která
  v backtestu prokazatelně zabrala** (ROI −7.7 % → −5.2 %, overround 0.11 % vs. 2.99 %).
  **0 volání API navíc.** Čte je `lib/picks/books.ts` (čisté + testy), a záměrně **dvěma
  různými funkcemi, které se nesmí zaměnit**: `bestPrice` = nejvyšší kurz = cena, kterou
  reálně dostaneš (na rozhodnutí „kam vsadit"), `sharpFair` = odmaržovaná cena z knihy
  s **nejnižší marží** = nejlepší odhad pravděpodobnosti (na měřítko: CLV, benchmark).
  Nejlepší cena je jako odhad pravděpodobnosti **vychýlená** – je to maximum přes knihy,
  takže straně s výjimečně štědrým kurzem systematicky podstřelí pravděpodobnost (kryto
  testem). `ValueEstimate.best` proto nese nejlepší cenu **vedle** `edge` z referenčního
  kurzu, ne místo něj: referenční kniha je jeden stabilní zdroj napříč historií, kdežto
  hrana počítaná z nejlepší ceny by se nafoukla jen tím, že přibyla sázkovka.
  `PickRow` ukazuje odznak `⌃ <kurz>`, jen když je nejlepší cena **reálně vyšší** než
  referenční. **Past, která to celé tiše vypnula** (opraveno 26. 7. 2026): `/odds` vrací
  u exotických trhů (Exact Score, handicapy) `value` jako **číslo**, ne řetězec – zod schéma
  odmítlo celou odpověď, `fetchOdds` hodil výjimku a protože je fetch kurzů best-effort
  (`catch` v pipeline i v Tipovačce), **nikdy se neuložil ani jeden kurz** (0 řádků s
  `oddsHome` v produkci). Schéma proto přijímá string i number (`oddsText`, test
  `lib/data/odds.test.ts`). Poučení: best-effort cesta musí mít **vlastní ověření**
  (`npm run probe-odds -- <fixtureId>`), jinak selhává neviditelně. Ukládáme **syrové kurzy** → `impliedProb=1/kurz` i `edge=p_model×kurz−1`
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
- **Měřítka kvality modelu (tři, v pořadí tvrdosti):** (1) **naivní konstanta** (45/26/29) =
  sanity check, model ji musí překonat; (2) **API-Football** (`BenchmarkPanel`) = slabý soupeř;
  (3) **TRH** (`lib/picks/market.ts`, `MarketPanel`) = **jediné měřítko, které rozhoduje**.
  `devig` odmaržuje uložené kurzy (proporcionálně; Shin/power by byly přesnější) a
  `computeMarketBenchmark` srovná log-loss na společné podmnožině. **Jen 1X2** (u Over 2.5/BTTS
  ukládáme jen kurz na „ano" → protistrana chybí, nejde odmaržovat) a **jen klubové zápasy**
  (reprezentace kurzy nemají a napříč konfederacemi jsou nesrovnatelné). Dokud trh vede, jsou
  „value" tipy spíš chyba modelu než hrana — `MarketPanel` to říká uživateli natvrdo.
- **ZMĚŘENO: model trh NEPORAZÍ a plochá strategie prodělává** (26. 7. 2026, `npm run backtest`
  nad 9 271 zápasy se zavíracími kurzy). **Tohle je odpověď na otázku „dá se z toho postavit
  profitabilní sázecí model?" — ne. Nezkoušej to znovu bez NOVÉHO vstupu.**
  - 1X2 log-loss: **náš 1.0239 vs. trh 0.9760** (ztrácíme 0.0479), přesnost 48.8 % vs 52.8 %.
    Zaostáváme tedy zhruba o tolik, o kolik jsme napřed před naivní konstantou.
  - ROI ploché sázky (1 jednotka, kritérium **EV = p × kurz − 1 > 0**, 95% CI bootstrapem):
    sharp linie **−7.7 %** [−10.5; −4.6], průměr trhu **−11.2 %** [−13.6; −8.7], nejlepší cena
    napříč knihami **−5.2 %** [−7.6; −2.7]. **Žádný interval neobsahuje nulu** → není to šum.
  - **Vyšší práh EV výsledek ZHORŠÍ** (−7.7 % → −8.9 % při prahu 5 %). To je klasický podpis
    modelu bez hrany: zápasy, kde model vidí největší výhodu, jsou ty, kde se nejvíc **mýlí**,
    ne kde má navrch. Proto „ukazuj jen tipy s velkou hranou" situaci nezachrání.
  - Po trzích (nejlepší cena): domácí −8.6 %, hosté −5.8 %, **Over 2.5 −1.8 %** [−5.5; +1.8],
    Under 2.5 −3.6 %. Over 2.5 je nejblíž nule — sedí to s tím, že je to jediný trh, kde model
    překonává základní míru. Ani tam ale zisk prokázaný není.
  - **Line-shopping je jediná páka, která prokazatelně funguje**: nejlepší cena napříč 13 knihami
    zvedne ROI o ~2 p.b. proti sharp linii a o ~5 p.b. proti průměru trhu (overround nejlepší
    ceny je **0.11 %** vs. 2.99 % u Pinnacle). Sama o sobě ale ze ztráty zisk neudělá.
- **ASIJSKÝ HENDIKEP JAKO MĚŘÍTKO** (`lib/picks/asianHandicap.ts`, čisté + testy;
  `npm run backtest -- --ah`) — **nejtvrdší test modelu, jaký máme, a zavírá otázku
  „model jako korekce trhu".** Není to trh k sázení, je to diagnostika.
  - **Proč AH, když už máme 1X2 log-loss:** ten řekne jen „ztrácíme 0.048", ne **čím**.
    AH umí chybu rozložit na **dvě nezávislé osy** — `supremacy` = λ_dom − λ_host (kdo je
    lepší) a `total` = λ_dom + λ_host (kolik padne gólů). Přesně tak je stavěný i náš model
    (`dampenTotal` hýbe součtem a rozdíl drží), takže jde adresně říct, která polovina λ je
    špatně. Navíc: marže ~2 %, **de-vig je u dvoucestného trhu PŘESNÝ** (u AH platí
    `1/o = p_výhra/(p_výhra+p_prohra)` na obou stranách → dělení overroundem vrátí právě
    pravděpodobnosti podmíněné „nebyl push", žádná volba metody jako u 1X2) a výstup je
    **spojitý** → regrese na skutečný rozdíl gólů má řádově větší sílu než měření nad
    diskrétním V/R/P.
  - **Inverze trhu:** z Over/Under 2.5 se bisekcí dopočte `total` (součet dvou nezávislých
    Poissonů je Poisson → žádný předpoklad navíc proti mřížce), z něj + linky + odmaržované
    ceny AH se bisekcí dopočte `supremacy`. Kryto round-trip testem: `marketView` vrátí λ,
    ze kterých se cena vyrobila, na 3 desetinná místa; marže výsledkem nehne (je symetrická).
    Čtvrtinové linky (−0.75) se dělí na dvě poloviční sázky — porovnat cenu na −0.75
    s modelem pro −0.5 by byla táž chyba, jakou u rohů hlídá párování po lince.
  - **Hlavní test:** `skutečný rozdíl gólů ~ tržní převaha + (naše převaha − tržní převaha)`.
    Koeficient β₂ je celá odpověď: kolik z toho, o co se od trhu lišíme, je pravda. Je to
    zároveň **optimální míra smrštění** pro „model jako korekce trhu".
  - **VÝSLEDEK (8 021 zápasů 2024+2025 se zavíracím AH i O/U): β₂ = 0.007 ± 0.039 (t = 0.2).**
    Naše odchylka od trhu je **čirý šum**, a interval je natolik těsný, že vylučuje i malou
    hranu (95% CI zhruba [−0.07; +0.08]). Na ose součtu gólů β₂ = 0.049 ± 0.074 (t = 0.7) —
    taky nic, jen s širším intervalem. Kvintily to potvrzují neparametricky: zbytek trhu je
    napříč koši plochý (−0.063 … −0.004), žádný trend.
  - **Kontroly, že měří správně:** β₁ trhu = 0.982 ± 0.025 (trh je nevychýlený, jak má být),
    tržní total 2.786 vs. skutečnost 2.750, tržní převaha +0.311 vs. skutečnost +0.283.
    Naše **úroveň je taky správně** (převaha +0.287, total 2.787) — nejsme vychýlení, jsme
    **šumnější**: RMSE převahy 1.6466 vs. 1.5516 u trhu.
  - **Nejužitečnější detail:** zaostáváme skoro celý na ose **PŘEVAHY** (RMSE +0.095), na ose
    **SOUČTU jen o 0.032**. Neumíme říct, kdo je lepší; kolik padne gólů odhadujeme skoro
    stejně dobře jako trh. Sedí to s tím, že naše nejlepší trhy mimo 1X2 (týmové totaly,
    rohy) stojí na úrovni a ne na poměru sil.
  - **Po ligách nic** (12 lig, β₂ od −0.184 do +0.136): ani jedna nedosáhne nekorigovaného
    |t| > 2, natož Bonferroniho prahu 2.807, a znaménka se symetricky střídají kolem nuly =
    podpis šumu. Hypotéza „v tenkém trhu (Řecko, Skotsko, Turecko) hranu najdeme" **neplatí**.
  - **Důsledek pro plán:** bod „vzít sharp linii jako prior a posouvat ji naší predikcí"
    je tímhle **uzavřený na gólových trzích** — optimální posun je 0.7 % naší odchylky, tedy
    ignorovat model. Zbývají jen trhy, kde jsme cenu ještě neviděli (týmové totaly, rohy,
    nově karty), a tam rozhodne CLV.
- **Historické kurzy: `npm run import-odds`** (`lib/picks/oddsDataset.ts`, čisté + testy).
  API-Football historické kurzy **nevrací** (ověřeno `/odds?fixture=<minulý>`, `?date=`,
  `?league=&season=` → shodně 0 výsledků), takže zdrojem je **football-data.co.uk** (zdarma):
  zavírací 1X2 ve třech hladinách (Pinnacle / průměr trhu / nejlepší cena), zavírací Over/Under 2.5
  a **skutečné počty rohů**. Pokrývá 16 z 18 lig (**Fortuna liga zdroj nemá**).
  **Od 28. 7. 2026 se z týchž řádků berou i:** zavírací **asijský hendikep** (`AHCh` =
  ZAVÍRACÍ linka, `AHh` je otevírací — nemíchat; ceny Pinnacle/⌀/max → `MatchOddsRecord.ah`)
  a `MatchFacts` = **rozhodčí, karty, fauly, střely (celkem i na branku), poločas**.
  Dřív se 100+ sloupců zahazovalo ve prospěch čtyř; **0 volání API navíc**, jen širší parse
  téhož souboru. Karty + rozhodčí jsou vstup do modelu karet (rozhodčí je tam dominantní
  prediktor a rekreační knihy ho do linie často nedávají), AH je vstup do `asianHandicap.ts`.
  **Pozor na pokrytí:** hendikep, karty a rozhodčí vozí jen soubory **hlavních** lig
  (`kind: "main"`, 12 z 18) — „extra" ligy (Norsko, Dánsko, Rakousko, Polsko, Švýcarsko)
  mají v CSV **jen 1X2**. A `Referee` je i mezi hlavními nekonzistentní: Anglie ho má
  u 100 % zápasů, Řecko u 0 %. Ověřeno na stažených souborech, ne odhadem. Ukládá se jako
  sidecar `.cache/backtest/odds-<liga>-<sezóna>.json` (stejný vzor jako `stats-*.json`),
  **0 volání API**. Párování je přes **datum (±1 den) + skóre + podobnost jmen** — skóre je tvrdý
  kontrolní součet, aby se nemohly podstrčit kurzy jiného zápasu; dnes 99.1 % (13 976/14 097).
  Jména se páruje kombinací shody tokenů („Man United" ⊂ „Manchester United") a bigramů
  („Levadiakos" vs „Levadeiakos"), plus ruční alias tam, kde se klub jmenuje jinak (WSG Tirol).
- **Snímky kurzů má VLASTNÍ cron `/api/cron/snapshot-odds` (HODINOVĚ), ne denní pipeline.**
  Není to ladění, ale oprava vychýlení: predikční cron jede 1×/den ve 04:30 UTC a zavírací
  okno je 12 h, takže večerní zápas (21:45 SELČ = 19:45 UTC) je v 04:30 ještě **15 h**
  daleko → mimo okno, a další běh přijde až po výkopu. Zavírací snímek by tak dostávaly
  **jen zápasy s výkopem mezi 04:30 a 16:30 UTC** (víkendová odpoledne) a CLV by se
  počítalo z nereprezentativní menšiny. `runSnapshotOdds` + `fixturesNeedingOdds`
  (čistý DB dotaz, řadí dle výkopu vzestupně — **zavírací snímek je neopakovatelný**,
  otevírací má 60 h rezervy). **Kvótu to nezdraží**: guard `oddsFetchedAt`/`oddsCloseAt`
  drží dva snímky na zápas za život, častější běh mění jen *kdy*. Běh **vrací
  `errors`** místo tichého `catch` — přesně tahle tichost stála rok bez jediného kurzu.
  `runPredictUpcoming` kurzy **záměrně nebere** (jeden vlastník zápisu).
- **ČASOVÁ ŘADA KURZŮ** (`lib/picks/oddsSeries.ts`, čisté + testy; sloupce `oddsSeries`
  /`oddsSeriesAt`) – dva snímky řeknou *kolik* se linie hnula, řada *kdy*. A „hnulo se to
  hodinu před výkopem" (peníze, sestavy) je něco jiného než „hned po otevření" (dorovnání
  otevírací chyby). Slouží ke **steamu**, k **robustnímu odhadu zavření** (poslední bod
  nezávisí na tom, jestli cron stihl okno) a jako kontext k tipu.
  - **Ukládá se KOMPAKTNÍ bod, ne celé knihy** – rozhodnutí o životaschopnosti, ne
    o eleganci. Spočítáno: plný snímek 13 knih × všechny trhy (~5 kB) každou hodinu po
    72 h = **2.8 GB/rok** proti **500 MB** na Neon free tier. Kompaktní bod (sharp kniha
    + nejlepší cena + O/U, ~100 B) se zužující se kadencí = **12 MB/rok**. Plné knihy
    zůstávají u dvou snímků, na kterých stojí EV a CLV.
  - **Kadence se zužuje k výkopu** (`snapshotIntervalMinutes`): > 24 h po 12 h, 6–24 h
    po 3 h, < 6 h hodinově → ~16 bodů na zápas. Daleko od výkopu se linie hýbe pomalu
    a hustý sběr by platil kvótou za šum. **Cena: ~340 volání/den** (jediná položka,
    která proti dřívějšku kvótu zdražila; celkem stále ~2 100 ze 7 500).
  - **Jeden fetch pro tři účely.** `snapshotPlan` (čistá, testovaná bez DB) rozhodne, jestli
    z odpovědi udělat otevírací snímek, zavírací snímek, bod řady, nebo víc z toho naráz.
    Otevírací a zavírací zůstávají **jeden za život** – řada je navíc, ne místo nich.
  - Ukládají se **syrové kurzy**, ne odmaržované pravděpodobnosti (táž zásada jako
    u `oddsHome`): de-vig metodu jde změnit bez nového fetche.
  - Čtení: `seriesDrift` (posun strany + `maxStep`, který odliší **skok** od plynulého
    driftu), `lateMove` (pohyb v posledních N hodinách = steam), `closingPoint`.
  - **Zatím se nikde nezobrazuje ani nevstupuje do CLV** – sběr běží, konzumenti přijdou
    až na datech. Měnit `rowClv` teď by rozmazalo měření, které v září stojí za verdiktem.
- **CLV (`lib/picks/clv.ts`, čisté + testy) = jediná zpětná vazba, která přijde HNED.**
  Na verdikt „má tip hranu?" z výsledků jsou potřeba stovky sázek (fotbal je z valné části
  náhoda); posun **zavírací linie** od našeho snímku je vidět po každém zápase. Kladné CLV
  je nutná podmínka dlouhodobě ziskového sázení – kdo vydělává bez něj, má zatím štěstí.
  Proto pipeline bere **DVA snímky kurzu** místo jednoho náhodného v okně 0–72 h:
  „náš" (≤ `ODDS_LOOKAHEAD_HOURS` 72 h) a **zavírací** (≤ `ODDS_CLOSING_HOURS` 12 h),
  sloupce `oddsClose*` + `oddsCloseAt`, guard `oddsSnapshotState` (dřív `hasOdds`).
  Cena: +1 volání/zápas (~30–50/den, pod 1 % kvóty). CLV se počítá z **odmaržovaných**
  pravděpodobností obou snímků – jinak by do něj protekla změna marže místo změny názoru
  trhu (kryto testem). BTTS se nesnímá (model tam nemá signál). UI: `ClvPanel` v `PicksApp`.
  **Měří se proti SHARP KONSENZU, ne proti referenční knize** (od 27. 7. 2026): `rowClv`
  vezme z `oddsBooks`/`oddsCloseBooks` knihu s **nejnižší marží** (`sharpFair`) a teprve
  bez knih spadne na referenční sloupce (`source: "sharp" | "reference"`, podíl hlásí
  `ClvSummary.sharpShare`). Referenční kniha je typicky Bet365 s marží 5–7 % → její pohyb
  je pomalejší a zašuměnější než sharp linie. **Oba snímky musí být ze stejného zdroje** —
  sharp „open" proti referenčnímu „close" by měřilo rozdíl mezi sázkovkami, ne pohyb trhu
  (kryto testem).
  **TRHY S LINKAMI v CLV** — rohy (`cornersOver`/`cornersUnder`) i **týmové totaly**
  (`totalHomeOver`/`totalHomeUnder`/`totalAwayOver`/`totalAwayUnder`). Sdílejí veškerou
  logiku (`LineMarket` + `marketLines`/`mainLine`/`bestLinePrice`/`sharpLineFair`;
  `cornerLines`&spol. jsou jen pojmenované zkratky), protože je to tentýž typ trhu.
  Kurzy žijí **výhradně v JSON snímku knih**, žádné vlastní sloupce nemají — a je to tak
  schválně, protože **každá kniha nabízí jinou linii** (rohy 9.5/10.5/11.5, týmový total
  0.5/1.5/2.5). Skalární sloupec by linii zahodil.
  Čtení proto páruje **po lince** (`bestCornerPrice`/`sharpCornerFair` berou linii povinným
  parametrem, `mainCornerLine` = nejšířeji kotovaná): linie se určí z **otevíracího** snímku
  a tatáž se hledá v zavíracím; když tam není, CLV se **nespočítá** (nedosadí se jiná).
  Porovnat kurz na 10.5 s kurzem na 11.5 by vypadalo jako obrovská hrana a byl by to
  artefakt — nejsnáz udělatelná chyba na rohovém trhu. Rohy nemají referenční fallback.
  Parsuje se **podle názvu trhu** (`/corner/i`), ne podle uhodnutého id — id se mezi knihami
  liší a špatné číslo by selhalo tiše. Ověření: `npm run probe-odds -- <fixtureId> --markets`
  vypíše linie i všechny trhy s id. **Nebylo ověřeno proti živému API** (mezisezóna) →
  udělej to na prvním zápase s kurzy.
- **Peníze měří `lib/picks/pnl.ts`** (čisté + testy), ne track-record: `flatBets` vybere sázky
  (default kritérium **EV proti vyplácenému kurzu**; `criterion: "disagreement"` přepne na rozdíl
  proti férové ceně), `summarizePnl` dá zisk, ROI, maximální propad
  a **95% CI bootstrapem**. CI tam není pro parádu — rozdělení výnosů je šikmé (většina sázek −1,
  občas +několik), takže pár set sázek dá ROI ±10 % čirým šumem. **Bez intervalu netvrď, že
  strategie vydělává.**
- **TÝMOVÉ TOTALY** (`lib/picks/teamTotals.ts`, čisté + testy; `npm run backtest -- --team-totals`)
  — **nejlepší trh, který máme mimo 1X2**, a stál nula práce navíc.
  - **Žádný nový model ani data:** týmový total je **marginála** naší mřížky skóre.
    Dosud se zahazovala.
  - **Změřeno na 9 909 odehraných predikcích** (2024+2025), potvrzeno na 2025 zvlášť.
    Úroveň λ sedí (domácí 1.541 vs 1.523, hosté 1.256 vs 1.244), Pearsonova disperze
    **0.976 / 0.993** → **Poisson tu sedí** (na rozdíl od rohů, kde je 1.137). Skill nad
    konstantou na všech šesti kombinacích: domácí +0.0196 / **+0.0274** / +0.0252
    (linie 0.5/1.5/2.5), hosté +0.0133 / +0.0197 / +0.0192. ECE **0.010–0.020**.
  - **Tohle je 3–4× víc než rohy** (+0.003…+0.008) a víc než Over 2.5 (+0.009) — a přitom
    se **neladil ani jeden parametr**, takže tu není co přefitovat; čísla jsou z principu
    out-of-sample. Nejlepší je linie **1.5** na obou stranách.
  - **Dixon–Colesovo τ marginály ZACHOVÁVÁ přesně** (pro `i=0` je oprava
    `ph₀·[1 + λₕρ(pa₁ − λₐpa₀)]` a `pa₁ = λₐpa₀` → nula; totéž `i=1`). Týmový total tedy
    číselně **je** Poisson a `poissonVector(λ)` by dal totéž. Počítá se přesto z mřížky,
    protože je to **konstrukčně** tentýž objekt jako 1X2 → trhy se nemůžou rozejít, a kdyby
    mřížka dostala korekci, která marginály nezachovává (bivariační Poisson), opraví se to
    samo. `LAMBDA_SHARPEN` marginály mění vždy (posouvá λ) → aplikuje se.
  - **Kurzy se od 27. 7. 2026 SNÍMAJÍ** („Total - Home"/„Total - Away" → `BookOdds.totalHome`
    /`totalAway`, 0 volání navíc — jsou v téže odpovědi). CLV strany `totalHomeOver`
    /`totalHomeUnder`/`totalAwayOver`/`totalAwayUnder`. Historické kurzy **nemáme**
    (football-data je nedává), takže ziskovost se dá měřit až dopředu, přes CLV.
  - **Matchery trhů se musí VZÁJEMNĚ VYLUČOVAT.** Nabídka obsahuje i „Total Corners"
    a „Total Cards"; kdyby spadly do týmových totalů, model by porovnával gólovou λ
    s kurzem na rohy **a nic by nekřičelo**. `teamTotalSide` proto ostatní veličiny
    (corner/card/booking/offside/foul/shot/throw) odfiltruje **jmenovitě dřív**, než hledá
    stranu, a „Goals Over/Under" bez home/away vrací `null` (to je total zápasu).
- **MODEL ROHŮ** (`lib/picks/corners.ts`, čisté + testy; `npm run backtest -- --corners`)
  — **jediný trh, kde model má doložený skill A je kalibrovaný.** Zatím jen změřený,
  **v produkci se nepoužívá** (`compareTeams` se nemění, nic se neukládá, 0 API volání).
  - **Konstrukce je TÁŽ jako u gólů**, jen nad jinou metrikou: `λ = ref × (rohy týmu / ref)
    × (rohy inkasované soupeřem / ref)`. Sdílí **`strengthRatio`** (proto je vyexportovaná
    z `predict.ts`), okna i `PREDICTION_WINDOW_WEIGHTS` → není to druhá implementace, která
    se může tiše rozejít. Nová metrika **`CORNERS_AGAINST`** (mimo `ALL_METRICS`, přesně jako
    `XG_AGAINST` → neukládá se, není v UI, žádný bump cache).
  - **Data zdarma a offline:** skutečné rohy vozí už `npm run import-odds` (football-data,
    sloupce `HC`/`AC`) → **12 097 zápasů (86.6 %)**; chybí jen „extra" ligy (Norsko, Dánsko,
    Rakousko), jejichž zdroj rohy nemá. Proto se dá kalibrace ověřit **dřív než se řeší kurzy**.
  - **Úroveň λ sedí skoro dokonale**: ⌀ λ 9.785 vs. ⌀ skutečnost 9.771 (domácí 5.405/5.387,
    hosté 4.380/4.384). Multiplikativní konstrukce funguje i mimo góly.
  - **Rozhodl útlum součtu λ** (`totalSpread = 0.3`, `dampenCornerTotal`). Bez něj byl model
    **horší než konstanta na všech liniích** (ECE 0.05–0.06; predikce 17 % → realita 30 %,
    73 % → 59 %). Po útlumu ECE **0.014–0.021** a konstantu poráží všude. Útlum je **agresivnější
    než u gólů** (0.3 vs 0.5) — součet λ rohů měl ještě větší přebytek rozptylu.
  - **Ověřeno hold-outem** (grid na 2024, měření na 2025 = fit ji neviděl): +0.0076 (linie 8.5),
    +0.0066 (9.5), +0.0074 (10.5), +0.0059 (11.5), +0.0032 (12.5) log-lossu nad konstantou.
    Optimum gridu je **vnitřní**, ne na hranici → fit, ne přefitování (na rozdíl od Platt kalibrace).
  - **Kolik toho signálu je týmového:** grid jde schválně až do degenerace `t = 0` (= „predikuj
    vždy ligový průměr"), a ta dá **0.6665** vs. **0.6640** v optimu vs. **0.6705** globální
    konstanta. Čili z 0.0065 nad konstantou dělá **0.0040 samotná znalost ligy** a jen **0.0025**
    informace o týmech. Signál existuje, ale je malý — velikostí srovnatelný s Over 2.5 u gólů.
  - **Rohy jsou overdisperzní → jede se na NEGATIVNĚ BINOMICKÉM rozdělení** (`varianceRatio
    = 1.2`, `overProbNegBin`), ne na Poissonu. Poisson tvrdí `rozptyl = průměr`; u rohů je
    **podmíněná** disperze **1.137** (Pearson `⌀(x−λ)²/λ`, `pearsonDispersion`) → podstřeloval
    chvosty. **Marginální poměr (1.169) na tohle není správné číslo** — je nafouknutý
    o rozptyl λ mezi zápasy, který s tvarem rozdělení nesouvisí; proto se `v` fituje gridem,
    ne dosazením. Grid je **2D společně s `totalSpread`** (obojí hýbe šířkou pravděpodobnosti
    → fitovat zvlášť by dalo falešné optimum). Hold-out 2025 (grid na 2024): NB porazilo
    Poisson na **všech pěti liniích** a přesně v chvostech — ECE na 12.5 **0.0215 → 0.0046**
    (4.7×), na 11.5 0.0138 → 0.0059; jediné zhoršení je ECE na 8.5 (0.0206 → 0.0228).
    Na skillu je to málo (+0.0024 součtem), na **kalibraci krajních linií hodně** — a ty
    trh nabízí nejšířeji (10.25 / 10.5 / 11.5).
  - **Co tohle NEŘÍKÁ: že se na rozích vydělá.** Měří se kvalita modelu, ne cena — historické
    kurzy na rohy zdroj nemá (chodí jen živě z API, marže **5–9 %** = násobek 1X2). Skill
    0.0025–0.0074 log-lossu je proti takové marži hodně málo. Další krok je snímat živé kurzy
    na rohy a měřit **CLV**, ne rovnou sázet.
- **MODEL KARET** (`lib/picks/cards.ts`, čisté + testy; `npm run backtest -- --cards`)
  — **nejlepší trh, jaký jsme zatím změřili**, a jediný, kde má model vstup, který trh
  systematicky podvažuje. Zatím jen změřený, **v produkci se nepoužívá** (`compareTeams`
  se nemění, nic se neukládá, 0 API volání).
  - **Konstrukce je TÁŽ jako u gólů a rohů**, jen nad jinou metrikou:
    `λ = ref × (karty týmu / ref) × (karty, které tým vyvolá u soupeřů / ref) × rozhodčí`.
    Sdílí `strengthRatio`, okna i `PREDICTION_WINDOW_WEIGHTS`, rozdělení počtu událostí
    (`overProbNegBin`) sdílí s rohy. Nové metriky `CARDS`/`CARDS_AGAINST` jsou mimo
    `ALL_METRICS` (jako `XG_AGAINST`/`CORNERS_AGAINST`) → 0 API, žádný bump cache.
  - **Data zdarma a offline:** karty (`HY/AY/HR/AR`) vozí `npm run import-odds`
    (football-data → `MatchFacts`) – **8 020 zápasů (57 %)**.
  - **Rozhodčí bereme z API-Football, ne z football-data** (`fixture.referee` v `/fixtures`).
    Ověřeno živě: je vyplněný i tam, kde football-data jméno nemá vůbec – Řecko, Turecko
    **i Fortuna liga**. Pokrytí tím šlo z **29 % na 100 %** a stálo to **48 volání**
    (1 na ligu+sezónu, `npm run backtest -- --refresh`; jde o tutéž odpověď, ze které
    bereme rozpisy → **0 volání navíc** při běžném provozu). Jména se sjednocují
    `normalizeRefereeName` – API píše „R. Jones", football-data „R Jones", a bez toho by
    se týž sudí rozpadl na dvě identity s půlkou vzorku každá.
  - **Skill nad konstantou (hold-out 2025, fit běžel jen na 2024): +0.0108 … +0.0242** na
    liniích 2.5–6.5, ECE 0.011–0.027. Na plném vzorku +0.0153…+0.0272. To je **3–8× víc
    než rohy** (+0.003…+0.008) a srovnatelné až lepší než týmové totaly (+0.013…+0.027).
    Úroveň λ sedí (4.30 vs. 4.23 skutečnost, mírné nadsazení ~1.5 %).
  - **Overdisperzní jako rohy** → negativně binomické (`varianceRatio = 1.2`, Pearson
    1.154–1.173). **Nezvyšovat podle hlavní linie** – na 4.5 vypadá log-loss plochý až do
    1.4, ale ECE krajní linie 2.5 mezitím jde 0.012 → 0.026 (v=1.5) → 0.045 (v=1.7).
  - **ROZHODČÍ: přidává +0.0114 (hold-out) až +0.0152 (plný vzorek) log-lossu, kladně na
    VŠECH pěti liniích – ale JEN když se pořádně smrští.** Dvě chyby, které to nejdřív
    obrátily do záporu (−0.0024), a obě jsou poučné dál:
    1. **Jmenovatel musí být λ týmového modelu, ne ligový průměr.** Sudí nedostávají
       zápasy náhodně – kdo píská derby, ukáže víc karet, i když je průměrný. Proti
       ligovému průměru vyjde „přísný" a faktor **podruhé započítá to, co už týmová část
       λ obsahuje**. Proto `backtestCards` běží **dvoufázově**: nejdřív λ bez sudího pro
       celou historii, teprve z nich se staví index rozhodčích (a je to i **levnější** –
       fáze 3 už jen násobí faktorem, protože sudí se aplikuje až za útlumem).
    2. **Pozorované rozpětí mezi sudími je z valné části ŠUM.** Vypadá obrovsky
       (2.30–6.50 karty = ~99 % průměru), ale při ~58 zápasech na sudího je vzorkovací
       šum v tom průměru srovnatelný s pozorovaným rozptylem mezi sudími. Proto
       `refShrink = 50` a proto je model **bez smrštění (`refShrink = 0`) HORŠÍ, než
       kdyby o sudím nevěděl vůbec** (−0.0152). Optimum je ploché mezi ~25 a ~100,
       mimo ten pás rychle padá. **Syrový průměr rozhodčího škodí** – tohle je hlavní
       poučení a platí obecně pro každý vstup s malým vzorkem na kategorii.
  - **Fauly ze zápasu model zlepšují, ale málo** (`foulWeight = 0.3`, `--cards-grid-fouls`).
    Hypotéza byla, že budou přesnější než karty (~11 na tým a zápas proti ~2 → menší
    vzorkový šum, jako xG proti gólům). **Potvrdila se jen zčásti:** samotné fauly jsou
    zřetelně **horší** než samotné karty (`foulWeight = 1` → Σ skill 0.0906 vs 0.0935),
    protože nesou jen část informace – rozhodčí kartuje i za protesty, zdržování a fauly
    na poslední obránci. Přimíchat se ale vyplatí: hold-out 2025 dá **+0.0050** Σ skillu
    proti nule, a to **na všech pěti liniích**. Pořadí přínosů: **rozhodčí (+0.0114) ≫
    fauly (+0.0050)**. Míchá se **vlastní funkcí, ne `blend` z `predict.ts`** – ta bere
    `ref` z prvního argumentu a při chybějící první straně by λ postavila na faulovém
    měřítku (~11 místo ~2) a nic by nespadlo.
  - **Kurzy na karty se od 28. 7. 2026 SNÍMAJÍ** (`BookOdds.cards`, `LineMarket` `"cards"`,
    CLV strany `cardsOver`/`cardsUnder`). **0 volání navíc** – jsou v téže odpovědi
    `/odds`, a `saveOdds`/`saveClosingOdds` ukládají `books` jako JSON vcelku, takže se
    pipeline nemusela měnit vůbec. Čte se přes tytéž `marketLines`/`mainLine`/
    `bestLinePrice`/`sharpLineFair` jako rohy a týmové totaly (zkratky `cardLines`&spol.),
    tedy **párování po lince je povinné**.
  - **JEDNOTKA JE U KARET PAST** – větší než u rohů. `isCardBet` proto snímá **jen trh
    počítaný v kartách** a jmenovitě odmítá: **booking points** (žlutá 10, červená 25 =
    jiná stupnice), **„jen žluté"/„jen červené"** (jiná veličina než `cardCount`),
    **týmové karty** a **poločasové / „první karta"**. Kdyby některý prošel, model by
    porovnával λ v kartách s cenou v bodech a **nic by nekřičelo**. Kryto testem, který
    hlídá i to, že se `isCornerBet`/`isCardBet`/`teamTotalSide` **vzájemně vylučují**.
    Sonda `npm run probe-odds -- <fixtureId> --markets` značí trhy **skutečnými matchery**
    (ne jejich kopií) a zvlášť vypíše trhy s kartami, které se vědomě nesnímají.
    Zbývá ověřit **pravidla vypořádání konkrétní knihy** (počítá druhou žlutou jako
    jednu kartu, nebo dvě?) – to z názvu trhu poznat nejde.
  - **Co tohle NEŘÍKÁ: že se na kartách vydělá.** Měří se kvalita modelu, ne cena.
    Historické kurzy na karty zdroj nemá, marže je 5–9 % (násobek 1X2) a skill +0.02
    log-lossu je proti ní pořád málo. Další krok je **měřit CLV**, ne sázet.
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

## Záložka Porovnání — kategorie, styl hry, ligový benchmark (FREE)
- **Přepínač pohledu** (`viewMode` state v `CompareApp.tsx`): 3 režimy — **Raw statistiky** (původní
  19 metrických řádků) / **Kategorie** / **Styl hry**. Přepínač `Segmented` nad metrikami,
  stav lokální per výsledek (reset při novém porovnání). **FREE**, žádné gating.
- **Kategoriové skóre** (`lib/stats/categories.ts`, `app/_components/CategoryScores.tsx`):
  čistá funkce `computeCategoryScores(homeValues, awayValues, venue, mode)` → 5 `CategoryScore` objektů
  (Útok / Obrana / Hra s míčem / Tvorba šancí / Disciplína), každý 0–10 pro oba týmy.
  Normalizace je **relativní** (ne absolutní): `ratio = home / (home + away)` → `score = ratio × 10`.
  Metriky s `LOWER_IS_BETTER` invertovány. Jeden nebo oba null → metrika se přeskočí (nezkresluje váhy).
  `available: false`, až když kategorii nezbude **žádná** metrika s daty.
- **Styl hry** (`lib/stats/playStyle.ts`, `app/_components/PlayStyleChart.tsx`):
  čistá funkce `computePlayStyle(homeValues, awayValues, venue)` → 4 `PlayStyleDimension` (Kontrola
  míče / Styl útoku / Pressing / Efektivita střel). Škálování je **absolutní** (fixní rozsahy), ne
  relativní vůči soupeři → říká „tenhle tým hraje kombinačně" nezávisle na soupeři.
  Formule: Kontrola míče = `clamp((POSSESSION−30)/40, 0,1)×10`; Styl útoku = `SHOTS_INSIDE/(inside+outside)×10`;
  Pressing = `clamp((FOULS−8)/12, 0,1)×10`; Efektivita = `SHOTS_ON_TARGET/SHOTS×10`.
  Dostupnost dimenze se řídí **výhradně daty** (metrika chybí → `available: false`); funkce proto
  ani nebere `mode`. Dřív měly Kontrola míče + Styl útoku natvrdo `unavailableForNational: true`,
  což je reprezentacím zhaslo **i když data byla** – viz „Reprezentace mají skoro plnou sadu metrik".
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
- **Ligová tabulka rovnou v Porovnání** (FREE): pod pozicemi (`StandingContext`) **collapsible
  „Ligová tabulka"** (default sbalená) s celou tabulkou ligy a **oběma týmy zvýrazněnými**
  (`highlightTeamIds`). Líný hook `useLeagueTable(leagueId, enabled)` (vzor `useStanding`) →
  `/api/standings/table`, aktivní **jen `mode==="CLUB" && homeLeagueId===awayLeagueId`** (různé
  ligy/reprezentace → nevykreslí se); FREE i pro `result.locked`. Sdílí `standings:` cache
  (0 API navíc). Renderer je **sdílená komponenta `app/_components/StandingsTable.tsx`** (vytknuto
  z `TabulkyApp`: `StandingsTable`+`ZoneLegend`+…, prop `highlightTeamIds?: Set<number>`).
- **Nové typy** (`lib/types.ts`): `CategoryKey`, `CategoryScore`, `PlayStyleDimension`, `LeagueGoalsAvg`.

## Záložka Tabulky (FREE, `/tabulky`)
- **Princip:** celá tabulka vybrané klubové ligy (pozice, V-R-P, góly, rozdíl, body, forma) s barevným
  zvýrazněním evropských / postupových / sestupových zón. **0 API volání navíc** – sdílí `standings:`
  cache s Porovnáním, Programem i Hrou, takže cold liga spustí nejvýš 1 upstream fetch (a ten pak
  využijí ostatní záložky).
- **Čisté funkce** (`lib/data/standings.ts`, testy `standings.test.ts`): `normalizeLeagueTable`
  (`ApiStandingRow[]` → `LeagueTableRow[]`, řadí dle `rank`) + `zoneFromDescription`
  (`description` → `LeagueTableZone` = champions/europa/conference/promotion/relegation).
  `zoneFromDescription` **sdílí pasti s `deriveLeagueAccess`** (viz Hra): soutěž se hledá jen **PŘED
  závorkou** (domácí play-off o Evropu „(Conference League - Play Offs)" se nepočítá), **jistý sestup**
  popisek **začíná** slovem `relegation` a nesmí obsahovat `round`/`group`/`play-off` (to je baráž
  nebo fázový split nadstavby). Neznámý popisek → `null` (žádné zvýraznění), ne odhad.
- **Data:** `getLeagueTable(leagueId)` (`repository.ts` → real/mock) vrací `{rows, leagueAvg}`;
  reprezentace/nedostupná liga → `null`. Route `app/api/standings/table` je **FREE** (veřejná
  statistika, bez auth), ale **rate-limitovaná** jako `/api/standings` (cold cache = upstream fetch);
  chyba → `{table: null}` + 200, aby UI ukázalo prázdný stav, ne error. Předsezóna (0 odehraných) =
  prázdný stav. Mock: deterministická tabulka z mock týmů → funguje bez DB/API.
- **UI `TabulkyApp.tsx`** (client, mobile-first): horizontální pásek lig (`CLUB_LEAGUES`), poslední
  zvolená liga v `localStorage`, legenda dedupovaná **podle popisku** (jako v Hře). Samotný renderer
  tabulky je **sdílená komponenta `app/_components/StandingsTable.tsx`** (`StandingsTable`+`ZoneLegend`),
  kterou používá i Porovnání (viz „Ligová tabulka rovnou v Porovnání") – jeden zdroj pravdy.

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
  profile:ManagerProfile, manager:{reputation}, current:SeasonState|null, history[]}` + volitelné
  `tournament`/`tournamentHistory` (reprezentace) a `cup`/`cupHistory` (klubový pohár);
  `SAVE_VERSION` = **10**. Appka běží živě → bump **nesmí zahodit rozehranou kariéru**: `migrateSave`
  (`HraApp.tsx`) migruje **řetězeně** (5 → 6 → … → 10) a jen doplní nová pole; teprve neznámá verze se
  zahodí. „Nová kariéra" nemaže profil (jen `current:null`).
  **Ukládání je frontové** (nejvýš jeden `PUT` naráz, vždy se pošle nejnovější stav): dva rychlé
  requesty se mohly vrátit v opačném pořadí a **starší stav přepsal novější** (rychlé klikání, dva
  otevřené taby). Nevracet zpět na „fire-and-forget" `PUT` per akce. Scoped `app/hra/error.tsx`
  (error boundary), potvrzovací dialogy jsou vlastní modal (ne nativní `confirm()`).
- **UI `HraApp.tsx`** (client, mobile-first): anonym → přihlášení; **bez aktivní kariéry → `ManagerHub`**
  (profil + „Začni kariéru" → gated výběr ligy→klubu, sekce „Nejvyšší ligy" / „2. ligy"); s kariérou →
  sezóna (predikce + **scouting** (`ScoutCard`: hlášený styl / „styl neznámý", konfidence obarvená dle
  `quality`, odhalené traity, u `detailed` řádek „🎯 Skauti radí") + **morálka** + **kondice**
  (`FitnessBar`, ukazuje i posun kondice za kolo dle plánu) + **„Čísla soupeře"** (`EvidencePanel`) +
  **plán** + **vedlejší instrukce**
  (`InstructionPicker`) + **event karta**, popup `MatchResultToast`, tabulka, forma, cíl) +
  taby **Kariéra** a **Profil**. `ProfilePanel` (sdílený hub/tab, **žije v `app/_components/hra/Profile.tsx`**
  – vytknutý z `HraApp.tsx` i s hubem, výběrem reprezentace, rekordy, historií a achievementy):
  hlavička + kariérní rekordy + **klub / reprezentace / pohár** (skutečné rekordy, ne placeholder)
  + `AchievementsGrid`
  (odemčené barevně dle tier, zamčené šedé). Nákladné komponenty (tabulka, pavouk, achievementy)
  jsou `React.memo`. Scouting hlásí nejistotu **vizuálně** (`StyleCompass` místo holého „spíš útočný");
  kreslí se pořád jen z `reportedStyle`/`confidence`, **nikdy ze skryté pravdy**. `EvidencePanel`
  ukazuje srovnávací pruhy vůči ligovému průměru. `SeasonDone` ukazuje nově odemčené („🏅 Odemčeno") a
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
- **Regrese tvého klubu běží AŽ ZA renormalizací** (`regressToMean` v `career.ts`). `renormalize`
  je afinní na celou ligu, takže regresi uvnitř driftu **přesně vyruší** (zmenší odchylky o
  `1−reg`, přeškálování je vrátí o `1/(1−reg)`). Dokud měl tvůj klub uvnitř driftu vlastní nižší
  `reg` (mládež), nepřežil z toho útlum, ale **rozdíl**: odchylka se násobila
  `(1−reg_ty)/(1−DRIFT_REGRESSION) > 1` → mládež odchylku od průměru skládaně **nafukovala**
  (silný klub rostl zadarmo, slabý se propadal hlouběji) a regrese k průměru neexistovala vůbec.
  Změřeno: 6 sezón bez investic, odchylka útoku +0.84 → +1.21 (mládež 5) vs +0.87 (bez mládeže).
  Dnes drift regreduje všechny stejně (= no-op po renormalizaci, jen šum a `DRIFT_PERFORMANCE`
  přemíchají pořadí) a tvůj klub dostane regresi až po ní, tlumenou `youthRegression`. Kryto
  testem „drift regreduje tvůj klub k průměru, mládež to tlumí".
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
- **Klubový pohár (Liga mistrů-styl) — HOTOVO** (`lib/game/clubCup.ts` + `clubCupPool.ts`, čisté +
  `clubCup.test.ts`): třetí režim vedle klubové ligy a reprezentace, staví na témže `tournament.ts`
  (skupiny + pavouk), běží **paralelně** ke klubové sezóně jako sub-tab.
  - **Kvalifikace se NEODEHRÁVÁ, jen vyhodnotí** (na rozdíl od `nationalCompetitions.ts`): klub, který
    minulou sezónu skončil na evropské příčce (`SeasonSummary.europe !== "NONE"` → `clubQualifies`),
    je příští sezónu v poháru. Proto `CupRun` nemá fázi `qualification` ani `tournament: null` mezistav.
  - **Formát** `CLUB_CUP_FORMAT`: 8 skupin po 4 = **32 týmů** → osmifinále (`bestThirds: 0`).
    Vědomé zjednodušení reálné LM.
  - **Pole = ty + vážený los ze statického poolu** (`CLUB_CUP_POOL`): 40 **fiktivních** klubů ve
    4 tierech, ratingy deterministicky z **fixního interního seedu** (`POOL_SEED`) → pool je **stabilní
    napříč hrami** (hráč pozná „věčné giganty"), stejně jako `NATIONAL_TEAMS` u reprezentací. Reálná
    jména se **nepoužívají** – appka nemá cross-league snapshot 12 lig, ze kterého by je postavila
    daty; `lib/game/` zůstává offline. ID prostor `9_000_000+` = mimo API-Football i fiktivní ligu.
  - **Vlastní RNG proud** `RNG_SALT_CUP`. `startCupRun` musí po přepnutí saltu **přepočítat počáteční
    `pendingEvent`** – `newTournament` ho spočítala ještě pod `RNG_SALT_TOURNAMENT`, takže první event
    poháru by na stejném seedu koreloval s prvním eventem reprezentačního turnaje.
  - **Vlastní reputace i síň slávy:** `updateReputationCup` (paralelní k `updateReputation`/
    `…Tournament`, se stejným `applyCeiling`), `CupSummary` + `foldCup` plní **vlastní pole**
    `AllTimeRecords` (`cupsPlayed`/`cupTitles`) – ligové `titles` se nedotknou. Třetí registr
    `CUP_ACHIEVEMENTS` + `newlyEarnedCup`, slučuje se v `ALL_ACHIEVEMENTS`.
  - Agency (plán, counter, instrukce, morálka, kondice, eventy) běží beze změny přes `AgencyState`;
    `cupPreview` ignoruje zvolený plán (anti-exploit, jako `yourNextMatch`/`runPreview`).
- **Sdílení dohraného výsledku** (sezóna / turnaj / pohár): `shareOrCopy` (`app/_components/share.ts`,
  nativní share sheet s fallbackem na schránku, sdílené s `AppHeader`) → veřejná landing stránka
  **`/hra/vysledek`** + OG karta **`/og/hra`**. Stránka čte **jen query string** (klub, headline,
  kontext, tituly) – **žádný lookup cizího save** (appka pro něj nemá veřejné API), takže scraper
  odkazu nespustí žádné API ani DB volání. Stejný vzor jako sdílení Porovnání.
- **Možná rozšíření (TODO):** víc reprezentačních soutěží (Copa/AFCON…) = položka v `COMPETITIONS`;
  reálný snapshot klubů do `CLUB_CUP_POOL` přes cross-league fetch skript (analogicky
  `npm run build-national-teams`) místo fiktivních jmen.
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
- **Druhý OG obrázek** `app/og/hra/route.tsx` + landing `app/hra/vysledek/page.tsx`: sdílení
  dohrané sezóny / turnaje / poháru z Manažera (viz „Sdílení dohraného výsledku"). Taky **bez
  server lookupu** – vše přijde v query stringu.
- **`app/sitemap.ts` + `app/robots.ts`** (Next metadata routes): sitemap = 6 hlavních záložek
  (`/` Zápasy, `/porovnani`, `/tabulky`, `/predikce`, `/transfers`, `/hra`; konkrétní porovnání
  se neindexují plošně – kombinatorika + canonical, a `/digest` je vynechaný záměrně jako
  PRO-locked), robots povolí vše kromě `/api/`. BASE z `AUTH_URL` (fallback prod doména).
- **Analytika:** Vercel Web Analytics (`@vercel/analytics`), `<Analytics/>` v `layout.tsx`
  (pageviews zdarma, bez cookies; aktivní jen na Vercelu v produkci). Vlastní eventy přes
  `track(...)`: `share` (`AppHeader`), `signin_from_prolock` / `trial_unlock` (`ProLock`).
  **JSON-LD vynecháno záměrně** (`SportsEvent` sémanticky nesedí na statistické porovnání).

## DB
Prisma 6 + Postgres (Neon). Tabulky `ApiCache` (TTL) + `MatchStatCache` (trvalá)
+ účty (`User`/`Account`/`Session`/`VerificationToken`) + `SavedComparison` (oblíbená porovnání)
+ `UserTip` (Tipovačka) + `GameSave` (Manažer) + `FavoriteLeague`/`FavoriteFixture`
(oblíbené zápasy/ligy v Programu, PRO – viz „Záložka Zápasy").
**Pozor:** Neon je sdílená pro lokál i Vercel → změna schématu (`prisma db push`)
ovlivní i produkci; nasaď nový kód hned.
**Verzování cache:** `MatchStatCache` má `schemaVersion`; po přidání metrik bumpni
`CURRENT_CACHE_VERSION` (`cache.ts`) → staré řádky se přestanou číst a samy se
dotáhnou znovu (zadarmo) s plnou sadou. Žádné plošné mazání. `saveMatchStats`
proto dělá upsert (ne createMany). Po nasazení případně urychli přes `/api/warm?league=ID`.

## Plánované úlohy (crony) — POZOR: Vercel Hobby, spouští je GITHUB ACTIONS
- **Rozvrh žije v `.github/workflows/cron.yml`, ne ve `vercel.json`** (ten je prázdný).
  Důvod je tvrdý limit plánu: **Vercel Hobby dovolí 2 cron joby a jen denní frekvenci.**
  Úloh je šest a snímky kurzů musí běžet **hodinově**, jinak zavírací linii dostanou jen
  zápasy s výkopem 04:30–16:30 UTC (viz `ODDS_CLOSING_HOURS`). Actions to zvládnou zdarma.
  Jeden vlastník rozvrhu = žádné dvojité běhy; **nevracet crony do `vercel.json`**.
- **Nastavení v GitHubu** (Settings → Secrets and variables → Actions): secret `CRON_SECRET`
  (stejná hodnota jako env na Vercelu) + variable `APP_URL` (`https://…`, bez lomítka).
  Workflow umí i ruční spuštění (Actions → Cron → Run workflow → vyber úlohu).
  `curl --fail-with-body` = nenulový exit u 4xx/5xx, ale tělo se vypíše → v logu je vidět
  důvod (401 = nesedí secret). Bez `--fail*` by curl uspěl i na 500 a úloha selhávala tiše.
- **`maxDuration` je na Hobby STROPOVANÁ NA 60 s a vyšší hodnota se tiše ignoruje.**
  Tohle už jednou způsobilo škodu: routa `predict-upcoming` měla `maxDuration = 300`
  a `DEFAULT_BUDGET_MS` 4 minuty, takže **vnitřní rozpočet nikdy nedoběhl** a běh vždycky
  zabil platformní timeout — to je ten stav z poznámky „běh v 04:30 byl zabit v 04:31:03".
  Zvýšení `maxDuration` ho tedy neopravilo, jen skrylo. Dnes je `maxDuration = 60` všude
  a rozpočet **50 s**. Nezvyšovat bez Pro plánu; místo delšího běhu se spoléhej na
  **rotaci soutěží** (`rotateLeagues`) — jeden běh pokryje část a zbytek dojede další dny.
- Ověření, že úlohy skutečně běží: GitHub → Actions → Cron (zelená/červená u každého běhu
  a v logu odpověď endpointu). Vercel dashboard už crony neukazuje, protože tam žádné nejsou.

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

## STAV K 28. 7. 2026 — kde jsme skončili a čím pokračovat

**Všechno je commitnuté, nasazené a ověřené.** Pracovní strom je čistý, `main` je
odpushovaná, schéma v Neonu sedí, crony běží a endpointy jsou zamčené. Nic nevisí.

**Jediné, co teď blokuje pokrok, je START LIG 7. 8.** Model je změřený tak daleko, jak
to bez čerstvých dat jde; další krok potřebuje živé kurzy, ne další přeskládání téhož.

### Odpověď na hlavní otázku (drž ji v hlavě)
„Dá se z našich dat postavit profitabilní sázecí model?" → **na gólových trzích ne**
(1X2 log-loss 1.0239 vs. trh 0.9760, ROI −5 až −11 %, a **přísnější práh hrany to
zhoršuje**). Model má **skill, ale ne hranu**; mezi tím stojí marže. Nezkoušet to znovu
bez nového vstupu — viz „Co nezkoušet znovu" níže.
**Od 28. 7. je to doložené i nejtvrdším možným způsobem** (`npm run backtest -- --ah`,
8 021 zápasů): naše odchylka od sharp linie nese **β₂ = 0.007 ± 0.039** informace, tedy
nulu — a to i po ligách. Padá tím i „model jako korekce trhu"; optimální posun sharp linie
naší predikcí je **0 %**. Zaostáváme skoro celý na ose **kdo je lepší**, ne na ose
**kolik padne gólů** (RMSE +0.095 vs. +0.032).
Otevřená zůstává jediná větev: **trhy, kde model něco umí a kde jsme ještě neviděli cenu**
(týmové totaly, rohy, nově karty). Verdikt o nich přijde z **CLV**, ne z výsledků.

### Kde má model skill (pořadí = kam se dívat první)
| trh | skill nad konstantou | kurzy | ověřeno proti ceně |
|---|---|---|---|
| 1X2 | +0.053 | ✅ | **ANO — prohráváme** |
| **Karty** | **+0.011…+0.024** (hold-out; sudí +0.011, fauly +0.005) | ✅ od 28. 7. | ne |
| **Týmové totaly** | **+0.013…+0.027** (nejlíp linie 1.5) | ✅ od 27. 7. | ne |
| Over 2.5 | +0.009 | ✅ | částečně (ROI −1.8 %, CI přes nulu) |
| Rohy | +0.003…+0.008 | ✅ od 27. 7. | ne |
| BTTS | **žádný** | záměrně ne | — |

**Pozor na srovnávání sloupce „skill":** karty a rohy jsou měřené na hold-outu, 1X2
a totaly na plném vzorku. Hlavní rozdíl ale není velikost čísla, ale **odkud pochází**:
u karet je zhruba polovina přínosu z **rozhodčího** – informace známé předem, kterou
rekreační kniha do linie často nedává. To je jediný trh, kde nemáme jen lépe spočítané
průměry. Zároveň je tam nejvyšší marže (5–9 %), takže verdikt stejně padne až z CLV.

### Hotovo 28. 7. (vše nasazené)
- **Zavírací linie je konečně zavírací**: okno 12 h → **3 h**, cron **hodinově**
  (`20 * * * *`). Dřív padal „zavírací" snímek 9–12 h před výkopem. 0 volání navíc.
- **Časová řada kurzů** (`oddsSeries`) – kompaktní bod, kadence se zužuje k výkopu.
  Jediná změna, která zdražila kvótu (~340 volání/den; celkem ~2 100 ze 7 500).
- **AH diagnostika** (`lib/picks/asianHandicap.ts`) → **gólové trhy jsou uzavřené.**
  β₂ = 0.007 ± 0.039, po ligách nic. Padá s tím i „model jako korekce trhu".
- **MODEL KARET** (`lib/picks/cards.ts`) – nejlepší změřený trh: +0.011…+0.024 na hold-outu,
  z toho **rozhodčí +0.011** a **fauly +0.005**. Kurzy na karty se snímají (0 volání navíc).
- **Rozhodčí z API-Footballu** (`fixture.referee`) → pokrytí 29 % → **100 %** za 48 volání,
  včetně lig, které football-data nemá vůbec (Řecko, Turecko, Fortuna liga).
- **Dotěžení football-data**: zavírací AH + `MatchFacts` (karty, fauly, střely, poločas).
- **Přehled zápasu ve Výsledcích** (`lib/stats/matchReport.ts`) – kategorický obraz místo
  syrových čísel; jediná věc z téhle várky, která je pro uživatele, ne pro model.

### Hotovo 26.–27. 7. (vše nasazené)
- **Sezónní údržba:** rotace + rozpočet predikčního cronu, `MIN_READABLE_CACHE_VERSION`,
  fallback formy pro nováčky, filtr lig do dotazu ve Výsledcích, `cachedJson` neukládá
  `null`, readiness přestal počítat zápas třikrát, baseline padá na loňskou tabulku.
- **Oprava, která odblokovala kurzy:** zod schéma `/odds` padalo na numerickém `value`
  → v produkci **nebyl uložený ani jeden kurz**. Viz „EV / value tipy".
- **Změřená odpověď o profitabilitě** (`npm run import-odds` + sekce „vs. TRH").
- **Poctivější UI:** `edgeFair`, „kde se lišíme od trhu" místo „value tipy", `MarketPanel`.
- **CLV** (`lib/picks/clv.ts` + `ClvPanel`), nově proti **sharp konsenzu**.
- **Všech ~13 sázkovek** (`oddsBooks`) → line-shopping, `ValueEstimate.best`, odznak v `PickRow`.
- **MODEL ROHŮ** (`lib/picks/corners.ts`): kalibrovaný, poráží konstantu, **negativně
  binomické** rozdělení (overdisperze 1.137).
- **TÝMOVÉ TOTALY** (`lib/picks/teamTotals.ts`): nejlepší trh mimo 1X2, **nula nového modelu**.
- **Kurzy na rohy i týmové totaly** se snímají (0 volání navíc).
- **Crony přesunuty do GitHub Actions** + narovnání na limity Vercel Hobby (viz níže).

### ⚠ Vercel Hobby — dvě věci, které tiše kazily provoz (opraveno 27. 7.)
1. **`maxDuration` je stropovaná na 60 s a vyšší hodnota se ignoruje.** `predict-upcoming`
   měla 300 a rozpočet 4 min → vnitřní rozpočet **nikdy nedoběhl** a běh vždy zabil
   timeout. Zvýšení `maxDuration` (26. 7.) problém neopravilo, jen **skrylo**.
2. **Hobby dovolí 2 crony a jen denně**, my měli šest → část neběžela vůbec.
→ Rozvrh je nově v `.github/workflows/cron.yml`, `maxDuration = 60`, rozpočet 50 s.
**Nezvyšovat zpátky bez Pro plánu.** Detaily v sekci „Plánované úlohy".

### ⚠ NEOVĚŘENO proti živému API (udělej to hned, jak bude první zápas s kurzy)
Parsování **rohů, KARET i týmových totalů** vzniklo v mezisezóně, kdy `/odds` nevrací nic.
Je psané obranně (hledá trh podle **názvu**, ne podle uhodnutého id; nesmysl → prázdno
místo pádu) a matchery jsou kryté testy včetně vzájemné výlučnosti, ale **žádný test je
nedrží proti reálným názvům trhů**:
```
npm run probe-odds -- <fixtureId> --markets
```
Vypíše linie všech čtyř trhů zvlášť a v seznamu označí `← ROHY` / `← KARTY` /
`← TÝMOVÝ TOTAL` — **skutečnými matchery z `apiFootball.ts`**, ne jejich kopií, takže
sonda ověřuje tu logiku, která data opravdu plní. U karet navíc vypíše trhy se slovem
„card", které se **vědomě nesnímají** (booking points, „jen žluté") — tam zkontroluj,
že mezi nimi není ten, který jsme chtěli.

### Co zbývá — A) po startu lig 7. 8. (jen ověřit, nic nestavět)
1. **Parsování rohů a týmových totalů** proti živému API — `npm run probe-odds --
   <fixtureId> --markets`. Viz varování výše. **Tohle udělej první**, celý sběr na tom stojí.
2. **Kurzy padají do DB:** v `FixturePrediction` přibývá `oddsHome`, `oddsCloseAt`,
   `oddsBooks`/`oddsCloseBooks`. Zvlášť ověř **dvě věci najednou**: že zavírací snímek
   chodí i u **večerních** zápasů, a že `oddsCloseAt` je **~1–3 h před výkopem**, ne
   deset hodin. Dřív padal 9–12 h předem (viz níže) – kdyby se to vrátilo, CLV měří
   pohyb, který skončil dávno před zavřením.
3. **CLV panel** na `/predikce` naskočí kolem 10. 8., použitelný vzorek spíš **září/říjen**.
   `ClvSummary.sharpShare` řekne, kolik tipů se měří proti sharp konsenzu.

### ✅ „ZAVÍRACÍ" LINIE UŽ ZAVÍRACÍ JE (opraveno 28. 7. 2026)
`ODDS_CLOSING_HOURS` bylo **12 h** a cron běžel **každé 3 h**. `fixturesNeedingOdds` ale
bere **první** běh uvnitř okna, takže „zavírací" snímek padal **9–12 h před výkopem** –
u večerního zápasu odpoledne předchozího dne. CLV tím měřilo pohyb z T−72 h na T−10 h
a **celý poslední den, kde je pohyb nejostřejší, chybělo**.
Dnes je okno **3 h** a cron jede **hodinově** (`20 * * * *`) → snímek padne kolem **T−3 h**
a zbývají dva pokusy, kdyby běh vypadl. **Kvóta se nezměnila ani o volání** – guard drží
dva snímky na zápas za život bez ohledu na frekvenci, mění se jen *kdy*.
**Ta dvě čísla musí sedět dohromady:** okno musí zůstat **širší než perioda běhu**, jinak
zápas mezi dvěma běhy propadne a zavírací snímek nedostane vůbec. Nezkracovat okno bez
zrychlení cronu (a naopak).

### B) Sázecí model — otevřené
4. **Verdikt o týmových totalech a rozích z CLV.** Jediná živá otázka. Pořadí podle skillu:
   **nejdřív týmové totaly** (3–4× lepší než rohy, linie 1.5), pak rohy. **CLV, ne ROI** —
   na verdikt z výsledků by při téhle velikosti signálu byly potřeba tisíce sázek.
5. ~~**Model jako korekce trhu, ne náhrada.**~~ **UZAVŘENO 28. 7. 2026** změřením
   (`--ah`): optimální váha naší odchylky od sharp linie je β₂ = 0.007 ± 0.039 = nula,
   po ligách taky. Prior z trhu posouvat nemáme čím. **Další informace musí přijít
   zvenčí** (sestavy, shot-level xG, rozhodčí u karet), ne z přeskládání téhož.
6. ~~**MODEL KARET**~~ **HOTOVO 28. 7. 2026** — postavený, fitnutý a ověřený hold-outem
   (viz „MODEL KARET" výše). Nejlepší změřený trh: +0.009…+0.021 nad konstantou, z toho
   ~polovina z **rozhodčího**. Snímání kurzů je **taky hotové** (0 volání navíc).
   **Zbývá na něm jen to, co potřebuje živou sezónu:**
   a) **ověřit parsování proti živému API** — `npm run probe-odds -- <fixtureId> --markets`
      (vzniklo v mezisezóně, kdy `/odds` nevrací nic),
   b) **ověřit konvenci vypořádání** konkrétní knihy — počítá druhou žlutou jako jednu
      kartu, nebo dvě? Z názvu trhu to poznat nejde a model počítá žluté + červené,
   c) **měřit CLV**, ne ROI.
   Pokrytí rozhodčích je **100 %** (bereme je z `/fixtures` API-Footballu, viz výše),
   takže model platí pro všechny ligy včetně Fortuna ligy.
7. **BRÁNA (drž ji):** do stakingu, bankrollu ani Kelly **neinvestovat**, dokud aspoň
   jeden trh nemá kladné CLV nebo ROI s intervalem spolehlivosti mimo nulu. Dnes takový
   trh **není**. Kelly je násobič hrany — na záporné hraně jen zrychluje ztrátu.

### C) Nezávislé na sezóně (dá se dělat kdykoli)
7. **Stripe dodělat** — kód hotový, blokují ruční kroky (Price ID, `.env`, lokální test,
   go-live) a **obchodní podmínky + DPH/OSS**, které musí být hotové PŘED prvním
   zaplacením. Detaily v sekci „Platby (Stripe)".
8. **Go-to-market** — Search Console + sitemap → vlastní doména (pozor: mění `AUTH_URL`
   **i** Google OAuth redirect URI) → příspěvky do komunit s konkrétním zápasem.
   Detaily v sekci „Go-to-market".
9. **iOS Safari zoom** — viz „Známé problémy".

### Co nezkoušet znovu (změřeno, zamítnuto)
- Porazit zavírací linii na 1X2 / Over 2.5 / BTTS gólovými průměry, xG a střelami.
- **„Model jako korekce trhu" na gólových trzích** – změřeno přímo (`--ah`, 8 021 zápasů):
  optimální váha naší odchylky od sharp linie je **β₂ = 0.007 ± 0.039**, tedy nula, a to
  s intervalem těsným dost na to, aby vyloučil i malou hranu. Platí i **po ligách** (nic
  nepřežije ani nekorigovaný |t| > 2) → hypotéza „v tenkém trhu to půjde" je vyvrácená.
  Naše λ má správnou **úroveň**, jen je **šumnější** než trh; chybí informace, ne kalibrace.
- Zpřísňovat práh hrany, aby se ROI zlepšilo – **zhoršuje ho** (−7.7 % → −8.9 %).
  Je to podpis modelu bez hrany: kde vidí největší výhodu, tam se nejvíc mýlí.
- Platt kalibrace (`CALIB_A/B`) – fit skončil na hranici gridu se ziskem 0.0007.
- Zostření λ (`LAMBDA_SHARPEN`) – optimum s = 1.00.
- Historické kurzy z API-Football – **nevrací je** (ověřeno třemi tvary dotazu).
- Bivariační Poisson (společný šok λ₃) na BTTS – šum, a 1X2 se zhorší.
- **Další ladění λ u rohů** – vyčerpáno (grid jde až do degenerace „predikuj ligový
  průměr", optimum je vnitřní). Příští informace musí přijít zvenčí.
- **Zvyšovat `maxDuration` nad 60 s** bez Vercel Pro – tiše se ignoruje (viz výše).

### Zásady, které se osvědčily (platí i pro nový kód)
- **Best-effort cesta musí mít vlastní ověření.** Fetch kurzů v `catch` selhával rok
  neviditelně. Proto `runSnapshotOdds` vrací `errors` a workflow používá `--fail-with-body`.
- **Měř, než vyřadíš nebo přidáš.** Pořadí lig podle skillu odporuje intuici (ČR a Řecko
  patří ke špičce, Championship je u dna); Belgie „nejhorší liga" byl závěr z úzkého vzorku.
- **Fituj na tisících zápasů z backtestu, ne na desítkách z DB** – a grid veď až do
  degenerace, ať poznáš „optimum na hranici" (= přefit) od skutečného vnitřního optima.
- **Hold-out je povinný**, i když se zdá, že není co přefitovat.
- **Trhy s linkami se párují PO LINCE.** Kurz na 10.5 a na 11.5 jsou dvě různé sázky;
  smíchat je vypadá jako obrovská hrana a je to artefakt.
- **Nejlepší cena ≠ odhad pravděpodobnosti.** `bestPrice` na sázení, `sharpFair` na měření.

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
