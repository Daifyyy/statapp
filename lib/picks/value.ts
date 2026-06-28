import type { PickMarket, PredictionRow } from "@/lib/types";

/**
 * Hodnotová analýza tipu = porovnání naší modelové pravděpodobnosti s kurzem
 * sázkovky. Čisté funkce nad uloženými hodnotami – žádná data ani síť. Sdílí je
 * výběr tipů (`evaluateRule`) i UI.
 *
 * Pozn.: `impliedProb = 1/kurz` nese marži sázkovky (vigorish), takže součet přes
 * 1X2 je > 1 – nepoužívat ji jako „skutečnou" pravděpodobnost trhu bez de-vigu.
 * Pro edge to nevadí: porovnáváme naši pravděpodobnost přímo proti vyplácenému kurzu.
 */

/** EV jedné nabídky: hrana nad trhem + implikovaná pravděpodobnost sázkovky. */
export interface ValueEstimate {
  /** Naše modelová pravděpodobnost (0–1). */
  prob: number;
  /** Decimal kurz sázkovky (> 1). */
  odds: number;
  /** Implikovaná pravděpodobnost sázkovky = 1/kurz (s marží – nesčítá se na 1). */
  impliedProb: number;
  /** Očekávaná hodnota na 1 jednotku sázky = prob × kurz − 1 (> 0 = value). */
  edge: number;
}

/** Implikovaná pravděpodobnost z desetinného kurzu. */
export function impliedProb(odds: number): number {
  return 1 / odds;
}

/** Edge (EV na jednotku) = p × kurz − 1. Kladný = sázka má kladnou očekávanou hodnotu. */
export function edge(prob: number, odds: number): number {
  return prob * odds - 1;
}

/**
 * Hodnotový odhad z pravděpodobnosti a kurzu. `null`, když kurz chybí nebo je nesmyslný
 * (≤ 1) či pravděpodobnost není kladná → value nelze posoudit.
 */
export function valueOf(
  prob: number,
  odds: number | null | undefined
): ValueEstimate | null {
  if (odds == null || !Number.isFinite(odds) || odds <= 1) return null;
  if (!Number.isFinite(prob) || prob <= 0) return null;
  return { prob, odds, impliedProb: impliedProb(odds), edge: edge(prob, odds) };
}

/**
 * Hodnotový odhad pro daný trh/stranu z uloženého predikčního řádku (spáruje naši
 * pravděpodobnost se správným kurzem). `side` je relevantní jen pro market "win".
 */
export function rowValue(
  row: PredictionRow,
  market: PickMarket,
  side: "home" | "away" | null
): ValueEstimate | null {
  if (market === "over25") return valueOf(row.over25, row.oddsOver25);
  if (market === "btts") return valueOf(row.bttsYes, row.oddsBtts);
  // market === "win"
  if (side === "home") return valueOf(row.homeWin, row.oddsHome);
  if (side === "away") return valueOf(row.awayWin, row.oddsAway);
  return null;
}
