import { NextResponse } from "next/server";
import { runSnapshotOdds } from "@/lib/data/predictions";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";
import { requireCronAuth } from "@/lib/cronAuth";

// Snímky kurzů pro CLV: otevírací, zavírací a body ČASOVÉ ŘADY. Běží **hodinově**,
// na rozdíl od ostatních cronů – a je to nutnost, ne ladění:
//
// Predikční cron jede 1×/den ve 04:30 UTC. Zavírací okno je 3 h před výkopem, takže
// večerní zápas (21:45 SELČ = 19:45 UTC) je v 04:30 daleko mimo okno a další běh by
// přišel až po výkopu. Zavírací snímek by tedy dostávaly jen zápasy s výkopem dopoledne
// a CLV by se počítalo z vychýlené menšiny.
//
// Otevírací a zavírací snímek zůstávají **jeden za život** (guard v DB). Navíc přibývá
// časová řada s kadencí, která se zužuje k výkopu (12 h → 3 h → 1 h) – ta stojí ~340
// volání/den a je to jediná položka, která proti dřívějšku kvótu zdražila. Výběr zápasů
// je čistě DB dotaz; co se s nimi stane, rozhoduje čistá `snapshotPlan`.
//
// 60 s = strop Vercel Hobby plánu (vyšší hodnota se ignoruje). Proto je i default
// `SNAPSHOT_LIMIT` malý – radši víc krátkých běhů než jeden zabitý timeoutem.
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

  // `?limit=` jen pro ruční doplnění po výpadku; default drží běh krátký.
  const limitParam = new URL(req.url).searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  try {
    const stats = await runSnapshotOdds(
      Number.isFinite(limit) && limit! > 0 ? limit : undefined
    );
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/snapshot-odds", e);
    return NextResponse.json({ error: "Snímek kurzů selhal" }, { status: 502 });
  }
}
