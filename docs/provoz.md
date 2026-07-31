# Provoz — rate-limiting, DB, crony, deployment, PWA, SEO

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
- **Seznam týmů padá na loňskou sezónu** (`getTeamsByLeague`). Než API vydá soupisku nové
  sezóny, byl výběr týmů v Porovnání **prázdný** – ne nepřesný, prázdný. Loňský seznam je
  nepřesný jinak (chybí nováčci, jsou v něm sestupující), ale to je pořád lepší než nic.
  V ustáleném stavu 0 volání navíc – fallback se sáhne jen na prázdný seznam, a krátké TTL
  prázdné odpovědi (3 h) zajistí, že se to samo přepne, jakmile API sezónu publikuje.
- **Živé statistiky (`/api/live-report`) jsou jediná cesta, kterou řídí chování uživatele.**
  Statistiky běžícího zápasu se **nedají sdílet mezi zápasy** (1 volání na zápas) ani dlouho
  cachovat, takže na rozdíl od živého skóre (1 sdílené volání pro všechny ligy) roste jejich
  cena s počtem otevřených panelů. Tři pojistky, v tomhle pořadí:
  1. **Jen po rozkliknutí.** Nikdy automaticky pro seznam – zájem uživatele je jediná záminka
     pro volání. Sbalení řádku panel odmontuje → poll skončí.
  2. **TTL podle stavu** (`liveStatsTtl`): 120 s běžně, **600 s o poločase** (nic se nemění),
     180 s v závěru. To je **tvrdý strop**: jeden zápas nestojí víc než ~30 volání za hodinu,
     ať se dívá kdokoli.
  3. **Denní čítač** (`lib/data/liveBudget.ts`, `LIVE_STATS_DAILY_MAX = 600`) → nad limitem
     `reason: "budget"` a hláška v UI. Na serverless je **per-instance a padá se studeným
     startem**, takže je to měkká pojistka a hlídač do logu, ne garance.
  Odhad: zápas s nepřetržitě otevřeným panelem ≈ 47 volání; realistický provoz ~40–80/den
  (1 % volné rezervy), těžký den ~470 (14 %).
  **Rozehraná statistika se NIKDY nezapisuje do `MatchStatCache`** (vlastní klíč
  `fixstatlive:` v `ApiCache`) – poloviční čísla by otrávila okna, na kterých stojí λ.
- **`/fixtures/statistics` vrací OBA týmy v jedné odpovědi.** `assemble` (`realRepository`)
  proto z ní ukládá i **soupeřův** `MatchStat` – dřív se druhá půlka zahodila a týž zápas se
  stáhl podruhé, až přišel na řadu soupeř (**2× dražší**). Nejdražší opakující se položka
  v sezóně; nevracet zpět.
- Cold porovnání ~8 s (mezisezóna nestahuje předchozí sezónu), warm ~0.15 s.
- **Předehřívání:** `GET /api/warm` (katalog, lehké, denní cron – viz „Plánované úlohy");
  `GET /api/warm?league=ID` předehřeje zápasová data ligy (těžké, na vyžádání).

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
- **`CRON_SECRET` je od 29. 7. 2026 POVINNÝ (fail-closed).** Chybí-li v env, `requireCronAuth`
  vrátí **503** a endpoint se nespustí. Dřív se bez secretu pouštělo dál „aby se nezablokoval
  provoz" — jenže tím jediná chybějící proměnná (migrace projektu, nový deploy target) tiše
  otevřela `/api/warm?league=ID`, což je **stovky volání API-Football na jeden request**,
  komukoli na internetu. Vyčerpaná denní kvóta by se projevila až tím, že appka nemá data.
  **Lokální spuštění cronu proto potřebuje `CRON_SECRET` i v `.env`** + hlavičku
  `Authorization: Bearer <secret>`; běžného vývoje appky se to netýká.
- **Degradovaný běh jde ven jako 502** (`cronJson`, `lib/cronResult.ts` + testy). Actions
  červenají jen na 4xx/5xx, takže běh vracející `200 {predicted: 0, errors: 24}` byl
  **zelený** — tedy přesně ten neviditelný stav, kvůli kterému se rok nevšimlo, že se
  neukládají kurzy. Práh je **„nic se nepodařilo, ačkoli se to zkoušelo"**; dílčí výpadek
  (část lig selhala, zbytek prošel) zůstává **200 = zeleně** s počtem v poli `errors`.
  Ten práh je záměrný: při 18 soutěžích a distribuovaném rate-limitu je občasný výpadek
  normální provoz, a cron, který červená pořád, se přestane číst.
  `runPredictUpcoming`, `runSettleResults`, `runSnapshotOdds` i `warmCatalog`/`warmLeague`
  proto vracejí počty chyb; **nová `run*` funkce musí taky**.
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
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, **`CRON_SECRET`** (povinný — bez něj se crony
uzamknou na 503, viz „Plánované úlohy") a volitelně `PRO_EMAILS`
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

