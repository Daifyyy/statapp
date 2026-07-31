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

## 📚 Jak je dokumentace organizovaná (ČTI PRVNÍ)

Tenhle soubor se načítá do **každé** session, proto obsahuje jen **příkazy, invarianty
a zákazy** — tedy věci, kvůli kterým bych jinak nevěděl, že mám něco dohledat.
**Detail žije v `docs/`** a čte se **na vyžádání**: než sáhneš na oblast, otevři její
soubor. Odkazy níže jsou schválně **cesty, ne `@import`** — import by se vložil do
kontextu a nic by neušetřil.

| Když děláš na… | Přečti si |
|---|---|
| cokoliv (plná reference příkazů a jejich přepínačů) | `docs/prikazy.md` |
| datové vrstvě, cache, λ, ratinzích, insights, zraněních, tabulkách, střelcích | `docs/architektura.md` |
| domovské obrazovce `/` — Program, Výsledky, živé skóre, oblíbené, deep-linky | `docs/zapasy.md` |
| oknech metrik, sezónách, `MatchStat`, reprezentačních metrikách | `docs/data-okna.md` |
| predikční pipeline, cronu, rozsazích lig, backtestu, verzování, kalibraci | `docs/predikce.md` |
| kurzech, EV, CLV, asijském hendikepu, rozích, kartách, týmových totalech | `docs/trhy-kurzy.md` |
| Porovnání (kategorie, styl hry), Tabulkách, Přestupech | `docs/zalozky.md` |
| Manažerovi (liga, kariéra, turnaje, klubový pohár, balanc) | `docs/hra.md` |
| účtech, FREE/PRO gatingu, Stripe | `docs/ucty-platby.md` |
| rate-limitingu, kvótě, DB, cronech, deploymentu, PWA, SEO | `docs/provoz.md` |
| „kde jsme skončili", TODO, známé problémy, go-to-market | `docs/stav.md` |
| úklid kódu, testy, refaktor `HraApp` — plán z review 29. 7. | `docs/plan-review.md` |

**Údržba dokumentace:** nové poznatky piš **do příslušného souboru v `docs/`**.
Do CLAUDE.md přidávej jen tehdy, když jde o **invariant nebo zákaz**, který musí být
vidět bez otevírání souboru. Jinak tenhle soubor zase naroste zpátky.

## Příkazy (základ; přepínače a jejich význam v `docs/prikazy.md`)
```bash
npm run dev          # vývoj (http://localhost:3000)
npm run build        # produkční build
npm test             # Vitest – unit testy výpočetního jádra (jen lib/**/*.test.ts)
npx vitest run lib/stats/predict.test.ts   # jeden soubor
npx vitest run -t "název testu"            # jeden test dle názvu (substring)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npx prisma db push   # promítnout změnu schématu do Neonu (+ regeneruje klienta)

npm run backtest     # offline backtest klubových lig (point-in-time, stejné jádro)
                     # --team-totals | --cards | --corners | --ah | --no-stats | --no-odds
npm run backtest-national   # backtest reprezentací
npm run import-odds  # zavírací kurzy z football-data.co.uk (0 volání API)
npm run calibrate    # MLE DC_RHO + Brier/log-loss z odehraných predikcí
npm run reprice      # přepočet uložených predikcí z λ (0 API) — MÍSTO bumpu MODEL_VERSION
npm run resettle     # přepočet výsledků na skóre po 90 min (AET/PEN)
npm run backfill-stats      # xG/střely k historii
npm run probe        # živá sonda API; probe-odds -- <fixtureId> --markets
npm run probe-live   # živé statistiky + přehled průběhu tak, jak ho uvidí uživatel
                     # -- <fixtureId> | --watch <s> (diff dvou snímků = důkaz kumulativnosti)
npm run sim-game     # balanc Manažera (bez API/DB)
npm run audit-leagues       # herní ligy: odvozené vs. kurátorované příčky
npm run refresh-transfers   # přestupy z API-Football
```
**Tento Windows stroj:** odchozí TLS (api-sports, Google, Stripe, `npm`, `prisma generate`)
vyžaduje **`NODE_OPTIONS=--use-system-ca`** (firemní/AV TLS proxy). Na Vercelu netřeba.
`prisma generate` občas selže na EPERM → zabít běžící `next`. Sondy běží přes `tsx`.
`esbuild` je připnutý na 0.25.12 v `overrides` — **nezvedat**, stroj neumí stáhnout novější
binárku přes TLS proxy.

## Nepřekročitelné invarianty

**Jádro a čistota**
- `lib/stats/` je **čisté a na zdroji nezávislé** — mock i reálná data tečou stejnou cestou.
  `compareTeams` se **nemění** kvůli tieringu; PRO obsah ořezává `toFreeResult` až na hranici route.
- Mřížku skóre staví **jediná** funkce `gridProbs` (sdílí ji živý `predictMatch` i `reprice`).
  Druhá implementace Poissona se dřív nebo později rozejde.
- Modely rohů/karet/totalů sdílí `strengthRatio` a `PREDICTION_WINDOW_WEIGHTS` s `predict.ts`
  — nekopírovat.

