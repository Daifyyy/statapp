import type { Metric } from "@/lib/types";

/**
 * **Kategorický přehled odehraného zápasu**: kdo dominoval, o jaký typ zápasu šlo a jak
 * kdo zahrál – aniž by uživatel musel číst devatenáct řádků syrových čísel.
 *
 * Proč to není `categories.ts` ani `playStyle.ts`: ty pracují nad **váženými průměry přes
 * okna** (forma týmu v sezóně) a berou `MetricValue[]` s venue variantami. Tohle je jeden
 * konkrétní zápas – syrová čísla obou stran, žádná okna, žádný vzorek. Sdílet by se dala
 * leda normalizace, a ta je tu jednořádková.
 *
 * Modul je **čistý**: žádné IO, žádné API. Data k němu tečou z `/fixtures/statistics`
 * (1 volání na zápas, trvale cachované v `MatchStatCache` – tedy stejná cesta a stejná
 * cena jako u porovnání týmů).
 *
 * **Degraduje po částech, ne jako celek.** xG chybí u zhruba třetiny zápasů (a skoro
 * vždy u reprezentací), držení míče u některých lig. Každý rozměr si proto sám řekne,
 * jestli má z čeho počítat (`available`), a verdikt se skládá jen z toho, co je k dispozici.
 * Nikdy nedopočítávat chybějící metriku odhadem – radši rozměr nezobrazit.
 */

/** Metriky, ze kterých se přehled skládá. */
export type MatchSide = Partial<Record<Metric, number>>;

export type MatchDimensionKey = "CONTROL" | "THREAT" | "FINISHING" | "PHYSICAL";

/** Jeden rozměr přehledu – dvojice skóre 0–10, která se v UI kreslí jako protilehlé pruhy. */
export interface MatchDimension {
  key: MatchDimensionKey;
  label: string;
  /** 0–10; součet obou stran je vždy 10 (je to **podíl**, ne absolutní výkon). */
  home: number;
  away: number;
  /** Z čeho to je – aby to nebyla černá skříňka. */
  detail: string;
  available: boolean;
}

/** Povaha zápasu – nezávislá na tom, kdo vyhrál. */
export interface MatchCharacter {
  /** Kolik se toho dělo vepředu. */
  openness: "otevřený" | "průměrně živý" | "uzavřený" | null;
  /** Jak moc byl jednostranný (dle nebezpečnosti, ne dle výsledku). */
  balance: "jednostranný" | "mírná převaha" | "vyrovnaný" | null;
  /** Jak ostrý byl (fauly + karty). */
  intensity: "ostrý" | "běžný" | "klidný" | null;
}

export interface MatchReport {
  available: boolean;
  dimensions: MatchDimension[];
  character: MatchCharacter;
  /** Jednovětý souhrn. Prázdný řetězec, když není z čeho ho postavit. */
  verdict: string;
  /** 2–4 konkrétní pozorování (nejsilnější první). */
  notes: string[];
}

/**
 * Prahy na jednom místě (zásada z `lib/insights/`). Vztažené k typickému zápasu top ligy:
 * ~25 střel, ~2.7 xG, ~22 faulů a ~4 karty dohromady.
 */
const T = {
  /** Součet xG obou stran: nad = otevřený, pod = uzavřený. */
  opennessXgHigh: 3.2,
  opennessXgLow: 1.8,
  /** Fallback bez xG: součet střel na branku. */
  opennessSotHigh: 11,
  opennessSotLow: 6,
  /** Rozdíl v podílu nebezpečnosti (0–10) → jednostrannost. */
  balanceOneSided: 3.0,
  balanceSlight: 1.2,
  /** Součet faulů obou stran. */
  intensityFoulsHigh: 26,
  intensityFoulsLow: 16,
  /** Součet karet obou stran (žluté + červené). */
  intensityCardsHigh: 6,
  /** Rozdíl gól − xG, od kterého mluvíme o (ne)proměňování. */
  finishingEdge: 0.8,
  /** Podíl držení míče, od kterého je to „jasná převaha v držení". */
  possessionDominant: 58,
} as const;

