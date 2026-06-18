import type { Injury } from "@/lib/types";
import type { ApiInjury } from "./apiFootball";

/**
 * Maximální stáří záznamu o zranění, který ještě bereme jako „aktuální".
 *
 * API-Football `/injuries?team&season` vrací zranění napříč **celou sezónou** (bez vazby
 * na konkrétní zápas/datum), takže by jinak ve výpisu zůstal i hráč zraněný v dřívějším
 * zápase, který se mezitím uzdravil a nastoupil. To je nejvíc vidět u reprezentací –
 * řídký kalendář (zápasy měsíce od sebe) → „nejnovější" záznam může být starý týdny.
 * Filtrujeme proto na naší straně (API filtr podle stáří neumí).
 */
export const INJURY_MAX_AGE_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Vybere aktuálně relevantní zranění z hrubé odpovědi API.
 * - Zahodí záznamy bez `fixture.date` (nelze ověřit aktuálnost → raději neukázat).
 * - Zahodí záznamy starší než {@link INJURY_MAX_AGE_DAYS} (uzdravené/neaktuální).
 * - Dedup dle hráče: ponechá nejnovější záznam (ten je ten aktuální).
 * Čistá funkce (kvůli testu) – `now` injektovatelné.
 */
export function selectCurrentInjuries(
  raw: ApiInjury[],
  now: Date = new Date()
): Injury[] {
  const minMs = now.getTime() - INJURY_MAX_AGE_DAYS * DAY_MS;

  const fresh = raw
    .map((it) => {
      const ts = it.fixture?.date ? Date.parse(it.fixture.date) : NaN;
      return { it, ts };
    })
    .filter(({ ts }) => Number.isFinite(ts) && ts >= minMs)
    // Nejnovější první → první výskyt hráče je ten aktuální.
    .sort((a, b) => b.ts - a.ts);

  const seen = new Set<number>();
  const out: Injury[] = [];
  for (const { it } of fresh) {
    if (seen.has(it.player.id)) continue;
    seen.add(it.player.id);
    out.push({
      playerId: it.player.id,
      name: it.player.name,
      reason: it.reason || it.type || "Zranění",
    });
  }
  return out;
}
