import type { MatchStat, Metric, MetricValue } from "@/lib/types";
import { computeAllValues } from "@/lib/stats/aggregate";
import { PREDICTION_WINDOW_WEIGHTS } from "@/lib/stats/weights";
import {
  DEFAULT_TUNING,
  strengthRatio,
  type LeagueBaseline,
  type PredictTuning,
} from "@/lib/stats/predict";
import type { HistoryMatch } from "./backtest";
import { matchStatsBefore } from "./backtest";
import { binaryCalibration, type BinaryCalibration } from "./calibration";
// Rozdělení počtu událostí je sdílené s modelem rohů – je to tatáž matematika nad jinou
// veličinou (součet nezávislých počtů, případně overdisperzní), ne druhá implementace.
// Stejná zásada, proč `corners.ts` importuje `strengthRatio` z `predict.ts`.
import { overProbNegBin } from "./corners";

/**
 * **Model karet** – jediná větev, kterou otevřel nález z `asianHandicap.ts`.
 *
 * Proč karty, když gólové trhy jsou uzavřené: měřením (`npm run backtest -- --ah`) vyšlo,
 * že naše odchylka od sharp linie nese **nula** informace (β₂ = 0.007 ± 0.039) a že
 * zaostáváme skoro celý na ose „kdo je lepší", ne „kolik událostí se stane". Karty jsou
 * trh o **úrovni**, ne o poměru sil – tedy přesně ta osa, kde jsme skoro na úrovni trhu.
 *
 * A hlavně: **máme vstup, který trh systematicky podvažuje – rozhodčího.** Kdo píská, je
 * u karet dominantní prediktor (rozdíl mezi nejpřísnějším a nejmírnějším sudím je násobně
 * větší než rozdíl mezi týmy), je to informace **známá předem** a rekreační kniha ji do
 * linie často nedává vůbec – kotuje šablonu z ligových průměrů. Tohle je jediné místo
 * v celém projektu, kde nemáme jen „taky umíme počítat průměry".
 *
 * **Konstrukce je TÁŽ jako u gólů a rohů** (`expectedGoals`, `expectedCorners`):
 *   `λ = ref × (karty týmu / ref) × (karty, které tým vyvolá u soupeřů / ref) × rozhodčí`
 * Sdílí `strengthRatio` (shrinkage podle vzorku + exponent), okna i `PREDICTION_WINDOW_WEIGHTS`.
 *
 * **Data jsou zdarma a offline**: football-data veze `HY/AY/HR/AR` a `Referee` v týchž
 * řádcích jako kurzy (`oddsDataset.ts` → `MatchFacts`), takže kalibrace jde ověřit na
 * tisících zápasů dřív, než se řeší cena. Pořadí prací je stejné jako u rohů: **nejdřív
 * kalibrace proti skutečnosti, teprve pak kurzy a CLV.**
 *
 * Modul je **čistý** a **mimo produkční cestu**: `compareTeams` se nemění, nic se neukládá,
 * 0 volání API.
 *
 * ⚠ **KONVENCE POČÍTÁNÍ KARET** – past, která čeká na trhu, ne tady. Model počítá
 * `karty = žluté + červené` (tedy „kolik karet rozhodčí ukázal"), protože přesně to dává
 * zdroj. Sázkovky ale konvence míchají: „Total Cards" bývá stejné, kdežto **booking points**
 * váží červenou 2–2.5×, a druhá žlutá se někde počítá jako dvě karty a někde jako jedna.
 * Než se model přiloží k jakékoli lince, **ověř pravidla vypořádání té konkrétní knihy**
 * a případně přepočti `CARDS` jinou vahou červených (viz `cardCount`).
 */

/** Metriky, které model karet potřebuje (protějšek `CORNER_METRICS`). */
export const CARD_METRICS = [
  "CARDS",
  "CARDS_AGAINST",
  "FOULS",
  "FOULS_AGAINST",
] as const satisfies readonly Metric[];

/**
 * Meze λ karet na jednu stranu. Karet je zhruba jako gólů + trochu (⌀ ~2 na tým), ale
 * chvost je delší (derby s pěti žlutými) → vlastní meze, ne ty z `predict.ts` ani z rohů.
 */
