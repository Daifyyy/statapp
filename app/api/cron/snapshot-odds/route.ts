import { NextResponse } from "next/server";
import { runSnapshotOdds } from "@/lib/data/predictions";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";
import { requireCronAuth } from "@/lib/cronAuth";

// Snímky kurzů (otevírací + zavírací) pro CLV. Běží **každé 3 h**, na rozdíl od
// ostatních cronů – a je to nutnost, ne ladění:
//
// Predikční cron jede 1×/den ve 04:30 UTC. Zavírací okno je 12 h před výkopem, takže
// večerní zápas (21:45 SELČ = 19:45 UTC) je v 04:30 ještě 15 h daleko → mimo okno,
// a další běh přijde až po výkopu. Zavírací snímek by tedy dostávaly **jen zápasy
// s výkopem mezi 04:30 a 16:30 UTC** a CLV by se počítalo z vychýlené menšiny.
//
// Kvótu to nezdraží: každý zápas dostane nejvýš dva snímky za život (guard v DB),
// častější běh jen mění, KDY se ta dvě volání provedou. Výběr zápasů je čistě DB dotaz.
export const maxDuration = 120;

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