**Cache a kvóta**
- `apiGet` fetchuje s **`cache: "no-store"`**. Next data cache seděla nad naší vrstvou s pevnou
  24h revalidací a **přebíjela každý kratší TTL**. Nevracet.
- `/fixtures/statistics` vrací **oba týmy** — ukládej i soupeřův `MatchStat`, jinak je zápas 2× dražší.
- `MatchStatCache` má **dvě** verze: `CURRENT_CACHE_VERSION` (čím se zapisuje) a
  `MIN_READABLE_CACHE_VERSION` (co se ještě čte). **Práh zvedej jen když by starší řádky dávaly
  špatná čísla**, ne kvůli kosmetickému poli — jinak zahodíš ~9 000 cachovaných zápasů.
- `cachedJson` neukládá `null` a prázdné pole cachuje krátce (3 h).
- **Statistika ROZEHRANÉHO zápasu nesmí do `MatchStatCache`** (`getLiveMatchStatsPair` má
  vlastní klíč `fixstatlive:` v `ApiCache` s TTL v řádu minut). Poloviční čísla zapsaná jako
  hotový zápas by tiše otrávila okna, na kterých stojí λ — a v track-recordu by to vypadalo
  jako „model má horší měsíc".

**Verzování modelu**
- `MODEL_VERSION` verzuje **jen to, co generuje λ**. Bump **vynuluje dataset**.
- **ρ, `LAMBDA_SHARPEN` a Platt kalibrace pod něj NEPATŘÍ** — jsou to post-parametry nad λ.
  Po jejich změně jeď **`npm run reprice`** (0 API, historie zůstane).

**Vercel Hobby (dvakrát to tiše kazilo provoz)**
- **`maxDuration` je stropovaná na 60 s a vyšší hodnota se ignoruje.** Nezvyšovat bez Pro plánu;
  místo delšího běhu se spoléhej na **rotaci soutěží** (`rotateLeagues`).
- **Crony žijí v `.github/workflows/cron.yml`, ne ve `vercel.json`** (Hobby dovolí 2 joby a jen denně,
  my jich máme šest a snímky kurzů musí běžet hodinově). Nevracet zpátky.
- `ODDS_CLOSING_HOURS` (3 h) musí zůstat **širší než perioda cronu** (hodina), jinak zápas mezi
  dvěma běhy propadne bez zavíracího snímku.
- Neon je **sdílená pro lokál i produkci** → `prisma db push` ovlivní prod, nasaď kód hned.
- `AUTH_URL` musí být stabilní doména (jinak Google `redirect_uri_mismatch`).

**Kurzy a trhy**
- **Sběr kurzů hlídá POKRYTÍ TRHŮ** (`lib/data/oddsCoverage.ts` + testy). `bookOddsOf`
  vynechává trh, který nenajde (`...(corners.length ? {corners} : {})`), takže rozbitý
  matcher **mlčí**. `runSnapshotOdds` proto počítá, u kolika zápasů šel který trh vytáhnout,
  a nulu napříč vzorkem hlásí do logu (`missingMarkets`). Jedna kniha bez trhu je normální;
  **nula napříč všemi knihami a zápasy** je podezření na parsování — a jde poznat jen v agregátu.
- **Živý a dohraný přehled zápasu sdílí ROZMĚRY, ne PRAHY.** Relativní normalizace je jediná
  (`buildMatchDimensions` v `matchReport.ts`) — druhá kopie `share`/`pairOf` by se rozešla
  a rozbila invariant „součet je 10". Absolutní prahy jsou naopak kalibrované na 90 minut,
  takže si je `liveReport.ts` **škáluje uplynulou minutou** a má vlastní objemové brány;
  rozměr Proměňování (góly − xG) živě **není** (gól z xG 0.11 ve 12. minutě dá kraj škály).
  Živé věty navíc nesmí slibovat výsledek — kryto testem zakázaného slovníku.
- **Relativní skóre se zaokrouhluje JEN na jedné straně**, druhá se dopočítá z té zaokrouhlené
  (`categories.ts`, `matchReport.ts`). Nezávislé zaokrouhlení dá 3.8 + 6.3 = 10.1 na reálných
  datech (držení 30:50, fauly 8.5:11.5) a pruh pak neodpovídá číslům.
- **Trhy s linkami se párují PO LINCE.** Kurz na 10.5 a na 11.5 jsou dvě různé sázky; smíchat je
  vypadá jako obrovská hrana a je to artefakt. Linku ber z otevíracího snímku; není-li v zavíracím,
  CLV se **nespočítá** (nedosazuj jinou).
- **`bestPrice` ≠ `sharpFair`.** Nejlepší cena je na *sázení*, odmaržovaná sharp linie na *měření*
  (CLV, benchmark). Nejlepší cena je jako odhad pravděpodobnosti vychýlená.
- **Matchery trhů se musí vzájemně vylučovat** (`isCornerBet` / `isCardBet` / `teamTotalSide`).
  Jinak model porovná gólovou λ s kurzem na rohy a **nic nekřičí**. U karet navíc odmítej
  booking points a „jen žluté" — jiná stupnice.
