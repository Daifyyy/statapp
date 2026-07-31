import {
  buildMatchDimensions,
  cardsOf,
  num,
  sumOf,
  FULL_TIME_THRESHOLDS,
  type MatchDimension,
  type MatchSide,
  type MatchTeams,
} from "./matchReport";

/**
 * **Přehled PROBÍHAJÍCÍHO zápasu** – co se zatím děje, ne jak to dopadne.
 *
 * Proč to není `matchReport.ts` s parametrem `elapsed`: relativní rozměry (kdo má víc
 * míče, kdo si vytváří víc) jsou v obou případech totéž a **sdílí se**
 * (`buildMatchDimensions`). Všechno ostatní se liší natolik, že by z toho byl modul, kde
 * má každá funkce dva režimy:
 *  - **absolutní prahy** v `matchReport` jsou kalibrované na 90 minut. Ve 25. minutě by
 *    každý zápas byl „uzavřený" (součet xG ~0.7 < 1.8) a „klidný" (~6 faulů < 16).
 *  - **verdikt** dohraného zápasu páruje hru s výsledkem a je terminální („výhru si
 *    zasloužili"). Živě je to lež o zápase, který ještě běží.
 *  - **rozměr Proměňování** (góly − xG) živě aktivně škodí: gól z xG 0.11 ve 12. minutě
 *    dá rozdíl +0.89 a kraj škály. Nedá se zeslabit koeficientem, musí zmizet.
 *
 * Dvě mechaniky proti šumu, každá řeší něco jiného:
 *  - **objemová brána** (`gate*`, neškáluje se) rozhoduje, jestli o rozměru vůbec mluvit.
 *    Podíl 8:2 ze dvou střel není převaha, je to zaokrouhlovací šum. Tahle brána
 *    v `matchReport.ts` chybí úplně – tam ji supluje fakt, že po 90 minutách je objem vždy.
 *  - **časové škálování** (`timeScale`) převádí 90minutový práh na „zatím". Týká se **jen
 *    povahových chipů**, protože jen ty tvrdí něco o objemu. Podíly jsou bezrozměrné.
 *
 * Modul je **čistý** (žádné IO) a degraduje po částech jako `matchReport.ts`: každý rozměr
 * si sám řekne, jestli má z čeho počítat. Chybějící metrika se nikdy nedopočítává odhadem.
 */

/** Povaha rozehraného zápasu. Popisky jsou vlastní, aby nesplynuly s dohraným reportem. */
export interface LiveCharacter {
  openness: "zatím otevřený" | "průměrně živý" | "zatím uzavřený" | null;
  balance: "jednostranný průběh" | "mírná převaha" | "vyrovnaný průběh" | null;
  intensity: "ostrý" | "běžný" | "zatím klidný" | null;
}

export interface LiveReport {
  available: boolean;
  /** Proč není co ukázat – UI podle toho volí hlášku. */
  reason: "early" | "nodata" | null;
  /** Minuta, ke které přehled platí. UI ji MUSÍ zobrazit (zamrzlý panel jinak lže). */
  minute: number;
  /** CONTROL, THREAT, PHYSICAL – bez FINISHING (viz docstring modulu). */
  dimensions: MatchDimension[];
  character: LiveCharacter;
  /** Jedna věta o dosavadním průběhu. Prázdná, když není z čeho. */
  headline: string;
  /** Max 3 konkrétní pozorování, nejsilnější první. */
  notes: string[];
}