const MIN_LAMBDA = 0.3;
const MAX_LAMBDA = 8;

/** Meze faktoru rozhodčího – pojistka proti nesmyslu z malého vzorku. */
const MIN_REF_FACTOR = 0.65;
const MAX_REF_FACTOR = 1.5;

/**
 * Kolik karet dostane v této lize průměrný domácí / hostující tým za zápas.
 * Rozdíl mezi stranami je reálný (hosté dostávají víc – domácí prostředí ovlivňuje
 * i rozhodčího), takže se drží stejný home/away rozpad jako u gólů a rohů.
 */
export type CardBaseline = LeagueBaseline;

/**
 * Ligová měřítka, která model potřebuje. **Fauly mají vlastní**, protože jsou o řád
 * jinde (~11 na tým a zápas proti ~2 kartám) – kdyby se poměr faulů dělil kartovým
 * měřítkem, λ by vyšla pětinásobná.
 */
export interface CardBaselines {
  cards: CardBaseline;
  fouls: CardBaseline;
}

/** Fallback, když ligový průměr neznáme (⌀ napříč ligami: ~1.9 domácí, ~2.2 hosté). */
export const DEFAULT_CARD_BASELINE: CardBaseline = { home: 1.9, away: 2.2 };

/** Fallback pro fauly (⌀ napříč ligami ~11 na tým a zápas; hosté faulují o chlup víc). */
export const DEFAULT_FOUL_BASELINE: CardBaseline = { home: 10.8, away: 11.3 };

export const DEFAULT_CARD_BASELINES: CardBaselines = {
  cards: DEFAULT_CARD_BASELINE,
  fouls: DEFAULT_FOUL_BASELINE,
};

/**
 * Karty jedné strany jedním číslem. Váha červené je parametr, ne konstanta – viz
 * varování o konvencích v hlavičce modulu. `1` = „kolik karet padlo".
 */
export function cardCount(yellow: number, red: number, redWeight = 1): number {
  return yellow + redWeight * red;
}

/** Predikce karet jednoho zápasu. */
export interface CardPrediction {
  available: boolean;
  lambdaHome: number;
  lambdaAway: number;
  /** Očekávané karty celkem – veličina, na kterou se sází. */
  lambdaTotal: number;
  /** Použitý faktor rozhodčího (1 = neznámý nebo vypnutý) – ať jde poznat, co λ zvedlo. */
  refereeFactor: number;
  /** Kolik zápasů toho rozhodčího stálo za faktorem (0 = neznámý). */
  refereeSample: number;
}

/**
 * Očekávané karty jedné strany **bez** vlivu rozhodčího, multiplikativně vůči ligovému
 * měřítku. Útok = `CARDS` týmu („jak často fauluje / protestuje"), druhá strana =
 * `CARDS_AGAINST` soupeře („jak moc soupeř kartu u protihráčů vyvolá"), obojí týmž `ref`.
 *
 * Chybí-li jedna strana, bere se za ni ligový průměr; chybí-li obě, vrací `null`.
 */
export function expectedCards(
  team: MetricValue[],
  opponent: MetricValue[],
  isHome: boolean,
  baselines: CardBaselines,
  tuning: PredictTuning = DEFAULT_TUNING,
  foulWeight = 0
): number | null {
  const attackVenue = isHome ? "HOME" : "AWAY";
  const defenseVenue = isHome ? "AWAY" : "HOME";
  const cardRef = isHome ? baselines.cards.home : baselines.cards.away;
  const cardTotalRef = (baselines.cards.home + baselines.cards.away) / 2;
  const foulRef = isHome ? baselines.fouls.home : baselines.fouls.away;
  const foulTotalRef = (baselines.fouls.home + baselines.fouls.away) / 2;

  // Karty a fauly měří **totéž** (jak tvrdě strana hraje), jen fauly bez šumu z toho,
  // jestli za ně rozhodčí sáhl do kapsy – přesně vztah gólů a xG. Míchají se proto na
  // OBOU stranách: útok = FOULS týmu, obrana = FOULS_AGAINST soupeře (fauly, které
  // soupeř na ostatních vyprovokuje).
  const attack = blendCardRatio(
    strengthRatio(team, "CARDS", attackVenue, cardRef, cardTotalRef, tuning),
    strengthRatio(team, "FOULS", attackVenue, foulRef, foulTotalRef, tuning),
    foulWeight,
    cardRef
  );
  const defense = blendCardRatio(
    strengthRatio(opponent, "CARDS_AGAINST", defenseVenue, cardRef, cardTotalRef, tuning),
    strengthRatio(opponent, "FOULS_AGAINST", defenseVenue, foulRef, foulTotalRef, tuning),
    foulWeight,
    cardRef
  );
  if (attack == null && defense == null) return null;

  const ref = attack?.ref ?? defense!.ref;
  return clamp(ref * (attack?.ratio ?? 1) * (defense?.ratio ?? 1), MIN_LAMBDA, MAX_LAMBDA);
}

