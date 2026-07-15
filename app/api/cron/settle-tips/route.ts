import { NextResponse } from "next/server";
import { runSettleTips } from "@/lib/data/tips";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";

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
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Neautorizováno" }, { status: 401 });
    }
  }

  try {
    const stats = await runSettleTips();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/settle-tips", e);
    return NextResponse.json({ error: "Settle tipů selhal" }, { status: 502 });
  }
}
