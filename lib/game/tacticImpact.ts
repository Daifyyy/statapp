import type { MatchProbs, MatchResult } from "./types";

/**
 * **Dopad taktiky — kolik ti tvoje rozhodnutí v tomhle zápase reálně přineslo.**
 *
 * Manažer nabízí pět plánů, pět instrukcí a counter matici, ale hráč nemá jak poznat,
 * jestli něco z toho zabralo: jediná zpětná vazba je výsledek, a ten je z valné části
 * poissonovský šum. Změřeno na 5 700 zápasech (hra podle doporučení skautů): volba
 * plánu + instrukce hýbe šancí na výhru **Ø +2,2 p.b.** (p90 +4,9, max +8,1), což je
 * za sezónu **~2,6 bodu** — proti směrodatné odchylce sezóny ±8 bodů. Bez explicitního
 * čísla je ten efekt pod prahem rozlišitelnosti a taktika **působí jako dekorace**,
 * i když dekorace není.
 *
 * Proto se u každého tvého zápasu ukládá i **kontrafaktuál**: co by predikce říkala,
 * kdybys nechal `"balanced"`/`"none"`. Rozdíl je *tvoje* zásluha a jde ukázat hned
 * po zápase — nezávisle na tom, jestli výsledek vyšel.
 *
 * **Základna = přesně ten náhled, který hráč viděl před zápasem.** `yourNextMatch`
 * počítá predikci záměrně s `"balanced"`/`"none"` (anti-exploit: jinak by šlo plány
 * proklikat a vzít nejvyšší %). Tentýž neutrální výpočet je tady základnou, takže
 * hlášení zní „model ti dával 41 %, tvůj plán to zvedl na 44 %" a odkazuje na číslo,
 * které hráč skutečně viděl.
 *
 * **Izoluje se jen VOLBA.** Morálka, kondice i eventové modifikátory jsou v základně
 * i ve skutečné λ **totožné**, takže rozdíl odpovídá přesně na otázku „co by se stalo,
 * kdybych nechal výchozí volbu, a všechno ostatní bylo jak bylo". Zůstane efekt plánu ×
 * counteru × instrukce — to jediné, co hráč v tu chvíli ovládá.
 *
 * Pozor na dvě věci, které z toho NEPLYNOU:
 * - **Rozdíl není na stavu nezávislý.** Cesta z násobiče λ na 1X2 je přes Poissona
 *   nelineární, takže týž plán posune unavený tým o jiný počet procentních bodů než
 *   svěží. To je správně (na nízké λ váží tytéž procenta míň), jen se to nesmí číst
 *   jako „konstantní přínos plánu".
 * - **Nezachytí přenos přes kola.** Lepší taktika → víc výher → vyšší morálka příště;
 *   tenhle druhý řád je v základně i skutečnosti stejný, takže se do rozdílu nezapočítá.
 *   Součet za sezónu proto hodnotu volby spíš mírně **podhodnotí**.
 *
 * Vztah k [`expectedPoints.ts`]: xB měří, jestli byla sezóna **zasloužená** (skutečnost
 * vs. odehraná λ), tohle měří, jestli **rozhodnutí** něco udělala (odehraná λ vs. λ
 * bez rozhodnutí). Proto smí tenhle modul základnu z náhledu použít a `xp` ne.
 *
 * Čisté funkce, žádná nová data, 0 volání API.
 */

/** Šance TVÉHO týmu na výhru z 1X2 predikce. */
export function winProbOf(probs: MatchProbs, isHome: boolean): number {
  return isHome ? probs.homeWin : probs.awayWin;
}

/** Dopad taktiky v jednom zápase, odvozený z polí uložených na `MatchResult`. */
export interface MatchTacticImpact {
  /** Šance na výhru bez tvé volby (neutrální náhled před zápasem). */
  winBase: number;
  /** Šance na výhru se skutečně zvolenou taktikou. */
  win: number;
  /** `win − winBase` v procentních bodech (kladné = tvá volba pomohla). */
  shift: number;
  /** `xp − xpBase` v očekávaných bodech. */
  points: number;
}

/**
 * Dopad taktiky z odehraného zápasu, nebo `null` když zápas kontrafaktuál nemá
 * (rozehraná kariéra z dřívější verze, zápas AI proti sobě, turnaj/pohár).
 *
 * Čte se **z uloženého výsledku**, ne ze stavu, a to schválně: kdyby šlo dopad
 * spočítat pro NADCHÁZEJÍCÍ zápas, hráč by proklikal plány a vybral ten s nejvyšším
 * posunem — přesně to, čemu neutrální náhled v `yourNextMatch` brání. Tímhle tvarem
 * je funkce použitelná jen pro zpětný pohled.
 */
export function matchTacticImpact(result: MatchResult): MatchTacticImpact | null {
  const { win, winBase, xp, xpBase } = result;
  if (win == null || winBase == null || xp == null || xpBase == null) return null;
  return {
    winBase,
    win,
    shift: (win - winBase) * 100,
    points: xp - xpBase,
  };
}

export interface SeasonTacticImpact {
  /** Kolik tvých zápasů kontrafaktuál mělo (starší kola ho nemají). */
  matches: number;
  /** Součet `xp − xpBase` přes ně = kolik bodů ti taktika za sezónu vynesla. */
  points: number;
  /** Průměrný posun šance na výhru na zápas, v procentních bodech. */
  avgShift: number;
}

/**
 * Kolik ti taktika vynesla za celou sezónu.
 *
 * Sčítá **jen zápasy, které kontrafaktuál mají** — stejná disciplína jako
 * `seasonExpectedPoints`: obě strany rozdílu musí mít týž jmenovatel, jinak by
 * rozehraná kariéra bez prvních N kol vykázala nesmysl.
 */
export function seasonTacticImpact(
  results: MatchResult[],
  yourTeamId: number
): SeasonTacticImpact {
  let matches = 0;
  let points = 0;
  let shift = 0;

  for (const r of results) {
    if (r.homeId !== yourTeamId && r.awayId !== yourTeamId) continue;
    const impact = matchTacticImpact(r);
    if (!impact) continue;
    matches++;
    points += impact.points;
    shift += impact.shift;
  }

  return {
    matches,
    points: Math.round(points * 10) / 10,
    avgShift: matches ? Math.round((shift / matches) * 10) / 10 : 0,
  };
}

/**
 * Kolik zápasů musí sezóna mít, než se součet ukáže. Na třech kolech je „taktika ti
 * vynesla 0,2 bodu" spíš matoucí než informativní; táž zásada jako `MIN_XP_SAMPLE`.
 */
export const MIN_TACTIC_SAMPLE = 5;
