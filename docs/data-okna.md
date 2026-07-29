# Datový model / okna metrik

## Datový model / okna (DŮLEŽITÉ)
- `MatchStat` nese `season` (ligová sezóna) + odvozené `isBaseline` (dopočítá se při
  sestavení v `realRepository`, neukládá se → odolné vůči přechodu sezón).
- Klubová okna (`lib/stats/windows.ts`):
  - **SEASON** („minulá sezóna", 15 %) = nejnovější **dokončená** sezóna (`isBaseline`).
    Baseline se určuje dynamicky: je-li aktuální sezóna v podstatě dohraná
    (≥ `SEASON_COMPLETE_MIN`), je baseline ona (mezisezóna) → naplní se i nováčkům.
  - **LAST10 / LAST5** (30 / 55 %) = nejnovějších 10 / 5 zápasů dle data (napříč sezónami).
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

