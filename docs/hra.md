# Záložka Hra: Manažer (liga, kariéra, turnaje, pohár)

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
- **Prestiž klubu 0–100** (`teamPrestige`) = `leaguePrestige` je prestiž **špičky** ligy, od ní
  se jde dolů podle `strengthPercentile` až na `base − PRESTIGE_SPAN` (34). Premier League
  100…66, Championship 62…28, Fortuna liga 44…10. Percentil (pořadí), **ne min-max normalizace**
  — jeden dominantní klub by jinak sloužil za měřítko a zbytek ligy by stlačil ke dnu; navíc
  hvězdy a prestiž teď stojí na téže funkci a nemůžou ukazovat opačně. Dřív se počítalo
  `base − 18 + pct·34`, což u velkých lig **přetékalo přes 100 a clamp špičku slepil**: půlka
  Premier League měla prestiž 100 a pro `isHireable` byl Man City stejně dostupný jako Newcastle.
  Stupnice je tím o 16 níž, takže: (a) mistr menší ligy už nevystřelí reputaci ke stropu elity
  (viz `REP_CEILING_MARGIN` níže), (b) na `STARTING_REPUTATION` (30) je konečně hireable spodní
  třetina Championship — což dokumentace slibovala, ale předchozí stupnice (44…78) nesplňovala.