/**
 * Prahy na jednom místě (zásada z `lib/insights/`).
 *
 * Škálované prahy jsou převzaté z `FULL_TIME_THRESHOLDS` beze změny a dělí se pro-rata –
 * proto se tu neopisují. Brány a minutové meze jsou vlastní.
 *
 * **Kalibrační kotvy** (skutečné živé zápasy, 31. 7. 2026, ověřeno sondou):
 *  - Motor–Jagiellonia 11': xG 0.04 : 0.08, střely 1 : 1, fauly 0 : 1
 *    → neprojde `minMinute` ani `gateThreatXg` (0.12 < 0.5). Správně mlčí.
 *  - Lask–Grazer 72': xG 2.19 : 0.02, držení 59 : 41, fauly 9 : 10, zákroky 0 : 6
 *    → jednostranný průběh, brankář hosta je pozorování. Správně mluví.
 *  - Sparta–Zlín 88': xG 2.06 : 0.85, držení 66 : 34, fauly 12 : 12
 *    → „Sparta zatím určuje hru". Správně mluví.
 */
const LT = {
  /** Pod touhle minutou je jakýkoli přehled hádání. */
  minMinute: 20,
  /** Chip tvrdící PŘÍTOMNOST jevu (ostrý, otevřený). */
  chipMinMinute: 25,
  /**
   * Chip tvrdící NEPŘÍTOMNOST jevu (klidný, uzavřený, vyrovnaný). Nepřítomnost se nedá
   * pozorovat brzy: 6 faulů ve 30. minutě je nerozlišitelné od „ještě jsme toho moc
   * neviděli". Proto až od poločasu, bez ohledu na škálování.
   */
  absenceMinMinute: 45,

  // --- objemové brány (NEškálují se: jde o spolehlivost podílu) ---
  /** Součet xG obou stran. ~⌀ 2.7 za zápas ÷ 5. */
  gateThreatXg: 0.5,
  /** Fallback bez xG: součet střel na branku a z vápna obou stran. */
  gateThreatShots: 6,
  /** Součet faulů obou stran. ~22 za zápas ÷ 2. */
  gateFouls: 10,
  /** Fallback kontroly, když chybí držení: součet přesných přihrávek. */
  gatePassesAccurate: 250,

  // --- rozdíly PODÍLŮ (0–10): bezrozměrné, NEškálují se ---
  gapStrong: FULL_TIME_THRESHOLDS.balanceOneSided,
  gapSlight: FULL_TIME_THRESHOLDS.balanceSlight,
  possessionDominant: FULL_TIME_THRESHOLDS.possessionDominant,
  /** Držení, od kterého má smysl mluvit o „míč má, šance ne". */
  possessionSterile: 60,

  // --- pozorování ---
  /** Zákroky brankáře za 90 minut; škáluje se. */
  savesPer90: 6,
  /** Minimum, pod které se o zákrocích nemluví ani po škálování. */
  savesFloor: 3,
  /** Karty celkem za 90 minut; škáluje se. */
  cardsPer90: FULL_TIME_THRESHOLDS.intensityCardsHigh,
  cardsFloor: 3,
  /** Střely na branku celkem za 90, od kterých je bezgólový stav pozorováníhodný. */
  sotForScorelessPer90: 8,
  cornersGap: 4,
  cornersTotal: 6,
  /**
   * Jediný zbytek Proměňování: rozdíl gól − xG dává smysl až v závěru, kdy je za tím
   * dost šancí. Dřív je to popis štěstí v jedné situaci.
   */
  finishingLateMinute: 70,
  finishingLateEdge: 1.2,
} as const;

/**
 * Minuta, ke které přehled platí. O poločase se nic nemění (45), v prodloužení a při
 * penaltách je objem „plný" (90) – škálovat nad 90 nedává smysl, prahy jsou na 90 minut.
 */
export function effectiveMinute(status: string, elapsed: number | null): number {
  if (status === "HT") return 45;
  if (status === "BT" || status === "P") return 90;
  const m = num(elapsed ?? undefined);
  if (m == null) return status === "2H" || status === "ET" ? 45 : 0;
  return Math.min(90, Math.max(0, Math.round(m)));
}

/** Podíl odehraného zápasu pro pro-rata škálování absolutních prahů. */
const timeScale = (minute: number): number => Math.min(1, minute / 90);

