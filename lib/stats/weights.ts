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
};

export const ENTITY_WINDOWS: Record<EntityType, WindowKey[]> = {
  CLUB: ["SEASON", "LAST10", "LAST5"],
  NATIONAL: ["BASE", "LAST12", "LAST6"],
};