- **Reálné týmy = z ligové tabulky** (`getGameLeague` v `repository.ts` → `getLeagueGameTeams` v
  `realRepository.ts`): ratingy útoku/obrany = **góly na zápas** z tabulky (shrink k **loňskému
  ratingu klubu**, u nováčků k ligovému průměru), domácí výhoda z home splitu, loga+jména z API.
  **2 cachovaná volání/liga** – tabulka + tabulka předchozí sezóny (sdílí `standings:` cache
  se záložkou Tabulka i s `getLeagueBaseline`, takže typicky 0 volání navíc). **Mezisezóna**
  (0 odehraných) → fallback na **předchozí sezónu** (a historie je pak o sezónu starší).
  Mock/bez API → fiktivní `generateLeague`.
  - **Velikost klubu je daná historií, ne rozehranou sezónou** (`HISTORY_K` = 12 v `balance.ts`).
    Prior ratingu je **loňská sezóna téhož klubu** (přepočtená na letošní gólovou hladinu ligy
    a sama smrštěná `SHRINK_K`); letošek se k ní smršťuje `n/(n+12)` → po 12 kolech 50 %,
    po půlsezóně 61 %, na konci 76 %. Předtím byl prior **ligový průměr** s `SHRINK_K` = 3,
    takže po 1. kole stál rating ze 75 % na průměru a z 25 % na jednom zápase — a `amplifySpread`
    (1.35×) ten jeden zápas ještě roztáhl: výhra 4:0 udělala z nováčka 5★ favorita, remíza 0:0
    z mistra ligy 1★ outsidera. Přes `teamStrengthScore` to teklo do **hvězd, prestiže,
    sezónního cíle i `isHireable`** (které kluby jdou na startu kariéry vůbec vzít).
    **Klub bez loňského řádku** (postoupivší, nově zařazená liga) drží starý `SHRINK_K` —
    silný prior je oprávněný jen proti skutečnému ratingu, ne proti ligovému průměru,
    jinak by se odehraná sezóna zbytečně splácla ke středu. Pool lig = `GAME_LEAGUES` (`lib/game/leagues.ts`, Top-5 + Portugalsko/
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
    `prestiž vedeného týmu + REP_CEILING_MARGIN` (12). Empiricky: 20 titulů se Spartou (prestiž 44)
    → strop reputace 56 → Španělsko (prestiž 95, brána ~91) zůstane „🔒 mimo dosah"; k elitě se
    musíš propracovat přes silnější klub (mistr Portugalska 66 → strop 78 → otevře se půlka
    Premier League). Prestiž se nese na summary
    (`SeasonSummary.yourPrestige` = `teamPrestige`, `TournamentSummary.teamPrestige` = `nationPrestige`,
    fallback bez ní = strop 100). Ladicí konstanta – `sim-game` reputaci mezi ligami neměří.
- **Body vs. očekávané body** (`lib/game/expectedPoints.ts`, čisté + testy; `SeasonSummary.
  expectedPoints`, UI `ExpectedPointsNote` v `SeasonDone`) — **zavření smyčky, kterou má Hra
  v popisu**. Manažer ukazoval před každým zápasem predikci modelu a pak ji zahodil; `MatchResult`
  nesl jen skóre. Teď `playRound` u **tvých** zápasů uloží `xp` = `3·V + R` z predikce a souhrn
  sezóny řekne, jestli byla zasloužená: 52 bodů při zasloužených 44 = šťastlivec, ne génius.
  Je to totéž, co `lib/stats/formQuality.ts` dělá pro reálné týmy.
  - **xB jde z λ, která se SKUTEČNĚ odehrála** (plán, counter, instrukce, morálka, kondice,
    eventy — tedy `resolveYourAdjust`), **ne z náhledu** `yourNextMatch`. Ten jede záměrně
    `"balanced"`/`"none"` kvůli anti-exploitu, a kdyby xB šlo z něj, „nadvýkon" by z poloviny
    měřil, že **zabrala taktika** — pravý opak smůly, kterou má ukázat. Kryto testem.
  - **Ukládá se jen u tvých zápasů.** `results` drží celou ligu (380 zápasů/sezónu), takže xB
    u zápasů AI proti sobě by jen nafouklo save a nikoho by nezajímalo.
  - **Pole je volitelné a `chybí` ≠ `0.0`** (= jistá prohra). Rozehraná kariéra má dřívější kola
    bez xB, proto se agreguje **jen přes zápasy, které ho mají** — a to včetně skutečných bodů.
    Se dvěma různými jmenovateli by vyšel obrovský „nadvýkon" čistě z toho, že se do jedné
    strany rozdílu sečetlo víc zápasů. `SAVE_VERSION` se kvůli tomu **nebumpuje** (pole je čistě
    přírůstkové a serverové zod schéma jede na `passthrough()`).
  - **Verdikt až od 8 zápasů** (`MIN_XP_SAMPLE`) a od rozdílu 4 bodů (`XP_VERDICT_MARGIN`) —
    na kratším úseku je rozdíl z valné části šum. Táž zásada jako `T.minXgSample` u kvality formy.
  - **Balanc se nezměnil**: `predictProbs` nesahá na RNG, ověřeno tím, že výstup `npm run sim-game`
    je proti stavu před změnou **bit-identický**. 0 volání API, žádná nová data.
  - Zatím **jen ligová sezóna** — turnaje (`tournament.ts`) a pohár mají vlastní `results` a xB
    tam nevstupuje.
- **Dopad taktiky — „udělalo moje rozhodnutí vůbec něco?"** (`lib/game/tacticImpact.ts`, čisté +
  `tacticImpact.test.ts`; `MatchResult.xpBase`/`win`/`winBase`, UI chip v `MatchResultToast` +
  `TacticImpactNote` v `SeasonDone`).
  - **Problém, který řeší (změřeno, `npm run sim-game` sekce 6):** volba plánu a instrukce vynese
    za sezónu **+2,5 bodu** proti šumu sezóny **±8 bodů** → poměr signál/šum **~0,3 sd**. Náhodné
    klikání je od promyšlené hry statisticky k nerozeznání a nejhorší možná hra stojí 1,3 bodu.
    Taktická vrstva tedy **funguje, ale je pod prahem rozlišitelnosti** — z tabulky ji hráč
    nikdy nepřečte a hra působí jako klikačka. Proto se dopad ukazuje **explicitně**.
  - **Kontrafaktuál na každém tvém zápase:** vedle `xp` (skutečná λ) se ukládá `xpBase` a
    `win`/`winBase` = co by predikce říkala s `"balanced"`/`"none"`. Rozdíl je čistý efekt tvé
    volby. Toast po zápase hlásí „🎛️ plán 41 % → 44 %", `SeasonDone` sečte sezónu.
  - **Základna JE ten náhled, který hráč viděl** (`yourNextMatch` jede neutrálně kvůli
    anti-exploitu) → hlášení navazuje na číslo, které appka před zápasem ukázala. Kryto testem.
  - **Čte se z ULOŽENÉHO výsledku, ne ze stavu.** Kdyby šel dopad spočítat pro nadcházející
    zápas, hráč by proklikal plány a vzal nejvyšší posun — přesně to, čemu neutrální náhled
    brání. Tvar funkce (`matchTacticImpact(result)`) to znemožňuje.
  - **Morálka/kondice/eventy jsou v obou větvích totožné**, takže rozdíl izoluje volbu. Ale
    **není na stavu nezávislý**: cesta z násobiče λ na 1X2 je přes Poissona nelineární, takže
    týž plán posune unavený tým o jiný počet p.b. než svěží (kryto testem, aby se to nečetlo
    jako konstanta). Přenos přes kola (lepší taktika → víc výher → vyšší morálka příště) se
    do rozdílu nezapočítá → součet za sezónu hodnotu volby spíš **podhodnotí**.
  - `SAVE_VERSION` se **nebumpuje** (pole přírůstková, zod jede `passthrough()`), balanc je
    **bit-identický** (`predictProbs` nesahá na RNG — ověřeno diffem sekcí 1–5 proti HEAD).
    Jen ligová sezóna, stejně jako xB.