/**
 * Smíchá poměr z karet s poměrem z faulů. **Nejde použít `blend` z `predict.ts`**: ta
 * bere `ref` z prvního argumentu a když první strana chybí, vrátí `ref` té druhé. U gólů
 * vs. xG to nevadí (obojí ~1.5), ale fauly jsou ~11 proti ~2 kartám – λ by se postavila
 * na pětinásobném měřítku a nic by nespadlo. Proto se `ref` **vždy** drží kartový.
 *
 * Poměry samotné jsou bezrozměrné (každý vůči svému měřítku), takže míchat je přes
 * různé veličiny je legitimní – míchá se „o kolik je tým nad ligou", ne absolutní počty.
 */
function blendCardRatio(
  cards: { ratio: number; ref: number } | null,
  fouls: { ratio: number; ref: number } | null,
  w: number,
  fallbackRef: number
): { ratio: number; ref: number } | null {
  if (cards == null && fouls == null) return null;
  if (cards == null) return { ratio: fouls!.ratio, ref: fallbackRef };
  if (fouls == null || w === 0) return cards;
  return { ratio: cards.ratio * (1 - w) + fouls.ratio * w, ref: cards.ref };
}

/**
 * Jméno rozhodčího na porovnatelný tvar (bez diakritiky, teček a velikosti písmen).
 *
 * **Nutnost, ne kosmetika:** máme dva zdroje jmen a každý píše jinak – API-Football
 * „R. Jones" a „M. Metoğlu", football-data „R Jones". Bez sjednocení by se týž sudí
 * rozpadl na dvě identity, každá by dostala **půlku vzorku**, shrinkage by je obě stáhlo
 * k jedné a signál by tiše zmizel. Přesně ten typ chyby, který nikde nespadne.
 */
export function normalizeRefereeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jeden odřízený zápas rozhodčího: kolik karet ukázal a kolik se od NĚJ čekalo. */
export interface RefereeMatch {
  date: string;
  cards: number;
  /**
   * Kolik karet se v tom zápase čekalo **od těch konkrétních týmů** (λ týmového modelu
   * bez rozhodčího), ne kolik jich má liga průměrně.
   *
   * Rozdíl není kosmetický: sudí nedostávají zápasy náhodně. Kdo píská derby a sestupové
   * bitvy, ukáže víc karet, i kdyby byl úplně průměrný – a proti ligovému průměru by
   * vyšel jako „přísný". Faktor by pak **podruhé započítal to, co už týmová část λ
   * obsahuje**, a přidal by šum místo informace (změřeno: ablace vyšla záporně −0.0024,
   * dokud byl jmenovatel ligový průměr).
   */
  expected: number;
}

export interface RefereeEstimate {
  factor: number;
  sample: number;
}

/**
 * Přísnost rozhodčího jako **multiplikátor** ligového měřítka, z jeho zápasů **před**
 * daným datem (point-in-time – jinak by do predikce protekl hodnocený zápas).
 *
 * `poměr = Σ skutečné karty / Σ ligově očekávané` se smrští k 1 podle vzorku
 * (`(n·poměr + k) / (n + k)`) – stejná forma shrinkage jako `strengthRatio`, takže sudí
 * po třech zápasech nedostane extrémní faktor. Dělí se **ligovým očekáváním**, ne počtem
 * zápasů: rozhodčí pískající v Řecku i v evropském poháru se pak neposuzuje měřítkem
 * jedné z těch soutěží.
 *
 * `weight` je ablační páka: `0` → faktor přesně 1 (= model bez rozhodčího), `1` → plný
 * efekt. Slouží k tomu, aby šlo jedním gridem změřit, **jestli rozhodčí vůbec něco přidává**.
 */
