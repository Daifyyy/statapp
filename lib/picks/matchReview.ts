import type { PredictionRow, ScoreProbability } from "@/lib/types";
import { PREDICT_PARAMS, gridProbs } from "@/lib/stats/predict";
import { rowClv } from "./clv";
import { actualOutcome, argmaxOutcome, probOfSide } from "./trackRecord";

/**
 * **Model vs. skutečnost** k odehranému zápasu: co jsme před výkopem řekli, co říkal trh
 * a jak to dopadlo. Čistá funkce nad **už uloženým** řádkem predikce – **0 volání API**.
 *
 * Proč to vzniklo: `FixturePrediction` nese λ, pravděpodobnosti, obě sady kurzů i časovou
 * řadu, ale do UI se z toho dostal jediný odznak ✓/✗. Přitom „řekli jsme 2.3 gólu hostům
 * a padly čtyři" nebo „linie se před výkopem hnula k nám" je přesně to, co z čísel sám
 * nikdo nevyčte – a u rohů a karet je tohle **jediné místo, kde jsou ty modely vidět**.
 *
 * Tři zásady, kterými se to řídí:
 *  - **Každá sekce degraduje sama za sebe.** Chybí kurzy → `market` je `null`, zbytek
 *    zůstane. Nic se nedopočítává odhadem (stejné pravidlo jako v `matchReport.ts`).
 *  - **Mřížku skóre staví jen `gridProbs`.** Nejpravděpodobnější výsledek se počítá z
 *    uložených ZÁKLADNÍCH λ toutéž funkcí, jakou používá živá predikce i `reprice` –
 *    druhá implementace Poissona by se dřív nebo později rozešla.
 *  - **`sharpFair` na měření, ne `bestPrice`.** Trh se popisuje odmaržovanou sharp linií
 *    (přes `rowClv`), protože nejlepší cena je vychýlený odhad pravděpodobnosti.
 */

export type ReviewSide = "home" | "draw" | "away";

/** Co model před výkopem řekl a jak to dopadlo. */
export interface ModelReview {
  /** Predikovaná strana 1X2 (argmax) a její pravděpodobnost. */
  side: ReviewSide;
  prob: number;
  hit: boolean;
  /** Očekávané góly (λ z mřížky, tedy po zostření – to, co odpovídá pravděpodobnostem). */
  lambdaHome: number;
  lambdaAway: number;
  /** Nejpravděpodobnější přesné skóre a jestli padlo. */
  topScore: ScoreProbability | null;
  topScoreHit: boolean;
  /** Over 2.5 a BTTS: co model dával a jak to dopadlo. */
  over25Prob: number;
  over25Hit: boolean;
  bttsProb: number;
  bttsHit: boolean;
  /** Predikce stála na málo datech (odznak „málo dat" u tipu). */
  lowConfidence: boolean;
}

/** Co říkal trh – měřeno odmaržovanou linií, ne nejlepší cenou. */
export interface MarketReview {
  /** Strana, ke které se čísla vztahují (ta, kterou model tipoval). */
  side: "home" | "away";
  /** Férová pravděpodobnost strany v našem snímku a při zavření. */
  openProb: number;
  closeProb: number;
  /** `closeProb − openProb`; kladné = trh se pohnul směrem k naší straně. */
  clv: number;
  source: "sharp" | "reference";
  /** Naše pravděpodobnost téže strany – rozdíl proti `closeProb` je „kde jsme se lišili". */
  ourProb: number;
}

/** Očekávaný počet vs. skutečnost u jednoho počtového trhu. */
export interface CountReview {
  expectedHome: number;
  expectedAway: number;
  expectedTotal: number;
  actualHome: number;
  actualAway: number;
  actualTotal: number;
}

export interface MatchReview {
  model: ModelReview | null;
  market: MarketReview | null;
  corners: CountReview | null;
  cards: CountReview | null;
  /**
   * Hotové věty k sekci „Trh". Čísla jsou tu **jediná cesta k textu** – kdyby si je
   * skládalo UI, skončí české skloňování a zaokrouhlování v komponentě, kde ho žádný
   * test nechytí. Rohy a karty tu **nejsou**: kreslí se jako dvojice čísel a věta
   * navíc by říkala totéž podruhé.
   */
  marketNotes: string[];
}

/** Skutečné počty ze statistik zápasu (obě strany); `null` = metriku nemáme. */
export interface ActualCounts {
  corners: { home: number; away: number } | null;
  cards: { home: number; away: number } | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number) => Math.round(x * 100);

/**
 * Sestaví přehled „model a trh vs. skutečnost".
 *
 * `row` je uložená predikce (může chybět → volající sekci vůbec nevykreslí), `goals`
 * skutečné skóre po 90 minutách (shodné s tím, co settle zapisuje a co model predikuje),
 * `counts` skutečné rohy a karty ze statistik, které si přehled zápasu stahuje tak jako tak.
 *
 * Řádek s `available: false` vrátí `model: null`: predikce, kterou jsme sami označili za
 * nepoužitelnou, se nemá zpětně prezentovat jako tip – ani když náhodou vyšla.
 */
