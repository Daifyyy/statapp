import { NextResponse } from "next/server";
import { runSettleResults } from "@/lib/data/predictions";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";

// Dotažení skutečných výsledků u odehraných predikcí (denní cron). Levné
// (batch /fixtures?ids=). Doplní goals/status → základ track-recordu a kalibrace.
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
    const stats = await runSettleResults();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/settle-results", e);
    return NextResponse.json({ error: "Settle selhal" }, { status: 502 });
  }
}
