# Datový model / okna metrik

## Datový model / okna (DŮLEŽITÉ)
- `MatchStat` nese `season` (ligová sezóna) + odvozené `isBaseline` (dopočítá se při
  sestavení v `realRepository`, neukládá se → odolné vůči přechodu sezón).
- Klubová okna (`lib/stats/windows.ts`):
  - **SEASON** („minulá sezóna", 15 %) = nejnovější **dokončená** sezóna (`isBaseline`).
    Baseline se určuje dynamicky: je-li aktuální sezóna v podstatě dohraná
    (≥ `SEASON_COMPLETE_MIN`), je baseline ona (mezisezóna) → naplní se i nováčkům.
  - **LAST10 / LAST5** (30 / 55 %) = nejnovějších 10 / 5 zápasů **aktuální sezóny**.
- **Formová okna NEPŘEKRAČUJÍ hranici sezóny.** Dřív brala prostě N nejnovějších zápasů dle
  data, takže „posl. 5 zápasů" znamenalo v srpnu **květen** – a to s vahou 55 %. Od minulé
  sezóny je tu okno SEASON; míchat ji i do formy dělá z popisku lež. V prvních kolech okna
  chybí a `weightedAverage` váhy přerozdělí na SEASON → číslo je **přiznaně** z minulé sezóny.
  Predikát je `!isBaseline` (pool klubu = aktuální + baseline sezóna); u reprezentací je
  `isBaseline` vždy `false`, takže se pro ně nemění nic.
  Totéž platí pro **proužek formy W/D/L, čisté konto a „bez gólu"** (`orderedMatches`
  v `summary.ts`, sdílí ho `formQuality.ts`) – jsou to tvrzení o formě, ne o historii.
  UI na startu sezóny řekne, čím to je (`FormSummary`), aby prázdný proužek nevypadal rozbitě.
- **λ si drží staré chování** (`crossSeasonForm: true` v `compare.ts`) — vědomě, ne z lenosti.
  **Změřeno** (`npm run backtest -- --form-current-season`, 9 909 zápasů, sezóny 2024+2025,
  identický vzorek): utažení oken i pro λ je **mírně lepší, ale na úrovni šumu** —
  1X2 log-loss 1.0219 → **1.0210**, Brier 0.6125 → 0.6120, ECE 0.0087 → **0.0079**,
  Přes 2.5 0.6860 → 0.6857, BTTS beze změny (nepřidává nic tak jako tak), ztráta na trh
  0.0479 → 0.0472. Znaménko je konzistentní po sezónách (2024: −0.0016, 2025: −0.0001),
  takže to **neškodí** — jen to nestojí za nic.
  **Proč se to přesto nesjednotilo:** změna obsahu oken mění λ → podle invariantu v CLAUDE.md
  to je bump `MODEL_VERSION` (dnes 7) a ten **vynuluje dataset predikcí**. Za −0.001 log-lossu
  se dataset neresetuje. Sjednotit **až u nejbližšího bumpu z jiného důvodu** — přepínač
  v backtestu zůstává jako ablace, aby se to dalo kdykoli přeměřit.
  (Reprezentací se to netýká vůbec: mají časová okna a `isBaseline` vždy `false`.)
- **Nováček bez historie v lize** (`buildClubTeam`): fallback na zápasy **napříč soutěžemi**
  (`fetchLastFixtures` – druhá liga, pohár, letní příprava). Spouští se podle **baseline poolu**,
  ne podle formy: `formPool` se naplní hned prvním odehraným kolem, kdežto ligová historie
  nováčkovi chybí celý podzim. Se starou podmínkou (`formPool.length === 0`) tým po 1. kole
  spadl z 20 zápasů kontextu na jediný a okno SEASON (**70 % λ**) mu zůstalo prázdné.
  Fallback **doplňuje, nenahrazuje** – odehraná kola zůstanou a váha se na ně překlopí sama,
  jak přibývají (LAST10/LAST5 jsou řezy podle data). Roztřídění řeší `tagBaseline` podle
  `season`: druholigový ročník jde do SEASON, letní příprava (už nová sezóna) jen do formy.
- **Přátelák má sníženou váhu u OBOU typů entit** (`matchWeight` = `FRIENDLY_WEIGHT` 0.4).
  Kluby dřív dostávaly natvrdo 1.0 – pro hlavní cestu to sedělo (ligové fixtures jsou soutěžní
  vždy), ale fallback výše tahá v srpnu z půlky letní přípravu proti soupeřům o několik pater
  níž a ta se počítala jako plnohodnotné ligové kolo. Vědomě tatáž konstanta jako u reprezentací
  – club-specific hodnotu není na čem fitnout.
- Reprezentace = časová okna BASE (12–24 m) / LAST12 / LAST6; soutěžní zápasy
  mají vyšší váhu než přáteláky.
  **Reprezentace mají skoro plnou sadu metrik** (`METRICS_BY_ENTITY`) – vyloučené je **jen xG**.
  Dřív se jim vynechávalo i držení, přihrávky, střely z/mimo vápno, zákroky a zblokované střely
  s odůvodněním „u reprezentací statistiky chybí". **Změřeno na 1 533 reprezentačních řádcích
  `MatchStatCache` a je to jinak:** když něco chybí, chybí **celá odpověď `/fixtures/statistics`**
  (~třetina reprezentačních zápasů) – ne jednotlivé metriky. Mezi zápasy, které statistiky mají,
  je držení míče v **99,5 %** (přesnost přihrávek 99,1 %, střely z vápna 99,4 %) = stejně dostupné
  jako střely a rohy, které se zobrazovaly celou dobu. Důsledkem starého blocklistu byla trvale
  prázdná kategorie „Hra s míčem" a dimenze „Kontrola míče"/„Styl útoku" u reprezentací.
  **xG je jediná skutečná výjimka** (jen 30,9 % zápasů se statistikami; přáteláky **2,0 %**) →
  zůstává vyloučené a λ reprezentací jede na gólech. Chybějící třetina se řeší sama: metrika bez
  dat nemá vzorek (`weightedAverage` renormalizuje váhy, `lowConfidence` odznak varuje).
  Reprezentační zápasy jsou **venue-neutrální** (`isNeutral: true` v `realRepository`
  i mocku) → doma/venku se nedělí (hrají na neutrální půdě a API to nehlásí spolehlivě),
  vše jde do TOTAL; UI v režimu Reprezentace přepínač Doma/Venku skrývá.
- Vážený průměr re-normalizuje váhy, když okno chybí (`weightedAverage.ts`).
- Metriky z `/fixtures/statistics` mapuje `STAT_TYPE_MAP` (`apiFootball.ts`);
  hodnoty čistí `parseStatValue` (ošetří „65 %"/null/„N/A"). `LOWER_IS_BETTER`
  (`types.ts`) značí metriky, kde je nižší hodnota lepší (obdržené góly, karty…).

