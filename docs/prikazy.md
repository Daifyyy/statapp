# Příkazy (plná reference)

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

