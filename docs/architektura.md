# Architektura — datové vrstvy, cache, predikční jádro, ratingy

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

