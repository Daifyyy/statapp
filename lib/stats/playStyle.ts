import type { EntityType, MetricValue, PlayStyleDimension, Venue } from "@/lib/types";
import { valueOrTotal } from "./metricLookup";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Spočítá jednu hodnotu na fixní škále 0–10 pro danou metriku/výpočet.
 * Pokud data chybí, vrací null.
 */
type ScoreFn = (values: MetricValue[], venue: Venue) => number | null;

const possessionScore: ScoreFn = (values, venue) => {
  const v = valueOrTotal(values, "POSSESSION", venue);
  return v !== null ? clamp((v - 30) / 40, 0, 1) * 10 : null;
};

// Kombinační hra = střely z vápna / (vápno + mimo) → 10 = vše z vápna
const buildupScore: ScoreFn = (values, venue) => {
  const inside = valueOrTotal(values, "SHOTS_INSIDE_BOX", venue);
  if (inside === null) return null;
  // SHOTS_OUTSIDE_BOX občas chybí v API při dostupném SHOTS_INSIDE_BOX — fallback na 0
  // (= tým střílí výhradně z vápna → maximální kombinační skóre)
  const outside = valueOrTotal(values, "SHOTS_OUTSIDE_BOX", venue) ?? 0;
  const total = inside + outside;
  return total > 0 ? (inside / total) * 10 : null;
};

// Pressing = fauly/zápas; rozsah 8–20 → 0–10
const pressingScore: ScoreFn = (values, venue) => {
  const v = valueOrTotal(values, "FOULS", venue);
  return v !== null ? clamp((v - 8) / 12, 0, 1) * 10 : null;
};

// Efektivita = střely na branku / střely celkem
const efficiencyScore: ScoreFn = (values, venue) => {
  const sot = valueOrTotal(values, "SHOTS_ON_TARGET", venue);
  const s = valueOrTotal(values, "SHOTS", venue);
  if (sot === null || s === null || s === 0) return null;
  return clamp(sot / s, 0, 1) * 10;
};

interface DimDef {
  key: PlayStyleDimension["key"];
  label: string;
  leftLabel: string;
  rightLabel: string;
  score: ScoreFn;
  /** Dimenze není k dispozici pro reprezentace (chybí POSSESSION / SHOTS_INSIDE_BOX). */
  unavailableForNational?: boolean;
}

const DIMS: DimDef[] = [
  {
    key: "possession",
    label: "Kontrola míče",
    leftLabel: "Přímá hra",
    rightLabel: "Kontrola",
    score: possessionScore,
    unavailableForNational: true,
  },
  {
    key: "buildup",
    label: "Styl útoku",
    leftLabel: "Nakopávané",
    rightLabel: "Kombinační",
    score: buildupScore,
    unavailableForNational: true,
  },
  {
    key: "pressing",
    label: "Pressing",
    leftLabel: "Pasivní",
    rightLabel: "Vysoký pressing",
    score: pressingScore,
  },
  {
    key: "efficiency",
    label: "Efektivita střel",
    leftLabel: "Nízká",
    rightLabel: "Klinická",
    score: efficiencyScore,
  },
];

/**
 * Spočítá 4 stylové dimenze (0–10) pro oba týmy najednou.
 * Hodnoty jsou absolutní (fixní škála), ne relativní vůči soupeři —
 * aby skóre vyjadřovalo styl týmu nezávisle na konkrétním soupeři.
 * Chybí-li data (reprezentace bez POSSESSION/SHOTS_INSIDE_BOX), dimenze je `available: false`.
 */
export function computePlayStyle(
  homeValues: MetricValue[],
  awayValues: MetricValue[],
  venue: Venue,
  mode: EntityType
): PlayStyleDimension[] {
  const isNational = mode === "NATIONAL";

  return DIMS.map((dim) => {
    if (dim.unavailableForNational && isNational) {
      return {
        key: dim.key,
        label: dim.label,
        leftLabel: dim.leftLabel,
        rightLabel: dim.rightLabel,
        homeScore: 5,
        awayScore: 5,
        available: false,
      };
    }

    const hs = dim.score(homeValues, venue);
    const as_ = dim.score(awayValues, venue);
    const available = hs !== null && as_ !== null;

    return {
      key: dim.key,
      label: dim.label,
      leftLabel: dim.leftLabel,
      rightLabel: dim.rightLabel,
      homeScore: round1(hs ?? 5),
      awayScore: round1(as_ ?? 5),
      available,
    };
  });
}
