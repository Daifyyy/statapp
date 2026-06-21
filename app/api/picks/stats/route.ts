import { NextResponse } from "next/server";
import { getSettledPredictionRows } from "@/lib/data/repository";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import {
  backtestRule,
  computeBenchmarkTrackRecord,
  computeTrackRecord,
} from "@/lib/picks/trackRecord";
import { ruleSchema } from "@/lib/picks/rules";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

// Track-record modelu + backtest strategie (PRO) z odehraných predikcí.
// `trackRecord` je globální (parametry ho nemění); `backtest` aplikuje navolené
// pravidlo na historii (úspěšnost „kdybys takhle sázel"). Čte jen z DB, nepočítá živě.
export async function GET(req: Request) {
  if (!allowRequest(`picks-stats:${clientKey(req)}`, 60, 60_000)) return tooMany();

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
    const rows = await getSettledPredictionRows();
    return NextResponse.json({
      trackRecord: computeTrackRecord(rows),
      benchmark: computeBenchmarkTrackRecord(rows),
      backtest: backtestRule(rows, parsed.data),
    });
  } catch (e) {
    logError("api/picks/stats", e);
    return NextResponse.json({ error: "Chyba statistik" }, { status: 502 });
  }
}
