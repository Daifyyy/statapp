import type { EntityType, WindowKey } from "@/lib/types";

/**
 * Váhy časových oken (§3.1 / §3.4 plánu). Nejnovější data mají největší váhu.
 * Kluby:        SEASON 15 % / LAST10 30 % / LAST5 55 %
 * Reprezentace: BASE   15 % / LAST12 30 % / LAST6 55 %
 */
export const WINDOW_WEIGHTS: Record<EntityType, Record<WindowKey, number>> = {
  CLUB: {
    SEASON: 0.15,
    LAST10: 0.3,
    LAST5: 0.55,
    BASE: 0,
    LAST12: 0,
    LAST6: 0,
  },
  NATIONAL: {
    BASE: 0.15,
    LAST12: 0.3,
    LAST6: 0.55,
    SEASON: 0,
    LAST10: 0,
    LAST5: 0,
  },
} as const;

/**
 * Váhy oken pro **predikci** (λ) – vědomě jiné než pro zobrazení.
 *
 * Zobrazené metriky mají odpovídat na „jak tým hraje teď" → těžiště na posledních zápasech.
 * λ má odpovídat na „kolik gólů padne" → potřebuje **odhad, ne popis formy**, a pět zápasů je
 * z valné části šum. Backtest (3 511 klubových zápasů, hold-out na sezóně 2025) to změřil:
 * s vahami 15/30/55 vyšel log-loss **1.0474**, se 70/25/5 **1.0196** – zdaleka největší
 * jednotlivé zlepšení modelu. Extrém „jen minulá sezóna" (100/0/0) je ale horší (1.0228) →
 * aktuální forma hodnotu má, jen mnohem menší, než jsme jí dávali.
 *
 * Reprezentace zůstávají na zobrazovacích vahách – backtest je nepokrývá (jiná okna, málo
 * zápasů), takže tu není co fitovat; neměň je od stolu.
 */
export const PREDICTION_WINDOW_WEIGHTS: Record<
  EntityType,
  Record<WindowKey, number>
> = {
  CLUB: {
    SEASON: 0.7,
    LAST10: 0.25,
    LAST5: 0.05,
    BASE: 0,
    LAST12: 0,
    LAST6: 0,
  },
  NATIONAL: WINDOW_WEIGHTS.NATIONAL,
};

/** Metriky, ze kterých se skládá λ – jen ty se pro predikci počítají znovu (vlastní váhy). */
export const PREDICTION_METRICS = ["GOALS_FOR", "GOALS_AGAINST", "XG"] as const;

export const ENTITY_WINDOWS: Record<EntityType, WindowKey[]> = {
  CLUB: ["SEASON", "LAST10", "LAST5"],
  NATIONAL: ["BASE", "LAST12", "LAST6"],
};
