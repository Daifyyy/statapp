import { NextResponse } from "next/server";
import { getSettledPredictionRows } from "@/lib/data/repository";
import {
  backtestRule,
  computeBenchmarkTrackRecord,
  computeTrackRecord,
} from "@/lib/picks/trackRecord";
import { computeMarketBenchmark } from "@/lib/picks/market";
import { computeReliability } from "@/lib/picks/reliability";
import { ruleSchema } from "@/lib/picks/rules";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

// Track-record modelu + benchmark + backtest strategie z odehraných predikcí.
// **FREE** (agregátní/historické metriky nic konkrétního neprozrazují a budují
// důvěru – marketingový hák). PRO zůstává jen seznam nadcházejících tipů (/api/picks).
// `trackRecord` je globální (parametry ho nemění); `backtest` aplikuje navolené
// pravidlo na historii (úspěšnost „kdybys takhle sázel"). Čte jen z DB, nepočítá živě.
export async function GET(req: Request) {
  if (!allowRequest(`picks-stats:${clientKey(req)}`, 60, 60_000)) return tooMany();

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
    const rows = await getSettledPredictionRows();
    return NextResponse.json({
      trackRecord: computeTrackRecord(rows),
      benchmark: computeBenchmarkTrackRecord(rows),
      market: computeMarketBenchmark(rows),
      backtest: backtestRule(rows, parsed.data),
      reliability: computeReliability(rows),
    });
  } catch (e) {
    logError("api/picks/stats", e);
    return NextResponse.json({ error: "Chyba statistik" }, { status: 502 });
  }
}
