# Kurzy, trhy a měření hrany (EV, CLV, AH, rohy, karty, totaly)

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
