import { NextResponse } from "next/server";
import { runSettleTips } from "@/lib/data/tips";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";
import { requireCronAuth } from "@/lib/cronAuth";

// Dotažení výsledků u osobních tipů (denní cron). Levné (batch /fixtures?ids=,
// jeden zápas pokryje víc tipů). Doplní skóre/hit → základ úspěšnosti a ROI.
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isRealDataConfigured()) {
    return NextResponse.json(
      { error: "Reálná data nejsou nakonfigurována (mock režim)" },
      { status: 400 }
    );
  }
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const stats = await runSettleTips();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/settle-tips", e);
    return NextResponse.json({ error: "Settle tipů selhal" }, { status: 502 });
  }
}
