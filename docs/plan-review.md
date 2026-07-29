# Code review + plán úprav (29. 7. 2026)

Review celé aplikace (51 tis. řádků TS/TSX). Řazeno podle **poměru hodnota / riziko**,
ne podle velikosti. Každá etapa je samostatně nasaditelná.

## Výchozí stav — zdravý

| kontrola | výsledek |
|---|---|
| `npm run typecheck` | ✅ čistý |
| `npm run lint` | ✅ čistý |
| `npm test` | ✅ 752 testů / 47 souborů za 7,4 s |
| `npm run build` | ✅ prochází, největší client chunk 297 kB |
| `: any` / `as any` / `@ts-ignore` | **0 výskytů** v `lib/` i `app/` |

Typová disciplína a dokumentace v kódu jsou nadprůměrné. Nálezy níže **nejsou o kvalitě
jednotlivých funkcí**, ale o třech věcech: co selže neviditelně, co není otestované, a
kde velikost souboru začíná brzdit.

---

## ✅ Etapa 1 — Viditelnost selhání — HOTOVO 29. 7. 2026

Provedeno celé (1.1 + 1.2 + 1.3). Ověřeno: `typecheck` ✅ · `lint` ✅ · **757 testů** ✅ ·
`build` ✅. Co se změnilo oproti původnímu návrhu:

- **1.2 se neudělalo přes Sentry, ale přes návratový status cronu** (`lib/cronResult.ts`
  + testy). Důvod: Sentry = nová závislost a `npm install` je na tomhle stroji za TLS
  proxy křehký, kdežto GitHub Actions už monitoring jsou — jen červenaly špatně.
  TODO na Sentry v `logError` zůstává jako volitelné rozšíření.
- **Dílčí výpadek zůstává zelený.** Původní návrh to neřešil; při 18 soutěžích a
  distribuovaném rate-limitu by cron červenal pořád a přestal by se číst.
- **Tři `catch` se nechaly agregované, ne per-položku** (`warmCatalog`, `warmLeague`,
  `computeNationalRatings`) — výpadek jedné položky je tam očekávaný stav (turnaj se
  ten rok nekonal), takže log na položku by byl spam.
- **Navíc oproti plánu:** `authUser.getCurrentUser` — nejzákeřnější tichý stav v appce
  (při výpadku session lookupu se každý platící uživatel tiše přepne na FREE).

### Původní zadání etapy 1

**Proč první:** tohle je přesně ta třída chyby, která už jednou stála **rok bez jediného
uloženého kurzu** (zod schéma odmítlo numerické `value`, `catch` to spolkl). Sezóna začne
za 9 dní a stejný scénář je pořád možný na pěti dalších místech.

### 1.1 Tiché `catch {}` v datové vrstvě — ~22 výskytů
`logError` je použit **40× v `app/api/`, ale jen 4× v celém `lib/`**. Přitom právě
`lib/data/` je vrstva, kde selhání upstreamu nastane.

Nejcitlivější místa (`lib/data/realRepository.ts`):

| řádek | funkce | co se stane při selhání |
|---|---|---|
| 259 | `getLeagueStanding` | `{standing: null, leagueAvg: null}` → zmizí pozice i benchmark |
| 284 | `getLeagueBaseline` | `null` → λ spadne na `DEFAULT_BASELINE` a **predikce tiše zhorší** |
| 315 | `getLeagueRatings` | `null` → λ spadne na okenní model (ztráta ~0.012 log-lossu) |
| 342 | `getNationalRatings` | `null` → reprezentace ztratí globální ratingy |
| 536 | `getTeamTopScorers` | `[]` → sekce se nevykreslí |
| 729 | `getLiveFixtures` | `[]` → **živé skóre přestane svítit a nikdo se to nedozví** |
| 1152 | `getMatchStatsPair` | `null` → Přehled zápasu ukáže prázdno |

Řádky 284 a 315 jsou nejhorší: **model tiše zhorší predikce** a v track-recordu se to
projeví jako „model má horší měsíc", ne jako chyba.

**Úprava:** `catch {` → `catch (e) { logError("realRepository.getX", e); … }`.
Chování se **nemění** (graceful degradace zůstává), jen přestane být neviditelná.
Totéž v `lib/data/predictions.ts` (196, 282, 291, 426) a `lib/data/tips.ts:37`.

**Riziko:** nulové. **Odhad:** ~1 h.

### 1.2 Dotáhnout `logError` do trackeru
`lib/logError.ts` má TODO na Sentry a dnes jen `console.error`. Na Vercelu Hobby jsou
logy dohledatelné jen ručně a krátce → i po 1.1 by se selhání zjistilo náhodou.