/** Stavy, ve kterých je „stav o přestávce" skutečně stavem o přestávce. */
const SECOND_HALF_STATUSES = new Set(["2H", "ET", "BT", "P"]);

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number) => Math.round(x);
const xg = (x: number) => x.toFixed(2);

/**
 * České skloňování počtu (1 / 2–4 / 0 a 5+). Bez něj vznikají věty typu „3 karet"
 * a „1 góly" – čísla se tu do textu dosazují z dat, takže je nejde napsat natvrdo.
 */
const plural = (n: number, one: string, few: string, many: string): string =>
  n === 1 ? one : n >= 2 && n <= 4 ? few : many;

const shotsWord = (n: number) => `${n} ${plural(n, "střela", "střely", "střel")}`;
const cardsWord = (n: number) => `${n} ${plural(n, "karta", "karty", "karet")}`;
const goalsWord = (n: number) => `${n} ${plural(n, "gól", "góly", "gólů")}`;

/** Součet metriky přes obě strany; `null`, když ji nemá ani jedna. */
function totalOf(home: MatchSide, away: MatchSide, metric: Parameters<typeof sumOf>[1][number]): number | null {
  const h = sumOf(home, [metric]);
  const a = sumOf(away, [metric]);
  if (h == null && a == null) return null;
  return (h ?? 0) + (a ?? 0);
}

interface Gates {
  threat: boolean;
  control: boolean;
  physical: boolean;
}

/**
 * Objemové brány. Rozhodují, jestli je za podílem dost dění na to, aby se o něm dalo
 * mluvit – **ne** jestli metrika existuje (to řeší `available` na rozměru).
 */
function gatesOf(home: MatchSide, away: MatchSide): Gates {
  const xgTotal = totalOf(home, away, "XG");
  const shotsTotal =
    (sumOf(home, ["SHOTS_ON_TARGET", "SHOTS_INSIDE_BOX"]) ?? 0) +
    (sumOf(away, ["SHOTS_ON_TARGET", "SHOTS_INSIDE_BOX"]) ?? 0);
  const threat =
    xgTotal != null ? xgTotal >= LT.gateThreatXg : shotsTotal >= LT.gateThreatShots;

  const hasPossession = num(home.POSSESSION) != null && num(away.POSSESSION) != null;
  const passesTotal = totalOf(home, away, "PASSES_ACCURATE") ?? 0;
  const control = hasPossession || passesTotal >= LT.gatePassesAccurate;

  const fouls = totalOf(home, away, "FOULS");
  const physical = fouls != null && fouls >= LT.gateFouls;

  return { threat, control, physical };
}

/** Povaha zápasu – jediné místo, kde se škáluje časem. */
function characterOf(
  home: MatchSide,
  away: MatchSide,
  threat: MatchDimension,
  gates: Gates,
  minute: number
): LiveCharacter {
  const s = timeScale(minute);
  const T = FULL_TIME_THRESHOLDS;

  let openness: LiveCharacter["openness"] = null;
  if (gates.threat) {
    const xgTotal = totalOf(home, away, "XG");
    const sotTotal = totalOf(home, away, "SHOTS_ON_TARGET");
    const [value, high, low] =
      xgTotal != null
        ? [xgTotal, T.opennessXgHigh * s, T.opennessXgLow * s]
        : sotTotal != null
          ? [sotTotal, T.opennessSotHigh * s, T.opennessSotLow * s]
          : [null, 0, 0];
    if (value != null) {
      if (value >= high && minute >= LT.chipMinMinute) openness = "zatím otevřený";
      else if (value <= low && minute >= LT.absenceMinMinute) openness = "zatím uzavřený";
      else if (minute >= LT.chipMinMinute) openness = "průměrně živý";
    }
  }

  let balance: LiveCharacter["balance"] = null;
  if (gates.threat && threat.available) {
    const gap = Math.abs(threat.home - threat.away);
    if (gap >= LT.gapStrong) balance = "jednostranný průběh";
    else if (gap >= LT.gapSlight) balance = "mírná převaha";
    else if (minute >= LT.absenceMinMinute) balance = "vyrovnaný průběh";
  }

  let intensity: LiveCharacter["intensity"] = null;
  if (gates.physical) {
    const fouls = totalOf(home, away, "FOULS") ?? 0;
    const cards = (cardsOf(home) ?? 0) + (cardsOf(away) ?? 0);
    const hot =
      fouls >= T.intensityFoulsHigh * s || cards >= T.intensityCardsHigh * s;
    const calm = fouls <= T.intensityFoulsLow * s && cards <= 2;
    if (hot && minute >= LT.chipMinMinute) intensity = "ostrý";
    else if (calm && minute >= LT.absenceMinMinute) intensity = "zatím klidný";
    else if (minute >= LT.chipMinMinute) intensity = "běžný";
  }

  return { openness, balance, intensity };
}