- **Sázky zápasu — „co odsud potřebuješ"** (`lib/game/stakes.ts` + `planChoice.ts` + `adjust.ts`,
  čisté + `stakes.test.ts`; UI `StakesNote` nad scoutingem).
  - **Problém:** `recommendPlan(styl)` byl argmax `planScore = útok − obdržené`, tedy proxy na
    gólový rozdíl. Ta má na každý styl **jednu** správnou odpověď bez ohledu na situaci —
    naměřeno napříč 4 560 koly: `counter` 62 %, `press` 28 %, `balanced` 10 %, a **`open`
    s `low_block` ani jednou**. Jenže manažer gólový rozdíl nemaximalizuje: venku u lídra
    bere bod, doma se dnem potřebuje tři.
  - **Řešení:** `matchStakes(state, oppId)` odvodí z tabulky, cíle a zbývajících kol
    **váhy výhry/remízy** (`must_win` 3/0.3 · `hold_a_point` 3/2 · `normal` 3/1) a
    `recommendPlan` porovná plány **na skutečné 1X2 predikci** (ne na proxy) váženě podle nich.
    `must_win` se spustí jen v poslední třetině a jen když ani samé remízy na cíl nestačí.
    Turnaj/pohár si váhy dodají sám (`KNOCKOUT_WEIGHTS` 3/1.5 — remíza = prodloužení, ne bod).
  - **`composeAdjust` (`adjust.ts`) je vytknutý stack násobičů**, aby `resolveAdjust` (pravda)
    i `planChoice` (hlášení) skládaly λ **týmž kódem**. Druhá kopie by se rozešla a `ADJUST_MIN/MAX`
    by přestal platit pro jednu větev.
  - **`planScore`/`recommendPlan` v `plans.ts` ZRUŠENY** — dvě škály na tutéž věc se rozejdou.
  - **Balanc, který si to vynutilo** (obojí změřeno, detail v `balance.ts`):
    - `low_block` útok **0.82 → 0.87** + counter řádek proti `attacking` **conc 0.88 → 0.98**.
      Plán byl mrtvý ne kvůli účelové funkci, ale protože jeho `concede` vycházelo
      `0.80 × 0.88 = 0.704`, tedy **na podlaze `ADJUST_MIN` (0.70)** — obranný přínos se
      ořezal, útočnou cenu platil celou. Snižovat `concede` nepomáhá (clampne víc), zvyšovat
      ho zabije identitu (0.84 → zpět na 0 %).
    - `open` útok **1.15 → 1.12**. Se sázkami přestal být mrtvý, ale rovnou spolkl 53 % kol
      a saturoval `ADJUST_MAX`. Po úpravě: `open` 33 · `counter` 30 · `press` 22 ·
      `balanced` 10 · `low_block` 4 % — **poprvé jsou v provozu všechny plány**.
  - **Cena: clamp 0.12 % → 0.43 %** (sekce 3). Původní číslo platilo pro svět, kde se dva
    z pěti plánů nevolily vůbec; nad ~1 % je čas se podívat znovu. Agency stoupla:
    rozpětí **4.5 → 5.8 b**, pozorná hra **+2.3 → +2.9 b/sezónu**.
  - **Anti-exploit beze změny:** doporučení se staví z `reportedStyle`/`reportedTraits`, ne
    z pravdy, a náhled (`yourNextMatch`) se pořád nehýbe s volbou plánu. Kryto testy.
