import type { PickMarket, PickRule, PredictionRow } from "@/lib/types";
import { evaluateRule } from "./rules";

/**
 * Úspěšnost modelu z odehraných predikcí (čistá funkce nad `PredictionRow[]`).
 * Počítá jen řádky s dostupnou predikcí a známým výsledkem.
 */
export interface TrackRecord {
  n: number;
  outcomeAccuracy: number | null; // argmax 1X2 vs. skutečný výsledek
  over25Accuracy: number | null; // predikce >2.5 (≥50 %) vs. realita
  bttsAccuracy: number | null; // predikce oba skórují (≥50 %) vs. realita
}

function argmaxOutcome(r: PredictionRow): "home" | "draw" | "away" {
  if (r.homeWin >= r.draw && r.homeWin >= r.awayWin) return "home";
  if (r.awayWin >= r.draw && r.awayWin >= r.homeWin) return "away";
  return "draw";
}

function actualOutcome(hg: number, ag: number): "home" | "draw" | "away" {
  return hg > ag ? "home" : hg < ag ? "away" : "draw";
}

export function computeTrackRecord(rows: PredictionRow[]): TrackRecord {
  const settled = rows.filter(
    (r) => r.available && r.homeGoals != null && r.awayGoals != null
  );
  const n = settled.length;
  if (n === 0) {
    return { n: 0, outcomeAccuracy: null, over25Accuracy: null, bttsAccuracy: null };
  }
  let outcomeHits = 0;
  let over25Hits = 0;
  let bttsHits = 0;
  for (const r of settled) {
    const hg = r.homeGoals!;
    const ag = r.awayGoals!;
    if (argmaxOutcome(r) === actualOutcome(hg, ag)) outcomeHits++;
    if ((r.over25 >= 0.5) === (hg + ag >= 3)) over25Hits++;
    if ((r.bttsYes >= 0.5) === (hg > 0 && ag > 0)) bttsHits++;
  }
  return {
    n,
    outcomeAccuracy: outcomeHits / n,
    over25Accuracy: over25Hits / n,
    bttsAccuracy: bttsHits / n,
  };
}

/**
 * Backtest tipovací strategie: kdyby uživatel sázel podle `rule` na historii,
 * jaké úspěšnosti by dosáhl. Čistá funkce – sdílí `evaluateRule` (kvalifikace
 * tipu) s živým výběrem, hodnotí trefu dle skutečného skóre odehraných zápasů.
 */
export interface BacktestResult {
  n: number; // odehrané predikce splňující pravidlo (= vsazené tipy)
  hits: number;
  hitRate: number | null; // null když n === 0
  /** Poslední vsazené tipy (auditace čísla úspěšnosti); seřazené dle kickoff sestupně. */
  samples: BacktestSample[];
}

/** Jeden odehraný tip splňující pravidlo – co se tipovalo, jak to dopadlo. */
export interface BacktestSample {
  fixtureId: number;
  kickoff: string;
  home: { name: string; logoUrl: string };
  away: { name: string; logoUrl: string };
  side: "home" | "away" | null; // strana favorita (jen "win")
  market: PickMarket;
  prob: number; // predikovaná pravděpodobnost relevantní pro pravidlo
  homeGoals: number;
  awayGoals: number;
  hit: boolean; // vyšel tip?
}

/** Vyšel zvolený trh? `side` je strana favorita z `evaluateRule` (jen pro "win"). */
function pickHit(
  hg: number,
  ag: number,
  market: PickMarket,
  side: "home" | "away" | null
): boolean {
  if (market === "over25") return hg + ag >= 3;
  if (market === "btts") return hg > 0 && ag > 0;
  // market === "win"
  return side === "home" ? hg > ag : ag > hg;
}

export function backtestRule(
  rows: PredictionRow[],
  rule: PickRule,
  sampleLimit = 5
): BacktestResult {
  let n = 0;
  let hits = 0;
  const samples: BacktestSample[] = [];
  for (const r of rows) {
    if (!r.available || r.homeGoals == null || r.awayGoals == null) continue;
    const m = evaluateRule(r, rule);
    if (!m.ok) continue;
    n++;
    const hit = pickHit(r.homeGoals, r.awayGoals, rule.market, m.side);
    if (hit) hits++;
    samples.push({
      fixtureId: r.fixtureId,
      kickoff: r.kickoff,
      home: { name: r.homeName, logoUrl: r.homeLogo },
      away: { name: r.awayName, logoUrl: r.awayLogo },
      side: m.side,
      market: rule.market,
      prob: m.prob,
      homeGoals: r.homeGoals,
      awayGoals: r.awayGoals,
      hit,
    });
  }
  // Vzorek = poslední okno (nespoléhat na pořadí vstupu); n/hits zůstávají přes celou historii.
  samples.sort((a, b) => b.kickoff.localeCompare(a.kickoff));
  return {
    n,
    hits,
    hitRate: n === 0 ? null : hits / n,
    samples: samples.slice(0, sampleLimit),
  };
}
