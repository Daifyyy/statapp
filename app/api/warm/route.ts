import { NextResponse } from "next/server";
import { warmCatalog, warmLeague } from "@/lib/data/realRepository";
import { isRealDataConfigured } from "@/lib/db";

// Limit funkce (60 s je bezpečné i na Vercel Hobby). Katalogový warm (cron)
// doběhne za pár sekund; těžký warm ligy běž raději lokálně / opakovaně.
export const maxDuration = 60;

/**
 * Předehřeje cache.
 *  - bez parametru (denní cron): jen KATALOG (seznamy týmů, ~24 volání) –
 *    menu je instantní, zápasová data zůstávají líná.
 *  - `?league=ID`: ZÁPASOVÁ DATA všech týmů dané ligy (těžké, na vyžádání).
 * Volitelně chráněno CRON_SECRET (hlavička Authorization: Bearer …); Vercel Cron
 * ji posílá automaticky, je-li CRON_SECRET nastaveno v env.
 */
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
  if (leagueParam) {
    const id = Number(leagueParam);
    return NextResponse.json({ warmedTeams: await warmLeague(id) });
  }
  return NextResponse.json({ warmedCatalog: await warmCatalog() });
}
