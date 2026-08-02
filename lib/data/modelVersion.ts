/**
 * Verze modelu = **co generuje λ** (okna, váhy, xG zpevnění, build týmů). Bump vynuluje
 * dataset (kalibrace i track-record běží per verzi), protože stará λ už nejde srovnávat.
 *
 * **NEbumpuj kvůli ρ / zostření λ / Platt kalibraci** – to jsou post-parametry nad
 * uloženými λ (`PREDICT_PARAMS` v `lib/stats/predict.ts`). Změna konstanty +
 * `npm run reprice` přepočte historii čistou matematikou, bez API a bez ztráty
 * nasbíraných zápasů. Stejně tak pod ni nepatří λ rohů a karet – paralelní stopa
 * vedle gólové λ, ne jiný výpočet 1X2.
 *
 * **Proč to bydlí ve vlastním souboru, a ne v `predictions.ts`:** ten importuje
 * `./repository`, takže repozitář by si konstantu zpátky vytáhnout nemohl (cyklus) –
 * a přesně proto se na filtr verze v cestě do UI zapomnělo a track-record počítal
 * z **69 řádků, ze kterých bylo 62 z verze 1**. Leaf modul bez importů to řeší natrvalo;
 * `predictions.ts` konstantu re-exportuje, takže všechny stávající importy platí dál.
 */
export const MODEL_VERSION = 7;