/**
 * Jedna věta o dosavadním průběhu. **Popisná, ne hodnotící** a nikdy o výsledku – proto
 * v ní vždycky je „zatím" nebo číslo (kryto testem). Formulace „ovládá zápas" je zakázaná
 * ze stejného důvodu jako v `matchReport.ts`: headline stojí na NEBEZPEČNOSTI, ne na
 * držení, takže by si odporovala s pruhem Kontroly hry hned pod sebou.
 */
function headlineOf(
  teams: MatchTeams,
  home: MatchSide,
  away: MatchSide,
  dims: { CONTROL: MatchDimension; THREAT: MatchDimension },
  gates: Gates,
  minute: number
): string {
  const threat = dims.THREAT;
  const ph = num(home.POSSESSION);
  const pa = num(away.POSSESSION);

  if (!gates.threat || !threat.available) {
    const shotsTotal = totalOf(home, away, "SHOTS");
    // Míč bez šancí – věcně to nejčastější, co se dá o takovém zápase říct. Podmíněné
    // tím, že o střelách vůbec něco víme; jinak by věta tvrdila něco o šancích naslepo.
    if (shotsTotal != null && ph != null && pa != null) {
      if (ph >= LT.possessionSterile) {
        return `${teams.home} má víc míče (${pct(ph)} %), do šancí se to zatím nepromítá.`;
      }
      if (pa >= LT.possessionSterile) {
        return `${teams.away} má víc míče (${pct(pa)} %), do šancí se to zatím nepromítá.`;
      }
    }
    if (gates.physical) {
      const fouls = totalOf(home, away, "FOULS") ?? 0;
      const cards = (cardsOf(home) ?? 0) + (cardsOf(away) ?? 0);
      return `Za ${minute} minut se zatím hraje hlavně v poli – ${fouls} faulů, ${cardsWord(cards)}.`;
    }
    /**
     * Malý objem je sám o sobě informace – a na rozdíl od podílu je **dobře změřený**
     * (součet nemá jmenovatele, který by se blížil nule). Bez téhle větve vracel report
     * `available: true` s prázdným headlinem, takže panel ukázal pruh držení a nic víc.
     */
    if (shotsTotal != null) {
      return `Za ${minute} minut je toho zatím málo – dohromady ${shotsWord(shotsTotal)}.`;
    }
    if (ph != null && pa != null) {
      return `Zatím máme jen držení míče – ${pct(ph)} : ${pct(pa)} %.`;
    }
    return "";
  }

  const gap = threat.home - threat.away;
  const homeBetter = gap > 0;
  const better = homeBetter ? teams.home : teams.away;
  const xh = num(home.XG);
  const xa = num(away.XG);
  const numbers =
    xh != null && xa != null ? `xG ${xg(xh)} : ${xg(xa)}` : threat.detail || "";

  // Oslabení soupeře převáží taktické vysvětlení – deset hráčů přirozeně ztrácí míč.
  const redsHome = sumOf(home, ["RED_CARDS"]) ?? 0;
  const redsAway = sumOf(away, ["RED_CARDS"]) ?? 0;
  const oppWeakened = homeBetter ? redsAway > 0 : redsHome > 0;
  const suffix = oppWeakened ? " Soupeř přitom hraje v oslabení." : "";

  if (Math.abs(gap) >= LT.gapStrong) {
    const betterPossession = homeBetter ? ph : pa;
    const otherPossession = homeBetter ? pa : ph;
    if (betterPossession != null && betterPossession >= LT.possessionDominant) {
      return `${better} zatím určuje hru: ${pct(betterPossession)} % držení a víc vytvořených šancí (${numbers}).${suffix}`;
    }
    if (otherPossession != null && otherPossession >= LT.possessionDominant) {
      const other = homeBetter ? teams.away : teams.home;
      return `Míč má ${other} (${pct(otherPossession)} %), ale nebezpečnější je zatím ${better} – ${numbers}.${suffix}`;
    }
    const sh = num(home.SHOTS_ON_TARGET);
    const sa = num(away.SHOTS_ON_TARGET);
    const shots = sh != null && sa != null ? `na branku ${sh} : ${sa}, ` : "";
    return `${better} si zatím vytváří výrazně víc – ${shots}${numbers}.${suffix}`;
  }

  if (Math.abs(gap) >= LT.gapSlight) {
    return `${better} je zatím o kus nebezpečnější (${numbers}), rozdíl ale není velký.`;
  }

  if (minute >= LT.absenceMinMinute) {
    return `Zatím vyrovnaný průběh – ani jeden tým si nevytváří víc (${numbers}).`;
  }
  return `Zatím je to vyrovnané (${numbers}).`;
}