- **Best-effort cesta musí mít vlastní ověření.** Fetch kurzů v `catch` selhával **rok** neviditelně
  (0 uložených kurzů). Proto `runSnapshotOdds` vrací `errors` a workflow jede `--fail-with-body`.
- **`catch` nikdy nesmí mlčet.** Graceful degradace je v pořádku, neviditelná degradace ne —
  každý `catch` v `lib/` volá `logError` (u očekávaných dílčích výpadků agreguje a loguje
  **jednou za běh**, ne za položku). Nejzákeřnější dva: `getLeagueBaseline`/`getLeagueRatings`
  tiše zhorší λ a v track-recordu to vypadá jako „model má horší měsíc".
- **Cron hlásí degradaci statusem, ne polem v těle** (`cronJson`, `lib/cronResult.ts`).
  GitHub Actions červená jen na 4xx/5xx, takže `200 {predicted:0, errors:24}` byl zelený.
  Práh je „nic se nepodařilo, ačkoli se to zkoušelo" → 502; **dílčí výpadek zůstává zelený**
  (číslo je v těle), aby se červená nedevalvovala.
- **`requireCronAuth` je fail-closed.** Chybí-li `CRON_SECRET` v env, endpoint vrací 503.
  Dřív se pouštělo dál → jediná chybějící proměnná otevřela `/api/warm?league=ID`
  (stovky volání na request) komukoli. Lokální spuštění cronu proto chce secret i v `.env`.

**Metodika (tohle rozhodlo většinu sporů)**
- **Měř, než vyřadíš nebo přidáš.** Pořadí lig podle skillu odporuje intuici (ČR a Řecko patří ke
  špičce, Championship je u dna). Před změnou `PREDICTION_LEAGUES` vždy `npm run backtest -- --leagues=ID`.
- **Fituj na tisících zápasů z backtestu, ne na desítkách z DB**, a veď grid **až do degenerace** —
  ať poznáš „optimum na hranici" (přefit) od skutečného vnitřního optima.
- **Hold-out je povinný**, i když se zdá, že není co přefitovat.
- **Syrový průměr kategorie s malým vzorkem škodí** (rozhodčí bez shrinkage byl horší, než o něm
  nevědět vůbec). Vždy smrštit.
- **UI musí zůstat mobile-first** (PWA na telefonech) — responzivita, stabilita, jednoduchost.

## Co NEZKOUŠET znovu (změřeno, zamítnuto)
- **Porazit zavírací linii na 1X2 / Over 2.5 / BTTS** gólovými průměry, xG a střelami.
  Log-loss 1.0239 vs. trh 0.9760; ROI −5 až −11 %, žádný interval neobsahuje nulu.
- **„Model jako korekce trhu" na gólových trzích** — `npm run backtest -- --ah`, 8 021 zápasů:
  naše odchylka od sharp linie nese **β₂ = 0.007 ± 0.039**, tedy nulu, a to i po ligách.
  Naše λ má správnou **úroveň**, jen je **šumnější**; chybí informace, ne kalibrace.
- **Zpřísňovat práh hrany, aby se ROI zlepšilo** — zhoršuje ho (−7.7 % → −8.9 %).
- **Platt kalibrace** (`CALIB_A/B`) — fit skončil na hranici gridu se ziskem 0.0007.
- **Zostření λ** (`LAMBDA_SHARPEN`) — optimum s = 1.00, model je na favoritech přesebevědomý.
- **BTTS z Poissonovy mřížky** i **bivariační Poisson** (společný šok λ₃) — šum, a 1X2 se zhorší.
- **Další ladění λ u rohů** — vyčerpáno, optimum je vnitřní.
- **Historické kurzy z API-Football** — nevrací je (ověřeno třemi tvary dotazu).
- **Zvyšovat `maxDuration` nad 60 s** bez Vercel Pro — tiše se ignoruje.
- **H2H** — vědomě mimo scope.

Nové vstupy (sestavy, shot-level xG) tenhle seznam otevírají znovu. Přeskládání téhož ne.

## Kde stojíme (detail v `docs/stav.md`)
Všechno je commitnuté a nasazené. **Blokuje jen start lig 7. 8. 2026** — model je změřený tak
daleko, jak to bez čerstvých dat jde.

Odpověď na hlavní otázku „dá se z našich dat postavit profitabilní sázecí model?" →
**na gólových trzích ne**. Model má **skill, ale ne hranu**; mezi tím stojí marže.
Otevřená zůstává jediná větev: **trhy, kde model něco umí a kde jsme ještě neviděli cenu**
(týmové totaly, karty, rohy) — a verdikt o nich přijde z **CLV, ne z ROI**.

**První věc po startu lig:** `npm run probe-odds -- <fixtureId> --markets` — parsování rohů,
karet a týmových totalů vzniklo v mezisezóně a **nikdy neběželo proti živému API**.

**Brána:** do stakingu, bankrollu ani Kelly **neinvestovat**, dokud aspoň jeden trh nemá kladné
CLV nebo ROI s intervalem spolehlivosti mimo nulu. Kelly je násobič hrany — na záporné hraně
jen zrychluje ztrátu.