**Úprava:** za env flagem `SENTRY_DSN` odeslat do trackeru; bez DSN beze změny.
Alternativa zdarma, pokud se nechce další závislost: počítadlo chyb per scope vystavené
na `/api/warm` (nebo novém `/api/health`), které cron kontroluje.

**Riziko:** nízké. **Odhad:** ~1 h (Sentry) / ~30 min (počítadlo).

### 1.3 `requireCronAuth` je fail-open
Bez `CRON_SECRET` v env **projde kdokoli** (`lib/cronAuth.ts:21`). `/api/warm?league=ID`
přitom spustí stovky volání API-Football na jeden request → veřejně dostupné vyčerpání
denní kvóty 7 500. Aplikace je živá na veřejné doméně.

**Úprava:** dvě části.
1. **Ověřit, že `CRON_SECRET` je nastavený na Vercelu** (pokud ano, riziko je dnes nulové
   a jde jen o pojistku do budoucna).
2. Přepnout na **fail-closed** aspoň pro drahé cesty (`/api/warm?league=`, `cron/*`):
   chybí-li secret v env, vrátit 503 místo pustit dál. Levné cesty můžou zůstat graceful.

**Riziko:** nízké, ale pozor — fail-closed bez nastaveného secretu **zastaví crony**.
Proto krok 1 před krokem 2. **Odhad:** ~30 min.

---

## Etapa 2 — Testy tam, kde chybí (a patří)

Testovací pokrytí je **nerovnoměrné**: model má 752 testů, ale několik modulů s
historií incidentů nemá ani jeden.

### ✅ 2.1 `lib/data/cache.ts` — HOTOVO 29. 7. 2026

25 testů, **produkční kód beze změny** (na rozdíl od 2.2 se tu žádná chyba nenašla — což
je samo o sobě výsledek: tři pravidla, která dosud držel jen komentář, teď drží test).

Prisma se nahrazuje malým in-memory fakem (`vi.hoisted` + `vi.mock("@/lib/db")`) —
**první DB-mockovaný test v repu**, vzor pro `predictionStore`/`tipStore`/`favoritesStore`.
Neověřuje se jím Prisma, ale naše rozhodnutí: kdy se sáhne na fetcher, s jakým TTL se
zapíše a které řádky se čtou.

**Ověřeno mutačně** — testy nesmí jen procházet, musí kousnout. Čtyři záměrné regrese:

| mutace | spadlo |
|---|---|
| práh čtení `MIN` → `CURRENT` (zahodilo by ~9 000 zápasů) | 1 test |
| zrušen guard „`null` se necachuje" | 2 testy |
| prázdné pole dostane plné TTL (oslepí ligu na 24 h) | 1 test |
| zápis starou `schemaVersion` | 3 testy |

### Původní zadání 2.1
Modul s **nejvíc zdokumentovanými incidenty v celém repu**: `null` se nesmí uložit
(házelo výjimku, kterou volající spolkl), prázdné pole musí mít krátké TTL (jinak
oslepí ligu na 24 h), `CURRENT_CACHE_VERSION` vs. `MIN_READABLE_CACHE_VERSION`.
Všechna tři pravidla drží dnes jen komentář.

**Testy k napsání:** TTL expirace, `null` se neuloží, prázdné pole → 3 h TTL,
řádek pod `MIN_READABLE_CACHE_VERSION` se nečte, řádek mezi min a current se čte.

**Odhad:** ~2 h (potřeba lehký mock prisma klienta).

### ✅ 2.2 `categories.ts` + `playStyle.ts` — HOTOVO 29. 7. 2026 (+ nalezená chyba)

25 testů. **Při psaní se našla skutečná chyba v `categories.ts`:** strany se zaokrouhlovaly
**nezávisle**, takže UI ukazovalo dvojice se součtem **10.1** (a pruh `homeScore / total`
jim neodpovídal). Reálné dvojice, ne teorie — držení **30 : 50**, fauly **8.5 : 11.5**,
góly **0.51 : 0.69**; hrubou silou 5 236 dvojic z 16 M. Je to táž past, kvůli které
`matchReport.ts` dopočítává druhou stranu ze zaokrouhlené první — jen tady chyběl test.
Opraveno stejnou konvencí, po opravě **0 z 16 M**.

