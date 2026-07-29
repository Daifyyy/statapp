# Záložky Porovnání, Tabulky, Přestupy

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