export function refereeFactor(
  matches: RefereeMatch[],
  before: string,
  shrink: number,
  weight = 1
): RefereeEstimate {
  const prior = matches.filter((m) => m.date < before);
  const n = prior.length;
  if (n === 0 || weight === 0) return { factor: 1, sample: n };

  const actual = prior.reduce((a, m) => a + m.cards, 0);
  const expected = prior.reduce((a, m) => a + m.expected, 0);
  if (expected <= 0) return { factor: 1, sample: n };

  const raw = actual / expected;
  const shrunk = (n * raw + shrink) / (n + shrink);
  // Váha se aplikuje až na smrštěný faktor: `weight` má škálovat odchylku od 1, ne
  // obcházet shrinkage.
  const weighted = 1 + (shrunk - 1) * weight;
  return { factor: clamp(weighted, MIN_REF_FACTOR, MAX_REF_FACTOR), sample: n };
}

/**
 * Stlačí **součet** λ k ligovému průměru se zachováním rozdílu – protějšek
 * `dampenCornerTotal`, jen s mezemi pro karty.
 */
export function dampenCardTotal(
  lambdaHome: number,
  lambdaAway: number,
  baseline: CardBaseline,
  t: number
): [number, number] {
  if (t === 1) return [lambdaHome, lambdaAway];
  const ref = baseline.home + baseline.away;
  const sum = ref + (lambdaHome + lambdaAway - ref) * t;
  const diff = lambdaHome - lambdaAway;
  return [
    clamp((sum + diff) / 2, MIN_LAMBDA, MAX_LAMBDA),
    clamp((sum - diff) / 2, MIN_LAMBDA, MAX_LAMBDA),
  ];
}

/** Ladicí parametry modelu karet. */
export interface CardTuning {
  /** Shrinkage a exponent síly – sdílené s gólovým modelem přes `strengthRatio`. */
  base: PredictTuning;
  /** Útlum rozptylu součtu λ (viz `dampenCardTotal`). `1` = vypnuto. */
  totalSpread: number;
  /** Podmíněná overdisperze pro negativně binomické rozdělení. `1` = přesný Poisson. */
  varianceRatio: number;
  /**
   * Shrinkage faktoru rozhodčího (v zápasech). Vyšší = opatrnější.
   *
   * **Musí být VYSOKÝ a je to proti intuici.** Pozorované rozpětí mezi sudími vypadá
   * obrovsky (2.30–6.50 karty = ~99 % průměru), ale při ~58 zápasech na sudího je
   * vzorkovací šum v tom průměru sám o sobě sd ≈ 0.3, tedy srovnatelný s pozorovaným
   * rozptylem mezi sudími. Většina toho rozpětí je artefakt malého vzorku, ne přísnost.
   * Změřeno: `refShrink = 0` (syrový průměr sudího) je **horší než rozhodčího vůbec
   * nepoužít** (−0.0152), zatímco se smrštěním je to +0.0152. Optimum je ploché mezi
   * ~25 a ~100, mimo ten pás rychle padá.
   */
  refShrink: number;
  /** Váha rozhodčího: `0` = model bez něj (ablace), `1` = plný efekt. */
  refereeWeight: number;
  /**
   * Váha FAULŮ proti kartám v odhadu síly (0 = jen karty, 1 = jen fauly). Platí na obou
   * stranách λ: útok = `FOULS`, obrana = `FOULS_AGAINST` soupeře. Přesná analogie
   * `xgWeight` u gólů – faulů je ~11 na tým a zápas proti ~2 kartám, takže nesou tutéž
   * informaci s menším vzorkovým šumem. Fit gridem, ne vírou.
   */
  foulWeight: number;
}

