import { NextResponse } from "next/server";
import { runRefreshTransfers, TRANSFER_LEAGUES } from "@/lib/data/transfers";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";

// Přestupy top-5 lig (denní cron). /transfers neumí filtr podle ligy → iteruje přes
// všechny týmy (~100 volání), proto jen na pozadí. Studené naplnění radši přes ?league=ID.
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

  const leagueParam = new URL(req.url).searchParams.get("league");
  const leagueIds = leagueParam ? [Number(leagueParam)] : TRANSFER_LEAGUES;

  try {
    const stats = await runRefreshTransfers(leagueIds);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/refresh-transfers", e, { leagueIds });
    return NextResponse.json({ error: "Přestupy selhaly" }, { status: 502 });
  }
}
