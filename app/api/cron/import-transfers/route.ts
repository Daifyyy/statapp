import { NextResponse } from "next/server";
import { importTransfersFromDataset } from "@/lib/data/transfersDataset";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";

// Import přestupů z Transfermarkt datasetu (ceny). Dataset je aktualizovaný týdně →
// stačí běžet 1×/den. Stáhne ~pár MB, vybere aktuální okno + top-5 kluby, nahradí tabulku.
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
    const stats = await importTransfersFromDataset();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e) {
    logError("cron/import-transfers", e);
    return NextResponse.json({ error: "Import přestupů selhal" }, { status: 502 });
  }
}
