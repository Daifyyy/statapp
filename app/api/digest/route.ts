import { NextResponse } from "next/server";
import {
  getUpcomingPredictions,
  getNationalConfedMap,
  stampPickRanks,
} from "@/lib/data/repository";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import { buildDigest } from "@/lib/picks/digest";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";
import type { MatchPick } from "@/lib/types";

/**
 * Doplní reprezentačním tipům konfederaci každého týmu pro deep-link do NATIONAL
 * Porovnání (mapu dotáhne jen když nějaký národní tip existuje). Stejná logika jako
 * `/api/picks` – tým bez dohledané konfederace zůstane `null` = neklikací řádek.
 */
async function enrichNationalLeagues(picks: MatchPick[]): Promise<MatchPick[]> {
  if (!picks.some((p) => p.compareMode === "NATIONAL")) return picks;
  const confed = await getNationalConfedMap();
  return picks.map((p) =>
    p.compareMode === "NATIONAL"
      ? {
          ...p,
          homeCompareLeagueId: confed.get(p.home.id) ?? null,
          awayCompareLeagueId: confed.get(p.away.id) ?? null,
        }
      : p
  );
}

// Týdenní digest = top value tipy nejbližších dní (PRO). Čte PŘEDPOČÍTANÉ predikce z DB
// (vč. kurzů z pipeline) a vybere nejvyšší edge napříč trhy. Nepočítá živě → levné.
// FREE/anonym → { locked: true } (UI ukáže ProLock).
export async function GET(req: Request) {
  if (!allowRequest(`digest:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const user = await getCurrentUser();
  const ent = getEntitlement(
    user ? { tier: user.tier, proTrialUsed: user.proTrialUsed } : null
  );
  if (!ent.pro) return NextResponse.json({ locked: true });

  try {
    const rows = await getUpcomingPredictions();
    const picks = await stampPickRanks(
      await enrichNationalLeagues(buildDigest(rows))
    );
    return NextResponse.json({ picks });
  } catch (e) {
    logError("api/digest", e);
    return NextResponse.json({ error: "Chyba digestu" }, { status: 502 });
  }
}
