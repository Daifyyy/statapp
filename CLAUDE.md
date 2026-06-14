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
npm test             # Vitest – unit testy výpočetního jádra
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
- **Predikce** (`lib/stats/predict.ts`, `CompareResult.prediction`) – nezávislý **Poisson**
  z očekávaných gólů (útok týmu × obrana soupeře, venue-specific, fallback TOTAL, volitelné
  zpevnění xG). Vrací V/R/P, očekávané skóre, BTTS, Over 2.5. UI `MatchPrediction.tsx`.
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

## DB
Prisma 6 + Postgres (Neon). Tabulky `ApiCache` (TTL) + `MatchStatCache` (trvalá).
**Pozor:** Neon je sdílená pro lokál i Vercel → změna schématu (`prisma db push`)
ovlivní i produkci; nasaď nový kód hned.
**Verzování cache:** `MatchStatCache` má `schemaVersion`; po přidání metrik bumpni
`CURRENT_CACHE_VERSION` (`cache.ts`) → staré řádky se přestanou číst a samy se
dotáhnou znovu (zadarmo) s plnou sadou. Žádné plošné mazání. `saveMatchStats`
proto dělá upsert (ne createMany). Po nasazení případně urychli přes `/api/warm?league=ID`.

## Deployment
GitHub `Daifyyy/statapp` → Vercel (auto-deploy na push do `main`). Env na Vercelu:
`API_FOOTBALL_KEY`, `DATABASE_URL` (Neon pooled), volitelně `CRON_SECRET`.
`postinstall: prisma generate` zajistí klienta při buildu. Live: https://statapp-uvol.vercel.app

## Známé problémy / TODO
- **iOS Safari zoom na mobilu:** po kliknutí na „Vyber tým" se stránka stále přibližuje,
  i přes `font-size: 16px` na inputech/selectech (`text-base`) + globální media rule
  v `globals.css`. Hypotézy k ověření: skutečná computed font-size na fokusovaném
  inputu v mobilním Safari; jestli zoom netriggeruje jiný prvek; alternativně řešení
  přes `visualViewport` / `meta viewport interactive-widget`. Nutno ladit přímo na
  zařízení (Safari Web Inspector).
