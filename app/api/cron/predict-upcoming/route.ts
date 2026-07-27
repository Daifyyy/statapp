import { NextResponse } from "next/server";
import { runPredictUpcoming } from "@/lib/data/predictions";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";
import { requireCronAuth } from "@/lib/cronAuth";

// Predikce nadcházejících zápasů (denní cron). Warm cache → levné; první studené
// naplnění radši lokálně / přes ?league=ID. Idempotentní (upsert).
//
// `maxDuration` musí být VĚTŠÍ než rozpočet `runPredictUpcoming` (4 min), aby se běh
// ukončil sám a stihl vrátit statistiku – zabití platformou po limitu je tichá ztráta
// informace o tom, kam se pipeline dostala. Soutěže se navíc denně rotují, takže i běh,
// který nestihne všechny, pokryje zbytek další dny.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isRealDataConfigured()) {
    return NextResponse.json(
      { error: "Reálná data nejsou nakonfigurována (mock režim)" },
      { status: 400 }
    );
  }
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const leagueParam = new URL(req.url).searchParams.get("league");
  // Bez parametru = celý (rotovaný) seznam soutěží; s parametrem jen ta jedna.
  const leagueIds = leagueParam ? [Number(leagueParam)] : undefined;

  try {
    const stats = await runPredictUpcoming(leagueIds);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/predict-upcoming", e, { leagueIds });
    return NextResponse.json({ error: "Predikce selhala" }, { status: 502 });
  }
}