/**
 * Konkrétní pozorování. Stejná mechanika jako `notesOf` v `matchReport.ts` (kandidáti se
 * silou, sort, strop) – vědomě se **nepůjčuje** `pickKeySignals` z `lib/insights/`, ta je
 * postavená na kategoriích a jejich vahách, které tu neexistují.
 */
function notesOf(
  teams: MatchTeams,
  home: MatchSide,
  away: MatchSide,
  dims: { CONTROL: MatchDimension; THREAT: MatchDimension },
  gates: Gates,
  goals: { home: number; away: number } | null,
  minute: number,
  halftime: { home: number; away: number } | null
): string[] {
  const out: { text: string; strength: number }[] = [];
  const s = timeScale(minute);
  const threat = dims.THREAT;

  // Vývoj po přestávce – čistě popisné a nezávislé na statistikách (jde jen ze skóre).
  // Volající sem posílá poločasový stav **jen když dává smysl**: v prvním poločase do něj
  // API sype průběžné skóre, takže by věta tvrdila nesmysl (viz `buildLiveReport`).
  if (halftime != null && goals != null) {
    const since = goals.home - halftime.home + (goals.away - halftime.away);
    out.push(
      since === 0
        ? {
            text: `Od poločasu (${halftime.home}:${halftime.away}) se skóre zatím nezměnilo.`,
            strength: 1.1,
          }
        : {
            text: `Druhý poločas zatím přinesl ${goalsWord(since)}.`,
            strength: 1.1,
          }
    );
  }

  // Vyloučení – mění zápas víc než cokoli jiného, co umíme z čísel přečíst.
  const redsHome = sumOf(home, ["RED_CARDS"]) ?? 0;
  const redsAway = sumOf(away, ["RED_CARDS"]) ?? 0;
  for (const [name, reds] of [
    [teams.home, redsHome],
    [teams.away, redsAway],
  ] as const) {
    if (reds > 0) {
      out.push({
        text: `${name} hraje v oslabení (${reds}× červená karta).`,
        strength: 2.4,
      });
    }
  }

  // Rozpor mezi hrou a stavem – nejužitečnější sdělení, ze syrové tabulky nejhůř čitelné.
  if (gates.threat && threat.available && goals != null && goals.home !== goals.away) {
    const gap = threat.home - threat.away;
    const leaderIsHome = goals.home > goals.away;
    const betterIsHome = gap > 0;
    if (Math.abs(gap) >= LT.gapStrong && leaderIsHome !== betterIsHome) {
      const better = betterIsHome ? teams.home : teams.away;
      const leader = leaderIsHome ? teams.home : teams.away;
      out.push({
        text: `Na hřišti je zatím lepší ${better}, na ukazateli ale vede ${leader} ${goals.home}:${goals.away}.`,
        strength: 1.8,
      });
    }
  }

  // Jalové držení.
  const ph = num(home.POSSESSION);
  const pa = num(away.POSSESSION);
  if (ph != null && pa != null && gates.threat && threat.available) {
    const dominant = ph >= LT.possessionSterile ? "home" : pa >= LT.possessionSterile ? "away" : null;
    if (dominant) {
      const name = dominant === "home" ? teams.home : teams.away;
      const share = dominant === "home" ? threat.home : threat.away;
      if (share < 4.5) {
        out.push({
          text: `${name} drží ${pct(dominant === "home" ? ph : pa)} % míče, nebezpečnější je zatím soupeř.`,
          strength: 1.5,
        });
      }
    }
  }

  // Bezgólový stav navzdory objemu.
  const sotTotal = totalOf(home, away, "SHOTS_ON_TARGET");
  if (
    goals != null &&
    goals.home === 0 &&
    goals.away === 0 &&
    sotTotal != null &&
    sotTotal >= LT.sotForScorelessPer90 * s
  ) {
    out.push({
      text: `Zatím bez branky – na branku ${shotsWord(sotTotal)}.`,
      strength: 1.2,
    });
  }

  // Karty (vyloučení má vlastní, silnější notu výš).
  const cards = (cardsOf(home) ?? 0) + (cardsOf(away) ?? 0);
  if (redsHome + redsAway === 0 && cards >= Math.max(LT.cardsFloor, LT.cardsPer90 * s)) {
    out.push({ text: `Ostrý zápas – ${cardsWord(cards)} za ${minute} minut.`, strength: 1.0 });
  }

  // Brankář jako důvod, proč to zatím drží.
  for (const [name, saves] of [
    [teams.home, num(home.SAVES)],
    [teams.away, num(away.SAVES)],
  ] as const) {
    if (saves != null && saves >= Math.max(LT.savesFloor, LT.savesPer90 * s)) {
      out.push({
        text: `Brankář ${name} musel zatím zasáhnout ${saves}×.`,
        strength: 0.9,
      });
    }
  }

  // Standardky.
  const ch = num(home.CORNERS);
  const ca = num(away.CORNERS);
  if (ch != null && ca != null && ch + ca >= LT.cornersTotal && Math.abs(ch - ca) >= LT.cornersGap) {
    const name = ch > ca ? teams.home : teams.away;
    out.push({ text: `${name} tlačí ze standardek – rohy ${ch} : ${ca}.`, strength: 0.8 });
  }

  // Proměňování až v závěru – dřív je to popis štěstí v jedné situaci.
  if (minute >= LT.finishingLateMinute && goals != null) {
    for (const [name, g, x] of [
      [teams.home, goals.home, num(home.XG)],
      [teams.away, goals.away, num(away.XG)],
    ] as const) {
      if (x == null) continue;
      const edge = g - x;
      if (Math.abs(edge) < LT.finishingLateEdge) continue;
      out.push({
        text:
          edge > 0
            ? `${name}: ${goalsWord(g)} z xG ${xg(x)} – zatím výrazně nad očekáváním.`
            : `${name}: ${goalsWord(g)} z xG ${xg(x)} – šance zatím zůstávají nevyužité.`,
        strength: 0.7,
      });
    }
  }

  return out
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
    .map((n) => n.text);
}

