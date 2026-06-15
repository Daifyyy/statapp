import { NextResponse } from "next/server";
import { getSettledPredictionRows } from "@/lib/data/repository";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import { computeTrackRecord } from "@/lib/picks/trackRecord";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

// Track-record modelu (PRO) – úspěšnost z odehraných predikcí.
export async function GET(req: Request) {
  if (!allowRequest(`picks-stats:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const user = await getCurrentUser();
  const ent = getEntitlement(
    user ? { tier: user.tier, proTrialUsed: user.proTrialUsed } : null
  );
  if (!ent.pro) return NextResponse.json({ locked: true });

  try {
    const rows = await getSettledPredictionRows();
    return NextResponse.json({ trackRecord: computeTrackRecord(rows) });
  } catch (e) {
    logError("api/picks/stats", e);
    return NextResponse.json({ error: "Chyba statistik" }, { status: 502 });
  }
}