const num = (v: number | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Součet dostupných metrik; `null`, když ani jedna není. */
function sumOf(side: MatchSide, metrics: Metric[]): number | null {
  let sum = 0;
  let seen = false;
  for (const m of metrics) {
    const v = num(side[m]);
    if (v == null) continue;
    sum += v;
    seen = true;
  }
  return seen ? sum : null;
}

/**
 * Podíl domácích na dvojici hodnot, převedený na 0–10. Relativní normalizace (jako
 * `categories.ts`): 5.0 = vyrovnané. Obě nuly → `null` (nula ku nule není 50/50 remíza,
 * je to „nedělo se nic" a rozměr se má skrýt).
 */
function share(home: number | null, away: number | null): number | null {
  if (home == null || away == null) return null;
  const total = home + away;
  if (total <= 0) return null;
  return (home / total) * 10;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Dvojice skóre z podílu domácích. Druhá strana se dopočítá **až ze zaokrouhlené** první –
 * zaokrouhlovat obě zvlášť by dalo součet 10.1 (6.35 → 6.4 a 3.65 → 3.7) a rozbilo by to
 * invariant, na kterém stojí vykreslení protilehlých pruhů.
 */
function pairOf(value: number | null): { home: number; away: number } {
  const home = value == null ? 5 : round1(Math.min(10, Math.max(0, value)));
  return { home, away: round1(10 - home) };
}

/** Karty jedné strany (žluté + červené), `null` když ani jedno není. */
function cardsOf(side: MatchSide): number | null {
  return sumOf(side, ["YELLOW_CARDS", "RED_CARDS"]);
}

/**
 * Rozměr **Kontrola hry**: kdo měl míč a hru pod palcem. Držení míče je hlavní vstup;
 * bez něj se použije objem přesných přihrávek, který říká skoro totéž.
 */
function controlDimension(home: MatchSide, away: MatchSide): MatchDimension {
  const ph = num(home.POSSESSION);
  const pa = num(away.POSSESSION);
  let value = share(ph, pa);
  let detail = ph != null && pa != null ? `držení ${Math.round(ph)} : ${Math.round(pa)} %` : "";

  if (value == null) {
    const kh = num(home.PASSES_ACCURATE);
    const ka = num(away.PASSES_ACCURATE);
    value = share(kh, ka);
    detail = kh != null && ka != null ? `přesné přihrávky ${Math.round(kh)} : ${Math.round(ka)}` : "";
  }

  return {
    key: "CONTROL",
    label: "Kontrola hry",
    ...pairOf(value),
    detail,
    available: value != null,
  };
}

/**
 * Rozměr **Nebezpečnost**: kdo si vytvořil víc. xG je nejlepší vstup; bez něj se skládá
 * ze střel na branku a střel z vápna – tedy z toho, co xG aproximuje.
 */
function threatDimension(home: MatchSide, away: MatchSide): MatchDimension {
  const xh = num(home.XG);
  const xa = num(away.XG);
  if (xh != null && xa != null) {
    const value = share(xh, xa);
    if (value != null) {
      return {
        key: "THREAT",
        label: "Nebezpečnost",
        ...pairOf(value),
        detail: `xG ${xh.toFixed(2)} : ${xa.toFixed(2)}`,
        available: true,
      };
    }
  }
  const th = sumOf(home, ["SHOTS_ON_TARGET", "SHOTS_INSIDE_BOX"]);
  const ta = sumOf(away, ["SHOTS_ON_TARGET", "SHOTS_INSIDE_BOX"]);
  const value = share(th, ta);
  const sh = num(home.SHOTS_ON_TARGET);
  const sa = num(away.SHOTS_ON_TARGET);
  return {
    key: "THREAT",
    label: "Nebezpečnost",
    ...pairOf(value),
    detail: sh != null && sa != null ? `na branku ${sh} : ${sa}` : "",
    available: value != null,
  };
}

/**
 * Rozměr **Proměňování**: kdo vytěžil ze svých šancí víc, než se dalo čekat.
 *
 * Nepočítá se jako podíl gólů (to by jen opakovalo výsledek), ale z **rozdílu gól − xG**.
 * Aby se to vešlo do téže škály 0–10, posune se každá strana o svůj přebytek kolem
 * společného středu. Bez xG rozměr **není** – „efektivita" bez očekávání je jen skóre.
 */
function finishingDimension(home: MatchSide, away: MatchSide): MatchDimension {
  const gh = num(home.GOALS_FOR);
  const ga = num(away.GOALS_FOR);
  const xh = num(home.XG);
  const xa = num(away.XG);
  if (gh == null || ga == null || xh == null || xa == null) {
    return {
      key: "FINISHING",
      label: "Proměňování",
      home: 5,
      away: 5,
      detail: "",
      available: false,
    };
  }
  const edgeHome = gh - xh;
  const edgeAway = ga - xa;
  // Rozdíl přebytků převedený na 0–10; ±2 góly nad očekáváním = kraj škály.
  const diff = edgeHome - edgeAway;
  const value = Math.min(10, Math.max(0, 5 + (diff / 2) * 5));
  const fmt = (e: number) => (e >= 0 ? "+" : "") + e.toFixed(1);
  return {
    key: "FINISHING",
    label: "Proměňování",
    ...pairOf(value),
    detail: `góly vs. xG ${fmt(edgeHome)} : ${fmt(edgeAway)}`,
    available: true,
  };
}

/** Rozměr **Důraz**: kdo víc fauloval a inkasoval karty. */
function physicalDimension(home: MatchSide, away: MatchSide): MatchDimension {
  const fh = num(home.FOULS);
  const fa = num(away.FOULS);
  const value = share(fh, fa);
  const ch = cardsOf(home);
  const ca = cardsOf(away);
  const parts: string[] = [];
  if (fh != null && fa != null) parts.push(`fauly ${fh} : ${fa}`);
  if (ch != null && ca != null) parts.push(`karty ${ch} : ${ca}`);
  return {
    key: "PHYSICAL",
    label: "Důraz",
    ...pairOf(value),
    detail: parts.join(", "),
    available: value != null,
  };
}

/** Povaha zápasu z absolutních hodnot (na rozdíl od rozměrů, které jsou relativní). */
function characterOf(
  home: MatchSide,
  away: MatchSide,
  threat: MatchDimension
): MatchCharacter {
  const xgTotal = sumOf(home, ["XG"]) != null && sumOf(away, ["XG"]) != null
    ? num(home.XG)! + num(away.XG)!
    : null;
  const sotTotal =
    num(home.SHOTS_ON_TARGET) != null && num(away.SHOTS_ON_TARGET) != null
      ? num(home.SHOTS_ON_TARGET)! + num(away.SHOTS_ON_TARGET)!
      : null;

  let openness: MatchCharacter["openness"] = null;
  if (xgTotal != null) {
    openness =
      xgTotal >= T.opennessXgHigh
        ? "otevřený"
        : xgTotal <= T.opennessXgLow
          ? "uzavřený"
          : "průměrně živý";
  } else if (sotTotal != null) {
    openness =
      sotTotal >= T.opennessSotHigh
        ? "otevřený"
        : sotTotal <= T.opennessSotLow
          ? "uzavřený"
          : "průměrně živý";
  }

  let balance: MatchCharacter["balance"] = null;
  if (threat.available) {
    const gap = Math.abs(threat.home - threat.away);
    balance =
      gap >= T.balanceOneSided
        ? "jednostranný"
        : gap >= T.balanceSlight
          ? "mírná převaha"
          : "vyrovnaný";
  }

  let intensity: MatchCharacter["intensity"] = null;
  const fouls =
    num(home.FOULS) != null && num(away.FOULS) != null
      ? num(home.FOULS)! + num(away.FOULS)!
      : null;
  const cards = cardsOf(home) != null && cardsOf(away) != null ? cardsOf(home)! + cardsOf(away)! : null;
  if (fouls != null || cards != null) {
    const hot =
      (fouls != null && fouls >= T.intensityFoulsHigh) ||
      (cards != null && cards >= T.intensityCardsHigh);
    const calm = fouls != null && fouls <= T.intensityFoulsLow && (cards == null || cards <= 2);
    intensity = hot ? "ostrý" : calm ? "klidný" : "běžný";
  }

  return { openness, balance, intensity };
}

/** Jméno strany pro texty. */
export interface MatchTeams {
  home: string;
  away: string;
}

/**
 * Verdikt: jedna věta, která spojí **kdo si vytvořil víc** s **jak to dopadlo**. Právě
 * rozpor mezi tím dvojím je nejužitečnější sdělení („dominovali a nevyhráli"), a přesně
 * to se ze syrové tabulky čte nejhůř.
 */
function verdictOf(
  teams: MatchTeams,
  goals: { home: number; away: number } | null,
  threat: MatchDimension
): string {
  if (!threat.available || goals == null) return "";
  const gap = threat.home - threat.away;
  const better = gap > 0 ? teams.home : teams.away;
  const winner =
    goals.home > goals.away ? teams.home : goals.away > goals.home ? teams.away : null;

  if (Math.abs(gap) < T.balanceSlight) {
    return winner
      ? `Vyrovnaný zápas, ve kterém rozhodl detail ve prospěch ${winner}.`
      : "Vyrovnaný zápas bez jasně lepšího týmu – remíza sedí.";
  }
  const strong = Math.abs(gap) >= T.balanceOneSided;
  if (winner === better) {
    return strong
      ? `${better} soupeře přehráli a výhru si zasloužili.`
      : `${better} byli o kus lepší a dotáhli to do vítězství.`;
  }
  if (winner == null) {
    return `${better} si vytvořili víc, ale na výhru to nestačilo.`;
  }
  // Záměrně **ne** „ovládli zápas": verdikt stojí na NEBEZPEČNOSTI, ne na držení míče.
  // Tým si může vytvořit mnohem víc s třetinou míče (Bournemouth 33 % držení, xG 1.78
  // vs 0.78) – a „ovládli" by si přímo odporovalo s pruhem Kontroly hry hned pod tím.
  return strong
    ? `${better} si vytvořili mnohem víc, ale body bere ${winner} – výsledek neodpovídá průběhu.`
    : `${better} byli mírně lepší, přesto vyhráli ${winner}.`;
}

/** Konkrétní pozorování; nejsilnější první, max 4. */
function notesOf(
  teams: MatchTeams,
  home: MatchSide,
  away: MatchSide,
  dims: Record<MatchDimensionKey, MatchDimension>
): string[] {
  const out: { text: string; strength: number }[] = [];

  // Proměňování – nejčastější zdroj rozporu mezi hrou a výsledkem.
  const gh = num(home.GOALS_FOR);
  const ga = num(away.GOALS_FOR);
  const xh = num(home.XG);
  const xa = num(away.XG);
  for (const [name, g, x] of [
    [teams.home, gh, xh],
    [teams.away, ga, xa],
  ] as const) {
    if (g == null || x == null) continue;
    const edge = g - x;
    if (Math.abs(edge) < T.finishingEdge) continue;
    out.push({
      text:
        edge > 0
          ? `${name}: ${g} gólů z xG ${x.toFixed(2)} – proměňovali nadprůměrně.`
          : `${name}: ${g} gólů z xG ${x.toFixed(2)} – šance zůstaly nevyužité.`,
      strength: Math.abs(edge),
    });
  }

  // Držení míče bez efektu – klasický „jalový" výkon.
  const ph = num(home.POSSESSION);
  const pa = num(away.POSSESSION);
  if (ph != null && pa != null && dims.THREAT.available) {
    const dominant = ph >= T.possessionDominant ? "home" : pa >= T.possessionDominant ? "away" : null;
    if (dominant) {
      const name = dominant === "home" ? teams.home : teams.away;
      const pct = Math.round(dominant === "home" ? ph : pa);
      const theirThreat = dominant === "home" ? dims.THREAT.home : dims.THREAT.away;
      out.push({
        text:
          theirThreat < 5
            ? `${name} drželi míč ${pct} %, ale nebezpečnější byl soupeř.`
            : `${name} kontrolovali hru (${pct} % držení) a proměnili to i v šance.`,
        strength: theirThreat < 5 ? 1.5 : 0.6,
      });
    }
  }

  // Ostrý zápas.
  const cards = cardsOf(home) != null && cardsOf(away) != null ? cardsOf(home)! + cardsOf(away)! : null;
  const reds = sumOf(home, ["RED_CARDS"]) ?? 0;
  const redsAway = sumOf(away, ["RED_CARDS"]) ?? 0;
  if (reds + redsAway > 0) {
    out.push({
      text: `Zápas poznamenalo vyloučení (${reds + redsAway}× červená).`,
      strength: 2,
    });
  } else if (cards != null && cards >= T.intensityCardsHigh) {
    out.push({ text: `Ostrý zápas – ${cards} karet dohromady.`, strength: 0.9 });
  }

  // Brankář jako důvod výsledku.
  const svh = num(home.SAVES);
  const sva = num(away.SAVES);
  for (const [name, saves] of [
    [teams.home, svh],
    [teams.away, sva],
  ] as const) {
    if (saves != null && saves >= 6) {
      out.push({ text: `${name}: brankář musel zasahovat ${saves}×.`, strength: 0.8 });
    }
  }

  return out
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4)
    .map((n) => n.text);
}

/**
 * Hlavní vstup modulu. `goals` se předává zvlášť, protože skóre po 90 minutách zná
 * volající (viz `fullTimeGoals`) a v metrikách zápasu nemusí být.
 */
export function buildMatchReport(
  home: MatchSide,
  away: MatchSide,
  teams: MatchTeams,
  goals: { home: number; away: number } | null
): MatchReport {
  const withGoals = {
    home: goals ? { ...home, GOALS_FOR: goals.home } : home,
    away: goals ? { ...away, GOALS_FOR: goals.away } : away,
  };

  const control = controlDimension(withGoals.home, withGoals.away);
  const threat = threatDimension(withGoals.home, withGoals.away);
  const finishing = finishingDimension(withGoals.home, withGoals.away);
  const physical = physicalDimension(withGoals.home, withGoals.away);
  const dimensions = [control, threat, finishing, physical];

  const available = dimensions.some((d) => d.available);
  if (!available) {
    return {
      available: false,
      dimensions,
      character: { openness: null, balance: null, intensity: null },
      verdict: "",
      notes: [],
    };
  }

  return {
    available: true,
    dimensions,
    character: characterOf(withGoals.home, withGoals.away, threat),
    verdict: verdictOf(teams, goals, threat),
    notes: notesOf(teams, withGoals.home, withGoals.away, {
      CONTROL: control,
      THREAT: threat,
      FINISHING: finishing,
      PHYSICAL: physical,
    }),
  };
}