Mimochodem u `playStyle.ts` mě dvakrát vyvedla z omylu vlastní kontrola: držení míče
**taky** dá součet 10, jsou-li obě strany v rozsahu 30–70 (`(h−30)/40 + (a−30)/40 = 1`).
Není to podíl, jen shoda škály — v testu je to explicitně okomentované, ať to příště
nesvede někoho k závěru, že je `playStyle` relativní.

### Původní zadání 2.2
Čisté funkce, **FREE UI** (vidí je každý), a už tam jednou chyba byla: natvrdo
`unavailableForNational: true` zhaslo reprezentacím dimenze, i když data byla.

**Testy k napsání:** součet relativní normalizace, `LOWER_IS_BETTER` inverze,
metrika s jednou stranou `null` se přeskočí (neposune váhy), kategorie bez dat →
`available: false`, absolutní škálování `playStyle` na krajních hodnotách.

**Odhad:** ~1,5 h. Nejlepší poměr hodnota/čas z celé etapy.

### 2.3 `lib/insights/rules/*` (441 ř.) — jen engine má test
`engine.test.ts` a `perspective.test.ts` existují, ale `rules/team.ts`, `matchup.ts`,
`form.ts` a `predictionReasons.ts` netestuje nic. CLAUDE.md přitom sám říká
„nové pravidlo = jedna položka v registru **+ test**".

**Odhad:** ~2 h (po jednom testu na pravidlo, tabulkově).

### 2.4 Zbytek
`lib/picks/calibration.ts` (69), `lib/stats/weights.ts` (72),
`lib/stats/metricLookup.ts` (54), `lib/data/favoritesStore.ts` (68).
**Odhad:** ~1,5 h.

---

## Etapa 3 — `HraApp.tsx`: 3 751 řádků

Největší soubor v repu. **48 komponent, 24× `useState`, 6× `useEffect`** v jednom
souboru; samotná `HraApp` je 712 řádků (214–926).

### 3.1 Side effect uvnitř `setState` updateru — 14 výskytů
```ts
setSave((prev) => {
  const next = { ...prev, current: fn(prev.current) };
  trackSave(next);          // ← síťový PUT uvnitř updateru
  return next;
});
```
Updater musí být **čistá funkce**. React StrictMode ho v devu volá dvakrát → dvojité
PUT. Že to dělá problém, je v kódu už vidět: **3× `queueMicrotask(() => showToast(…))`**
(řádky 412, 501, 590) je obcházka „setState during render".

**Úprava:** updater nechat čistý a ukládání odpálit z `useEffect` sledujícího `save`
(fronta `pendingSaveRef`/`flushSave` už existuje a je správně navržená — jen se plní
z nesprávného místa). Tím zmizí i tři `queueMicrotask`.

**Riziko:** střední — dotýká se ukládání kariéry. Kryté ručním testem: rychlé klikání
+ dva taby (přesně scénář, kvůli kterému fronta vznikla).
**Odhad:** ~2 h.

### 3.2 Rozdělit soubor
Hranice jsou v kódu už čitelné — tři herní režimy mají svou trojici komponent:

| nový soubor | co v něm | ~ř. |
|---|---|---|
| `hra/GameView.tsx` | `GameView`, `NextMatch`, `SeasonDone`, `JobMarket` | ~700 |
| `hra/TournamentView.tsx` | `TournamentView`, `TournamentNextMatch`, `QualTable`, `MiniTable`, `TournamentBracket`, `TournamentDone` | ~600 |
| `hra/CupView.tsx` | `CupView`, `CupNextMatch`, `CupDone` | ~250 |
| `hra/AgencyPanels.tsx` | `ScoutCard`, `StyleCompass`, `MoraleBar`, `FitnessBar`, `InstructionPicker`, `ActiveModifiers`, `EventCard`, `EvidencePanel` | ~450 |
| `hra/LeagueTable.tsx` | `LeagueTable`, `rankZone`, `FormDots`, `YourForm` | ~250 |
| `hra/ClubPanels.tsx` | `ClubOverview`, `RatingCompare`, `DevMeter`, `DevelopmentPanel` | ~350 |
| `hra/shared.tsx` | `TeamBadge`, `Stars`, `Segment`, `ConfirmDialog`, `MatchResultToast`, `LoadingRows`, `SignInGate` | ~350 |
| `HraApp.tsx` (zůstane) | stav, ukládání, migrace, routing mezi režimy | ~700 |

Adresář `app/_components/hra/` už existuje (`Profile.tsx` je tam vytknutý stejným
způsobem) → je to pokračování zavedeného vzoru, ne nová konvence.

**Riziko:** nízké (přesun bez změny logiky), ověřitelné `typecheck` + `npm test`.
**Odhad:** ~3 h.

---

