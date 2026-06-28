import { NextResponse } from "next/server";
import {
  getUpcomingPredictions,
  getNationalConfedMap,
} from "@/lib/data/repository";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import { filterPicks, ruleSchema } from "@/lib/picks/rules";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";
import type { MatchPick } from "@/lib/types";

/**
 * Doplní reprezentačním tipům (turnaj) konfederaci každého týmu → deep-link do
 * NATIONAL Porovnání. Mapu dotáhne jen když nějaký národní tip existuje (jinak 0
 * práce navíc). Tým bez dohledané konfederace zůstane `null` = neklikací řádek.
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

// Predikční záložka (PRO). Čte PŘEDPOČÍTANÉ predikce z DB a filtruje dle pravidla.
// Nepočítá živě → levné a rychlé. FREE/anonym → { locked: true } (UI ukáže ProLock).

export async function GET(req: Request) {
  if (!allowRequest(`picks:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const user = await getCurrentUser();
  const ent = getEntitlement(
    user ? { tier: user.tier, proTrialUsed: user.proTrialUsed } : null
  );
  if (!ent.pro) return NextResponse.json({ locked: true });

  const sp = new URL(req.url).searchParams;
  const parsed = ruleSchema.safeParse({
    market: sp.get("market") ?? undefined,
    venue: sp.get("venue") ?? undefined,
    minProb: sp.get("minProb") ?? undefined,
    minEdge: sp.get("minEdge") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Neplatné pravidlo" }, { status: 400 });
  }

  try {
    const rows = await getUpcomingPredictions();
    const picks = await enrichNationalLeagues(filterPicks(rows, parsed.data));
    return NextResponse.json({ picks, total: rows.length });
  } catch (e) {
    logError("api/picks", e);
    return NextResponse.json({ error: "Chyba tipů" }, { status: 502 });
  }
}
