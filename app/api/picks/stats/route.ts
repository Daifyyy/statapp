import { NextResponse } from "next/server";
import { getSettledPredictionRows } from "@/lib/data/repository";
import {
  backtestRule,
  computeBenchmarkTrackRecord,
  computeTrackRecord,
} from "@/lib/picks/trackRecord";
import { computeMarketBenchmark } from "@/lib/picks/market";
import { computeReliability } from "@/lib/picks/reliability";
import { clvSideOf, summarizeClv } from "@/lib/picks/clv";
import { evaluateRule, ruleSchema } from "@/lib/picks/rules";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";
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
    // CLV navoleného pravidla: posunula se linie od našeho snímku k zavření směrem k nám?
    // Počítá se jen z řádků se DVĚMA snímky kurzu (od 26. 7. 2026), takže je zpočátku prázdné.
    const clvPicks = rows.flatMap((row) => {
      const m = evaluateRule(row, parsed.data);
      if (!m.ok) return [];
      const side = clvSideOf(parsed.data.market, m.side);
      return side ? [{ row, side }] : [];
    });
    return NextResponse.json(
      {
        trackRecord: computeTrackRecord(rows),
        benchmark: computeBenchmarkTrackRecord(rows),
        market: computeMarketBenchmark(rows),
        backtest: backtestRule(rows, parsed.data),
        reliability: computeReliability(rows),
        clv: summarizeClv(clvPicks),
      },
      // Odpověď **nezávisí na uživateli** (jen na pravidle v query) a vstupní data se
      // mění dvakrát denně se `settle-results`. Přitom to byl nejtěžší opakovaný dotaz
      // do Neonu v celé appce a jel bez jediné cache hlavičky – každé hnutí posuvníkem
      // znamenalo nové čtení všech vypořádaných řádků.
      { headers: publicCache(300, 900) }
    );
  } catch (e) {
    logError("api/picks/stats", e);
    return NextResponse.json({ error: "Chyba statistik" }, { status: 502 });
  }
}
