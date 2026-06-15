// Tiering / gating na hranici route. Čistá funkce – žádné DB ani síťové volání.
// PRO funkce = predikce, insights, zranění, oblíbené. FREE = metriky + forma + sdílení.
// Navíc 1× „trial": přihlášený FREE uživatel může jednou odemknout plnou PRO verzi.

import type { CompareResult } from "./types";

/** Úroveň účtu (zrcadlí Prisma enum `Tier`). */
export type Tier = "FREE" | "PRO";

/** Minimální pohled na uživatele potřebný pro rozhodnutí o oprávnění. */
export interface EntitlementUser {
  tier: Tier;
  proTrialUsed: boolean;
}

export interface Entitlement {
  /** Má uživatel přístup k PRO obsahu tohoto porovnání? */
  pro: boolean;
  /** Má se po tomto požadavku spotřebovat trial (nastavit proTrialUsed=true)? */
  consumeTrial: boolean;
}

/**
 * Always-PRO allowlist přes env `PRO_EMAILS` (čárkami oddělené e-maily).
 * Použito v session callbacku (`auth.ts`) – účet z allowlistu je PRO bez ohledu
 * na DB tier (přežije reset DB i nové přihlášení). Server-side (čte process.env).
 */
export function isProEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.PRO_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Rozhodne o přístupu k PRO obsahu.
 * - PRO tier → vždy plný přístup.
 * - FREE + žádost o trial (`unlockTrial`) + dosud nevyužitý trial → plný přístup, spotřebuj trial.
 * - jinak → jen FREE obsah.
 * Anonym (user == null) nemá trial (musí se přihlásit) → vždy FREE.
 */
export function getEntitlement(
  user: EntitlementUser | null | undefined,
  opts: { unlockTrial?: boolean } = {}
): Entitlement {
  if (user?.tier === "PRO") return { pro: true, consumeTrial: false };
  if (opts.unlockTrial && user && !user.proTrialUsed) {
    return { pro: true, consumeTrial: true };
  }
  return { pro: false, consumeTrial: false };
}

/**
 * Ořeže plný `CompareResult` na FREE variantu: vypustí predikci a insights
 * (i per-tým výroky a zranění čte UI jinde) a označí `locked`. Metriky a forma
 * (v `home/away`) zůstávají. Jádro `compareTeams` se nemění – ořez je až tady.
 */
export function toFreeResult(full: CompareResult): CompareResult {
  return {
    source: full.source,
    sourceNote: full.sourceNote,
    metrics: full.metrics,
    home: full.home,
    away: full.away,
    locked: true,
  };
}