- **„Hrát dál" — kolo přestává být jednotkou rozhodnutí** (`lib/game/autoplay.ts`, čisté +
  `autoplay.test.ts`; UI třetí tlačítko + souhrnný toast).
  - **Problém:** sezóna má 38 kol a v každém hráč udělá totéž (scouting → plán → instrukce →
    klik). Událost padne jen ve čtvrtině kol, takže **tři čtvrtiny jsou čistá obsluha**. Appka
    měla jen dvě krajnosti: „Odehrát kolo" (38 kliků) a „Dohrát sezónu" (0 kliků, ale i
    0 rozhodnutí a přeskočené události).
  - **Řešení:** `playUntilDecision` hraje stávajícím plánem, dokud si další kolo neřekne o
    rozhodnutí. `needsYou` vrací důvod v tomhle pořadí: `event` (blokující) → `must_win`
    (sázky ze `stakes.ts`) → `finale` (poslední 3 kola) → `rival` (soupeř do ±2 příček,
    až po 5. kole – dřív tabulka nic neznamená) → `fitness` (< 45 = „Vyčerpaní") → `cap`.
  - **Naměřeno** (`sim-game` sekce 7): **19.5 kliku/sezónu místo 38**, z toho jen ~9 je
    administrativa (zbytek jsou volby v událostech) → **administrativní kliky spadly z ~28
    na ~9**. Ø dávka 1.95 kola. Zastávky: event 54 % · rival 21 % · must_win 10 % · finale 6 %.
  - **Cena pohodlí ~1.0 b/sezónu**, což je proti sekci 6 (+2.9 b za pozornou hru) **zhruba
    třetina taktické výhody za polovinu kliků**. Je to nabídka, ne past — „Odehrát kolo"
    zůstává a dá plnou hodnotu.
  - **Automatická kola jedou se STÁVAJÍCÍM plánem, ne s doporučením skautů.** Jinak by si
    hráč jedním klikem přečetl radu, kterou má jinak až za investici do skautingu
    (`detailed`) — stačilo by se podívat, co se v přepínači vybralo. Kryto testem.
  - **`AUTOPLAY_MAX_ROUNDS` (6)** je strop na klik, ať klidný úsek nespolkne půl sezóny
    naslepo. `playUntilDecision` vždy odehraje **aspoň jedno** kolo (jinak by tlačítko
    nedělalo nic v situaci, kterou hráč právě obsluhuje).
  - Determinismus beze změny: sezóna odehraná přes „Hrát dál" dá **bit-identické výsledky**
    jako kolo po kole (RNG je per kolo, `deriveSeed(seed, round)`) — kryto testem.
  - Jen ligová sezóna; turnaj a pohár mají 6–7 kol, tam nemá smysl nic dávkovat.
- **`npm run sim-game` sekce 6 (AGENCY)** hlídá právě tenhle poměr regresně: čtyři strategie
  párově na týchž seedech. Spadne-li „pozorná hra nad nesaháš" k nule, taktická vrstva přestala
  existovat. Vedle toho tiskne **kvalitu scoutingu** (dnes vague 10 % · standard ~86 % ·
  detailed ~4 %) **pro hráče BEZ investice** — tam jsou ta 4 % jen z eventu a je to
  záměr. Podstatná osa je náběh podle investice, který tiskne tentýž řádek níž.
- **Oprava scoutingu: tři z pěti investovaných bodů nedělaly NIC.** Podíl kol s detailním
  hlášením podle úrovně skautingu byl `0 · 0 · 50 · 50 · 84 · 87 %` — schodiště s mrtvými
  schody (první bod nic, třetí nic, pátý skoro nic).
  - **Příčina není v prazích, ale v hrubosti mřížky.** Konfidence = `MIN + vzorek + odveta +
    investice`. Vzorek se sytí po **6 kolech** (`SCOUT_SAMPLE_FULL`) a skáče po `1/6 × 0.25 =
    0.042`, odveta přidá rovnou `0.08` — a krok investice `0.04` se mezi ně nevešel. Od 7. kola
    do odvety byla konfidence **plochá** a pak skočila, takže o kvalitě hlášení rozhodovala
    jediná binární věc (jestli je po odvetě) víc než celá investice.
  - **Co se změnilo:** `SCOUT_LEVEL_STEP` 0.04 → **0.07**, `SCOUT_FAMILIARITY_BONUS` 0.08 →
    **0.04** (menší skok), `SCOUT_QUALITY_DETAILED` 0.85 → **0.80**. Dnes
    `0 · 50 · 84 · 89 · 95 · 100 %` — monotónní, bez mrtvého schodu.
  - **Odhalování traitů je nově SPOJITÉ v konfidenci** (`revealThreshold`), ne skokové po
    stupních kvality: práh klesá plynule z `SCOUT_REVEAL_VAGUE` na `SCOUT_REVEAL_STANDARD`,
    takže i bod, který nepřekročí stupeň, odhalí o kus slabší traity (83 % → 100 % odhalených
    napříč úrovněmi). `detailed` zůstává skokem na nulu („vidíme všechno").
  - **Invariant držel:** bez investice se na `detailed` nedá dostat (strop `0.45 + 0.25 + 0.04
    = 0.74 < 0.80`) — doporučení skautů je pořád odměna za investici. Kryto testem.
  - **Turnaje beze změny:** tam je `scouting` nedefinovaný a soupeř má 0–3 zápasy, takže strop
    konfidence je 0.74 < 0.80 → detailní hlášení nikdy, stejně jako dřív.
  - **Regresní strážce** (`sim-game` sekce 6 + test „každý bod investice do skautingu je vidět
    na hlášení"): podíl detailních hlášení musí růst na **každém** kroku. Test byl ověřen
    v obou směrech — se starým `SCOUT_LEVEL_STEP` spadne a pojmenuje mrtvý schod. Pozor:
    měřit se musí **průměr přes celou sezónu**, ne jeden okamžik — po ~20. kole má každý
    soupeř plný vzorek i odvetu a všechny úrovně vyjdou stejně (100 %).
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