/**
 * **Fitnuto `npm run backtest -- --cards-grid --seasons=2024`**, ověřeno hold-outem na
 * sezóně 2025 (fit ji neviděl). Grid šel na obou osách **až do degenerace**:
 * `totalSpread = 0` („predikuj vždy ligový průměr") i `refereeWeight = 0` („ignoruj
 * sudího") – optimum je **vnitřní na obou**, takže je to fit, ne přefitování.
 *
 * `totalSpread = 0.5` (mírnější než 0.3 u rohů – součet karet má menší přebytek rozptylu).
 * Degenerace `t = 0` dá 0.6592 proti 0.6512 v optimu → týmový signál v kartách existuje.
 *
 * `varianceRatio = 1.2` = negativně binomické rozdělení. Sedí na naměřenou **podmíněnou**
 * disperzi (Pearson 1.173 na 2024, 1.154 na hold-outu), takže není jen dofitované.
 * **Vyšší hodnoty NEBRAT**, i když log-loss na hlavní lince 4.5 vypadá plochý až do 1.4:
 * krajní linie se kazí zřetelně (ECE na 2.5: 0.012 při v=1.2 → 0.026 při 1.5 → 0.045
 * při 1.7). Tohle je přesně ta past, na kterou upozorňuje model rohů – **nesuď podle
 * jedné linie**.
 *
 * `refShrink = 50` je hodnota, která z celého modelu nejvíc odporuje intuici. Rozpětí
 * mezi sudími vypadá obrovsky (2.30–6.50 karty = ~99 % průměru), ale z valné části je to
 * vzorkovací šum (viz `CardTuning.refShrink`). Hlavní důkaz: **bez smrštění
 * (`refShrink = 0`) je model HORŠÍ, než kdyby o rozhodčím nevěděl vůbec** (−0.0152).
 * Přínos sudího tedy stojí a padá se smrštěním – syrový průměr rozhodčího škodí.
 *
 * `foulWeight = 0.3` – **fauly ze zápasu modelu pomáhají, ale málo.** Hypotéza byla, že
 * budou přesnější než karty (11 na tým a zápas proti 2 → menší vzorkový šum, jako xG
 * proti gólům). Měření ji potvrdilo jen zčásti: **samotné fauly jsou zřetelně HORŠÍ než
 * samotné karty** (`foulWeight = 1` → Σ skill 0.0906 vs 0.0935 na hold-outu), takže menší
 * šum nevyváží to, že fauly nesou jen část informace – rozhodčí kartuje i za protesty,
 * fauly na poslední obránci a zdržování, a ne každý faul je kartový. Přimíchat je se ale
 * vyplatí: optimum je vnitřní a na hold-outu 2025 dá **+0.0050** Σ skillu proti nule,
 * a to **na všech pěti liniích**. Fit na 2024 dal 0.30, hold-out to potvrdil (jeho vlastní
 * optimum je 0.5, ale rozdíl mezi 0.3 a 0.5 je 0.0005 = plochý).
 *
 * **Hold-out 2025** (3 996 zápasů, fit běžel jen na 2024): skill nad konstantou
 * **+0.0108 až +0.0242** na liniích 2.5–6.5, ablace rozhodčího **+0.0114 kladná na všech
 * pěti liniích**. Pořadí přínosů: **rozhodčí (+0.0114) ≫ fauly (+0.0050)**.
 */
export const DEFAULT_CARD_TUNING: CardTuning = {
  base: DEFAULT_TUNING,
  totalSpread: 0.5,
  varianceRatio: 1.2,
  refShrink: 50,
  refereeWeight: 1,
  foulWeight: 0.3,
};