const EMPTY_CHARACTER: LiveCharacter = {
  openness: null,
  balance: null,
  intensity: null,
};

/**
 * Hlavní vstup modulu. `goals` a `elapsed`/`status` přicházejí ze živého feedu
 * (`/fixtures?live=`), metriky z `/fixtures/statistics` téhož zápasu.
 */
export function buildLiveReport(input: {
  home: MatchSide;
  away: MatchSide;
  teams: MatchTeams;
  goals: { home: number; away: number } | null;
  elapsed: number | null;
  status: string;
  /** Stav o přestávce z téže odpovědi jako živé skóre (0 volání navíc). */
  halftime?: { home: number; away: number } | null;
}): LiveReport {
  const minute = effectiveMinute(input.status, input.elapsed);
  /**
   * Poločasový stav se smí použít **až od druhého poločasu**. V prvním do něj API sype
   * průběžné skóre (ověřeno živě: Motor Lublin ve 40. minutě už měl `halftime` 0:1),
   * takže by věta „od poločasu se nic nezměnilo" byla vždycky pravdivá a vždycky nesmysl.
   * O samotné přestávce (`HT`) je taky bez informace – tehdy je to prostě aktuální skóre.
   */
  const halftime =
    input.halftime != null && SECOND_HALF_STATUSES.has(input.status)
      ? input.halftime
      : null;
  const withGoals = {
    home: input.goals ? { ...input.home, GOALS_FOR: input.goals.home } : input.home,
    away: input.goals ? { ...input.away, GOALS_FOR: input.goals.away } : input.away,
  };

  const all = buildMatchDimensions(withGoals.home, withGoals.away);
  const gates = gatesOf(withGoals.home, withGoals.away);
  // Rozměr se ukáže, jen když má data **a** je za ním dost dění. `matchReport` druhou
  // podmínku nepotřebuje – po 90 minutách objem je vždycky.
  const dimensions: MatchDimension[] = [
    { ...all.CONTROL, available: all.CONTROL.available && gates.control },
    { ...all.THREAT, available: all.THREAT.available && gates.threat },
    { ...all.PHYSICAL, available: all.PHYSICAL.available && gates.physical },
  ];

  if (minute < LT.minMinute) {
    return {
      available: false,
      reason: "early",
      minute,
      dimensions,
      character: EMPTY_CHARACTER,
      // Řadová číslovka schválně: „běží 2 minut" i „běží 1 minutu" by chtěly skloňovat
      // podle hodnoty, kterou dosazujeme z dat.
      headline: `Je teprve ${minute}. minuta – na přehled průběhu je zatím brzy.`,
      notes: [],
    };
  }

  if (!dimensions.some((d) => d.available)) {
    return {
      available: false,
      reason: "nodata",
      minute,
      dimensions,
      character: EMPTY_CHARACTER,
      headline: "Pro tenhle zápas zatím nemáme dost živých statistik.",
      notes: [],
    };
  }

  const gated = {
    CONTROL: dimensions[0],
    THREAT: dimensions[1],
  };

  return {
    available: true,
    reason: null,
    minute,
    dimensions,
    character: characterOf(withGoals.home, withGoals.away, gated.THREAT, gates, minute),
    headline: headlineOf(input.teams, withGoals.home, withGoals.away, gated, gates, minute),
    notes: notesOf(
      input.teams,
      withGoals.home,
      withGoals.away,
      gated,
      gates,
      input.goals,
      minute,
      halftime
    ),
  };
}

/** Kulaté číslo pro UI („stav v 63. minutě"). Vystaveno kvůli testům i panelu. */
export const liveMinuteLabel = (minute: number): string => `stav v ${round1(minute)}. minutě`;