## Etapa 4 — Duplikace (volitelné, až bude klid)

### 4.1 `lib/math.ts` — 21 kopií `clamp`
`clamp` je definovaný **21×**, `round` 8×, `sum` 7×. Napříč `lib/game/`, `lib/picks/`,
`lib/stats/`. Žádný sdílený matematický util neexistuje.

**Úprava:** `lib/math.ts` s `clamp`/`round`/`sum`/`mean`, postupná náhrada.
**Riziko:** nízké, ale **ověřit, že se implementace neliší** (různé zaokrouhlení by
posunulo fitnutá čísla). **Odhad:** ~1,5 h.

### 4.2 Sjednotit počtové modely (rohy / karty / týmové totaly)
`corners.ts` (459 ř.) a `cards.ts` (681 ř.) mají **stejný tvar nad jinou metrikou**:
`dampen*Total`, `*BaselineFor`, `backtest*`, `*Values`, `*Calibration`, vlastní `clamp`
a vlastní `MIN/MAX_LAMBDA`. `teamTotals.ts` je třetí instance téhož vzoru.

**⚠ Zásadní podmínka:** jsou to **fitnuté modely s naměřenými konstantami**. Refaktor
smí projít jen tehdy, když `npm run backtest -- --corners` a `-- --cards` vydají
**bitově stejná čísla** jako dnes. Bez toho nesahat — riziko tiché změny modelu
převáží úsporu řádků.

**Doporučení:** udělat až **po** verdiktu z CLV (etapa B v `docs/stav.md`). Když se
ukáže, že trh nemá hranu, část kódu se stejně smaže a refaktor bude zbytečný.
**Odhad:** ~4 h. **Nedělat teď.**

### 4.3 Rozhodnout o mrtvém kódu TM money view
`transfersDataset.ts` (141) + `clubCrosswalk.ts` (124) + `importTransfers.ts` (19) +
cron (27) + `MoneyView` (78) = **~390 řádků**, které se nespouští
(`const MODE = "category"`). Vědomé rozhodnutí, ale stojí za revizi: zdroj cen je
zastaralý a návrat je nepravděpodobný.

**Volby:** (a) nechat + poznámku s datem revize, (b) smazat — git historie ho drží.
**Odhad:** ~15 min.

---

## Etapa 5 — Drobnosti

### 5.1 Dokumentace se rozešla s kódem
`docs/ucty-platby.md` a `docs/hra.md` říkají, že `SavedComparison`/`GameSave` visí na
`userId`. **Kód je má na `email` se `SetNull`** (`app/api/account/route.ts:20`), aby
obsah přežil re-login a reset DB. Opravit v docs.

### 5.2 Přístupnost
18 komponent nemá jediný `aria-` ani `role`. Pozitivní zjištění: **nikde není `onClick`
na `<div>`/`<span>`** — klikací prvky jsou skutečná tlačítka, takže jde jen o doplnění:
- `aria-label` u ikonových tlačítek (hvězda oblíbených, sdílení, instalace),
- `aria-live="polite"` u živého skóre v `ZapasyApp` (dnes se mění bez ohlášení),
- `aria-label` u pruhů v `CategoryScores`/`PlayStyleChart`/`MatchReportPanel`
  (dnes je hodnota jen vizuální šířka).

**Odhad:** ~1,5 h.

---

## Doporučené pořadí

| kdy | co | proč teď |
|---|---|---|
| **hned** | 1.1 + 1.3 + 1.2 | do 7. 8. musí být vidět, když sběr dat selže |
| **hned** | 2.2 (categories/playStyle) | nejlepší poměr hodnota/čas, nulové riziko |
| po startu lig | 2.1 (cache.ts) | až po ověření živých kurzů, ať se nemíchají změny |
| klidný týden | 3.1 → 3.2 | 3.1 první: opravuje chování, 3.2 jen přesouvá |
| později | 2.3, 2.4, 4.1, 5.1, 5.2 | údržba bez termínu |
| **až po CLV verdiktu** | 4.2 | část kódu možná zmizí |

**Etapa 1 + 2.2 ≈ 4 hodiny** a pokrývá jediné riziko s termínem.

## Co se NEMÁ dělat
- **Sahat na `lib/stats/predict.ts`, `ratings.ts` ani na fitnuté konstanty** — jsou
  změřené, ne odhadnuté; „úklid" je tam čistá ztráta.
- **Refaktorovat `corners`/`cards` před verdiktem z CLV** (viz 4.2).
- **Přidávat abstrakci nad `compareTeams`** — čistota jádra je nosný invariant.