export function buildMatchReview(
  row: PredictionRow,
  goals: { home: number; away: number },
  counts: ActualCounts = { corners: null, cards: null }
): MatchReview {
  const model = buildModel(row, goals);
  const market = model ? buildMarket(row, model) : null;
  const corners = buildCount(
    row.lambdaCornersHome,
    row.lambdaCornersAway,
    counts.corners
  );
  const cards = buildCount(row.lambdaCardsHome, row.lambdaCardsAway, counts.cards);

  return { model, market, corners, cards, marketNotes: marketNotesOf(market) };
}

function buildModel(
  row: PredictionRow,
  goals: { home: number; away: number }
): ModelReview | null {
  if (!row.available) return null;

  const side = argmaxOutcome(row);
  // Mřížka z uložených ZÁKLADNÍCH λ – týmž `gridProbs`, jakým vznikly pravděpodobnosti
  // v řádku. Skóre se z DB neukládá (deset dvojic navíc na řádek), přepočet je zdarma.
  const grid = gridProbs(row.lambdaHome, row.lambdaAway, PREDICT_PARAMS);
  const topScore = grid.topScores[0] ?? null;
  const total = goals.home + goals.away;

  return {
    side,
    prob: probOfSide(row, side),
    hit: side === actualOutcome(goals.home, goals.away),
    lambdaHome: grid.lambdaHome,
    lambdaAway: grid.lambdaAway,
    topScore,
    topScoreHit:
      topScore != null && topScore.home === goals.home && topScore.away === goals.away,
    over25Prob: row.over25,
    over25Hit: total >= 3,
    bttsProb: row.bttsYes,
    bttsHit: goals.home >= 1 && goals.away >= 1,
    lowConfidence: row.lowConfidence,
  };
}

/**
 * Trh k **té straně, kterou model tipoval** – jinak by číslo nemělo směr („trh se hnul
 * k domácím" je informace jen ve vztahu k tomu, co jsme říkali my).
 *
 * Remízu vynecháváme: nesázíme ji, `clvSideOf` pro ni zavírací linii neukládá a
 * „posun k remíze" není strana, o které by šlo mluvit.
 */
function buildMarket(row: PredictionRow, model: ModelReview): MarketReview | null {
  if (model.side === "draw") return null;
  const side = model.side;
  const clv = rowClv(row, side);
  if (!clv) return null;

  // Časová řada (`oddsSeries`) se tu **schválně nepoužívá**: `rowClv` už dává dvojici
  // otevření→zavření a je to ta dvojice, na které je CLV definované. Druhý, o kousek
  // jiný pár čísel ze řady by ve stejné větě mátl víc, než by přidal.
  return {
    side,
    openProb: clv.openProb,
    closeProb: clv.closeProb,
    clv: clv.clv,
    source: clv.source,
    ourProb: model.prob,
  };
}

/** Očekávané vs. skutečné počty; `null`, když chybí λ **nebo** skutečnost. */
function buildCount(
  lambdaHome: number | null | undefined,
  lambdaAway: number | null | undefined,
  actual: { home: number; away: number } | null
): CountReview | null {
  if (lambdaHome == null || lambdaAway == null || !actual) return null;
  return {
    expectedHome: round1(lambdaHome),
    expectedAway: round1(lambdaAway),
    expectedTotal: round1(lambdaHome + lambdaAway),
    actualHome: actual.home,
    actualAway: actual.away,
    actualTotal: actual.home + actual.away,
  };
}

/**
 * Věty k sekci „Trh". Zápas je odehraný, takže tu **nic neslibujeme** – jen popisujeme,
 * co se stalo; tím se liší od živého přehledu, kde je zakázaný slovník hlídaný testem.
 *
 * Práh 2 procentní body u CLV není kosmetika: pod ním je pohyb v šumu odmaržování
 * a věta „trh šel s námi" by tvrdila signál tam, kde není.
 */
function marketNotesOf(market: MarketReview | null): string[] {
  if (!market) return [];
  const label = market.side === "home" ? "domácím" : "hostům";
  const out = [
    `Zavírací linie dávala ${label} ${pct(market.closeProb)} %, my ${pct(market.ourProb)} %.`,
  ];

  const move = market.clv * 100;
  if (Math.abs(move) < 2) {
    out.push("Linie se od našeho snímku prakticky nehnula.");
  } else {
    const arrow = `${pct(market.openProb)} → ${pct(market.closeProb)} %`;
    out.push(
      move > 0
        ? `Od našeho snímku se posunula k ${label} (${arrow}) – trh šel s námi.`
        : `Od našeho snímku se posunula od ${label} (${arrow}) – trh šel proti nám.`
    );
  }
  return out;
}