/** Predikce karet z už spočítaných hodnot metrik obou týmů. Čistá funkce. */
export function predictCards(
  home: MetricValue[],
  away: MetricValue[],
  referee: RefereeEstimate = { factor: 1, sample: 0 },
  baselines: CardBaselines = DEFAULT_CARD_BASELINES,
  tuning: CardTuning = DEFAULT_CARD_TUNING
): CardPrediction {
  const rawHome = expectedCards(home, away, true, baselines, tuning.base, tuning.foulWeight);
  const rawAway = expectedCards(away, home, false, baselines, tuning.base, tuning.foulWeight);
  if (rawHome == null || rawAway == null) {
    return {
      available: false,
      lambdaHome: 0,
      lambdaAway: 0,
      lambdaTotal: 0,
      refereeFactor: 1,
      refereeSample: 0,
    };
  }

  // Pořadí je záměrné: **nejdřív útlum týmové části, teprve pak rozhodčí.** `totalSpread`
  // existuje proto, že náš TÝMOVÝ odhad má moc velký rozptyl; kdyby se aplikoval až na
  // součin s faktorem rozhodčího, stlačil by i jeho – a to je signál, kterému věříme víc
  // (je znám předem a stojí na desítkách zápasů, ne na formě).
  const [dampedHome, dampedAway] = dampenCardTotal(
    rawHome,
    rawAway,
    baselines.cards,
    tuning.totalSpread
  );
  const lambdaHome = clamp(dampedHome * referee.factor, MIN_LAMBDA, MAX_LAMBDA);
  const lambdaAway = clamp(dampedAway * referee.factor, MIN_LAMBDA, MAX_LAMBDA);

  return {
    available: true,
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaHome + lambdaAway,
    refereeFactor: referee.factor,
    refereeSample: referee.sample,
  };
}

/** Řádek backtestu karet: predikce + skutečnost (protějšek `CornerRow`). */
export interface CardRow {
  fixtureId: number;
  leagueId: number;
  season: number;
  kickoff: string;
  homeName: string;
  awayName: string;
  referee: string | null;
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  refereeFactor: number;
  refereeSample: number;
  /** Čím se z λ počítaly pravděpodobnosti (`1` = Poisson) – jako u `CornerRow`. */
  varianceRatio: number;
  actualHome: number;
  actualAway: number;
  actualTotal: number;
}

/**
 * Ligové měřítko karet z **předchozí** sezóny téže ligy (aby do predikce neprotekl
 * hodnocený ročník). Protějšek `cornerBaselineFor`.
 */
export function cardBaselineFor(
  history: HistoryMatch[],
  leagueId: number,
  season: number
): CardBaselines {
  const prev = history.filter(
    (m) =>
      m.leagueId === leagueId &&
      m.season === season - 1 &&
      m.homeMetrics?.CARDS != null &&
      m.awayMetrics?.CARDS != null
  );
  if (prev.length < 50) return DEFAULT_CARD_BASELINES;
  const avg = (pick: (m: HistoryMatch) => number | undefined): number | null => {
    const vals = prev.map(pick).filter((v): v is number => v != null);
    return vals.length >= 50 ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
  };
  const foulHome = avg((m) => m.homeMetrics?.FOULS);
  const foulAway = avg((m) => m.awayMetrics?.FOULS);
  return {
    cards: {
      home: prev.reduce((a, m) => a + m.homeMetrics!.CARDS!, 0) / prev.length,
      away: prev.reduce((a, m) => a + m.awayMetrics!.CARDS!, 0) / prev.length,
    },
    // Fauly můžou chybět i tam, kde karty jsou → vlastní práh a vlastní fallback.
    fouls:
      foulHome != null && foulAway != null
        ? { home: foulHome, away: foulAway }
        : DEFAULT_FOUL_BASELINE,
  };
}

/**
 * Index zápasů podle rozhodčího. Staví se **jednou** nad celou historií; `refereeFactor`
 * si pak sám odřízne jen zápasy před výkopem, takže point-in-time zůstává zachované
 * a nemusí se pro každou predikci skenovat celá historie.
 *
 * `expectedOf` dodá λ **týmového modelu bez rozhodčího** pro daný zápas – viz
 * `RefereeMatch.expected`, proč to nesmí být ligový průměr. Zápas, pro který λ neznáme
 * (na začátku historie není z čeho stavět), se do indexu nedostane: falešný jmenovatel
 * by faktor pokřivil víc, než kolik by ten zápas přidal.
 *
 * Zápasy bez jména rozhodčího (většina lig ho ve zdroji nemá) se do indexu nedostanou →
 * takový zápas prostě dostane faktor 1.
 */
