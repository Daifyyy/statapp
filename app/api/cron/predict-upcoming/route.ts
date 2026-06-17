import { NextResponse } from "next/server";
import { runPredictUpcoming, ALL_PREDICTION_LEAGUES } from "@/lib/data/predictions";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";

// Predikce nadcházejících zápasů (denní cron). Warm cache → levné; první studené
// naplnění radši lokálně / přes ?league=ID. Idempotentní (upsert).
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
  const leagueIds = leagueParam ? [Number(leagueParam)] : ALL_PREDICTION_LEAGUES;

  try {
    const stats = await runPredictUpcoming(leagueIds);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/predict-upcoming", e, { leagueIds });
    return NextResponse.json({ error: "Predikce selhala" }, { status: 502 });
  }
}
