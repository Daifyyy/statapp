# Záložka Zápasy (Program / Výsledky, domovská obrazovka)

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