export function buildRefereeIndex(
  history: HistoryMatch[],
  expectedOf: (fixtureId: number) => number | undefined
): Map<string, RefereeMatch[]> {
  const index = new Map<string, RefereeMatch[]>();
  for (const m of history) {
    const name = m.referee;
    const home = m.homeMetrics?.CARDS;
    const away = m.awayMetrics?.CARDS;
    if (!name || home == null || away == null) continue;
    const expected = expectedOf(m.fixtureId);
    if (expected == null || expected <= 0) continue;
    const key = normalizeRefereeName(name);
    if (!key) continue;
    const entry: RefereeMatch = { date: m.date, cards: home + away, expected };
    const list = index.get(key);
    if (list) list.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

export interface CardBacktestOptions {
  seasons: number[];
  minMatches?: number;
  tuning?: CardTuning;
}

/**
 * Přehraje historii a vydá predikce karet se skutečností – **point-in-time** stejně jako
 * gólový `backtest()` i `backtestCorners()`.
 *
 * Zápasy bez zaznamenaných karet se přeskočí (týká se „extra" lig, jejichž zdrojové
 * soubory karty nemají).
 */
export function backtestCards(
  history: HistoryMatch[],
  opts: CardBacktestOptions
): CardRow[] {
  const seasons = new Set(opts.seasons);
  const minMatches = opts.minMatches ?? 0;
  const tuning = opts.tuning ?? DEFAULT_CARD_TUNING;
  const baselines = new Map<string, CardBaselines>();
  const rows: CardRow[] = [];

  const baselineOf = (leagueId: number, season: number): CardBaselines => {
    const key = `${leagueId}:${season}`;
    let b = baselines.get(key);
    if (!b) {
      b = cardBaselineFor(history, leagueId, season);
      baselines.set(key, b);
    }
    return b;
  };

  // Index zápasů podle týmu – bez něj by každá predikce skenovala celou historii
  // (viz tentýž komentář v `backtestCorners`).
  const byTeam = new Map<number, HistoryMatch[]>();
  for (const m of history) {
    for (const id of [m.homeId, m.awayId]) {
      const list = byTeam.get(id);
      if (list) list.push(m);
      else byTeam.set(id, [m]);
    }
  }

  // ── FÁZE 1: λ TÝMOVÉHO modelu (bez rozhodčího) pro každý zápas s kartami ──────────
  // Počítá se nad CELOU historií, ne jen nad hodnocenými sezónami: slouží zároveň jako
  // jmenovatel pro faktor rozhodčího, a ten potřebuje i starší zápasy. Zároveň je to
  // jediný průchod týmovým modelem – fáze 3 už jen násobí faktorem, protože rozhodčí se
  // aplikuje AŽ ZA útlumem (viz `predictCards`). Tím je dvoufázový běh levnější než
  // původní jednofázový.
  const teamOnly = new Map<number, { home: number; away: number }>();
  for (const m of history) {
    if (m.homeMetrics?.CARDS == null || m.awayMetrics?.CARDS == null) continue;
    const homeStats = matchStatsBefore(byTeam.get(m.homeId) ?? [], m.homeId, m.date, m.season);
    const awayStats = matchStatsBefore(byTeam.get(m.awayId) ?? [], m.awayId, m.date, m.season);
    if (homeStats.length < minMatches || awayStats.length < minMatches) continue;
    const p = predictCards(
      cardValues(homeStats, new Date(m.date)),
      cardValues(awayStats, new Date(m.date)),
      { factor: 1, sample: 0 },
      baselineOf(m.leagueId, m.season),
      tuning
    );
    if (p.available) teamOnly.set(m.fixtureId, { home: p.lambdaHome, away: p.lambdaAway });
  }

  // ── FÁZE 2: index rozhodčích nad těmi očekáváními ────────────────────────────────
  const referees = buildRefereeIndex(history, (id) => {
    const t = teamOnly.get(id);
    return t ? t.home + t.away : undefined;
  });

  // ── FÁZE 3: výsledné řádky pro hodnocené sezóny ──────────────────────────────────
  for (const m of history) {
    if (!seasons.has(m.season)) continue;
    const actualHome = m.homeMetrics?.CARDS;
    const actualAway = m.awayMetrics?.CARDS;
    if (actualHome == null || actualAway == null) continue;
    const base = teamOnly.get(m.fixtureId);
    if (!base) continue;

    // Klíč musí projít touž normalizací jako při stavbě indexu – jinak se sudí nenajde.
    const refKey = m.referee ? normalizeRefereeName(m.referee) : "";
    const ref = refKey
      ? refereeFactor(
          referees.get(refKey) ?? [],
          m.date,
          tuning.refShrink,
          tuning.refereeWeight
        )
      : { factor: 1, sample: 0 };

    const lambdaHome = clamp(base.home * ref.factor, MIN_LAMBDA, MAX_LAMBDA);
    const lambdaAway = clamp(base.away * ref.factor, MIN_LAMBDA, MAX_LAMBDA);

    rows.push({
      fixtureId: m.fixtureId,
      leagueId: m.leagueId,
      season: m.season,
      kickoff: m.date,
      homeName: m.homeName,
      awayName: m.awayName,
      // Normalizované jméno – řádky se podle něj seskupují (`refereeSpread`), takže musí
      // být tentýž klíč jako v indexu, ne původní zápis ze zdroje.
      referee: refKey || null,
      lambdaHome,
      lambdaAway,
      lambdaTotal: lambdaHome + lambdaAway,
      refereeFactor: ref.factor,
      refereeSample: ref.sample,
      varianceRatio: tuning.varianceRatio,
      actualHome,
      actualAway,
      actualTotal: actualHome + actualAway,
    });
  }
  return rows;
}

/** Okenní hodnoty `CARDS`/`CARDS_AGAINST` s **predikčními** vahami oken (70/25/5). */
export function cardValues(matches: MatchStat[], now: Date): MetricValue[] {
  return computeAllValues(
    matches,
    CARD_METRICS,
    "CLUB",
    now,
    PREDICTION_WINDOW_WEIGHTS.CLUB
  );
}

/**
 * Kalibrace jedné linie Over/Under karet. **Tohle je celý smysl kroku 1** – dokud model
 * neumí říct „60 %" tak, aby to nastalo v 60 %, nemá cenu se dívat na kurzy.
 */
export function cardCalibration(rows: CardRow[], line: number): BinaryCalibration {
  return binaryCalibration(
    rows.map((r) => ({
      p: overProbNegBin(r.lambdaTotal, line, r.varianceRatio),
      hit: r.actualTotal > line,
    }))
  );
}

/**
 * Kolik toho rozhodčí vysvětlí: rozptyl **skutečných** karet mezi rozhodčími proti
 * rozptylu uvnitř. Vrací se jen popisná čísla – verdikt „přidává to?" musí padnout
 * z log-lossu na hold-outu (`refereeWeight = 0` vs `1`), ne odsud.
 */
export interface RefereeSpread {
  /** Rozhodčí s aspoň `minMatches` zápasy. */
  count: number;
  /** Nejmírnější a nejpřísnější (⌀ karet na zápas). */
  min: number;
  max: number;
  /** Směrodatná odchylka průměrů mezi rozhodčími. */
  sd: number;
  /** Celkový průměr karet na zápas. */
  overall: number;
}

export function refereeSpread(rows: CardRow[], minMatches = 20): RefereeSpread {
  const byRef = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.referee) continue;
    const list = byRef.get(r.referee);
    if (list) list.push(r.actualTotal);
    else byRef.set(r.referee, [r.actualTotal]);
  }
  const means: number[] = [];
  for (const [, list] of byRef) {
    if (list.length < minMatches) continue;
    means.push(list.reduce((a, v) => a + v, 0) / list.length);
  }
  const all = rows.map((r) => r.actualTotal);
  const overall = all.length ? all.reduce((a, v) => a + v, 0) / all.length : 0;
  if (means.length === 0) return { count: 0, min: 0, max: 0, sd: 0, overall };
  const mu = means.reduce((a, v) => a + v, 0) / means.length;
  const sd = Math.sqrt(means.reduce((a, v) => a + (v - mu) ** 2, 0) / means.length);
  return {
    count: means.length,
    min: Math.min(...means),
    max: Math.max(...means),
    sd,
    overall,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
