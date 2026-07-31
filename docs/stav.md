# STAV projektu, známé problémy, go-to-market

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

### Hotovo 31. 7. — připravenost POROVNÁNÍ na start sezóny
Revize datové cesty porovnání proti situaci „7. 8. začínají ligy". Tři díry opravené:
- **Fallback nováčka se řídí baselinem, ne formou** (`buildClubTeam`). Po 1. kole se dřív
  vypnul a tým spadl z 20 zápasů kontextu na jediný; okno SEASON (70 % λ) zůstalo prázdné.
  Nově doplňuje, nenahrazuje. Detail v `docs/data-okna.md`.
- **Přátelák má sníženou váhu i u klubů** (`matchWeight`). Letní příprava tažená fallbackem
  se počítala jako plnohodnotné ligové kolo.
- **Seznam týmů padá na loňskou sezónu**, když API novou ještě nevydalo (jinak prázdný
  výběr týmů v Porovnání). Detail v `docs/provoz.md`.

Čtvrtá, věcně největší změna: **forma je jen z aktuální sezóny.** Okna LAST10/LAST5,
proužek W/D/L i „čisté konto z posl. 10" braly N nejnovějších zápasů dle data, takže v srpnu
ukazovaly květen — s vahou 55 %. Od minulé sezóny je tu okno SEASON. Detail v `docs/data-okna.md`.
**λ zůstalo nezměněné** (`crossSeasonForm: true`) — a tentokrát to je **změřené rozhodnutí**,
ne odložení. `npm run backtest -- --form-current-season` (9 909 zápasů, identický vzorek):
1X2 log-loss 1.0219 → **1.0210**, ECE 0.0087 → **0.0079**, ztráta na trh 0.0479 → 0.0472;
znaménko konzistentní po sezónách (2024 −0.0016, 2025 −0.0001). Tedy **neškodí, ale je to šum**
— a sjednocení by znamenalo bump `MODEL_VERSION`, který **vynuluje dataset predikcí**.
Za −0.001 log-lossu se dataset neresetuje → **sjednotit až u nejbližšího bumpu z jiného důvodu**.
Přepínač zůstává v backtestu jako ablace.

`realRepository` dostal **první testový soubor** (`realRepository.test.ts`, API i cache
nahrazené fakem); první test mutačně ověřen proti staré podmínce.

**Otevřené, k ZMĚŘENÍ (ne k opravě od stolu): `BASELINE_SAMPLE = 10`.** Backtest, který
nafitoval váhu **70 %** na okno SEASON, dostával **celou** minulou sezónu; produkce mu dává
`spreadSample(…, 10)` (mimo start sezóny ~5 zápasů na venue). Při `shrinkMatches = 6` to
znamená citelně silnější smrštění k ligovému průměru, než jaké bylo změřené. Postup: přidat
`--baseline-sample=N` do `npm run backtest`, proběhnout `10` vs. neomezeno na tomtéž hold-outu
a teprve podle log-lossu/ECE rozhodnout. Offline, 0 volání API.

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
**Od 29. 7. 2026 k tomu existuje i pasivní pojistka** (`lib/data/oddsCoverage.ts`):
`runSnapshotOdds` počítá, u kolika zápasů šel který trh vytáhnout, a trh s **nulou napříč
vzorkem** hlásí jako `missingMarkets` do odpovědi cronu i do logu. Sonda výše zůstává
**první věcí k udělání** — pojistka řekne „nechytá se to", ale ne „správný název je jiný".
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
