import { NextResponse } from "next/server";
import { z } from "zod";
import { getUpcomingPredictions } from "@/lib/data/repository";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import { filterPicks } from "@/lib/picks/rules";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

// Predikční záložka (PRO). Čte PŘEDPOČÍTANÉ predikce z DB a filtruje dle pravidla.
// Nepočítá živě → levné a rychlé. FREE/anonym → { locked: true } (UI ukáže ProLock).

const ruleSchema = z.object({
  market: z.enum(["win", "over25", "btts"]).default("win"),
  venue: z.enum(["home", "away", "any"]).default("home"),
  minProb: z.coerce.number().min(0).max(1).default(0.65),
});

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
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Neplatné pravidlo" }, { status: 400 });
  }

  try {
    const rows = await getUpcomingPredictions();
    const picks = filterPicks(rows, parsed.data);
    return NextResponse.json({ picks, total: rows.length });
  } catch (e) {
    logError("api/picks", e);
    return NextResponse.json({ error: "Chyba tipů" }, { status: 502 });
  }
}
