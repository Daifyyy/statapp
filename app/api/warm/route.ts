import { NextResponse } from "next/server";
import { warmCatalog, warmLeague } from "@/lib/data/realRepository";
import { isRealDataConfigured } from "@/lib/db";
import { requireCronAuth } from "@/lib/cronAuth";

// Limit funkce (60 s je bezpečné i na Vercel Hobby). Katalogový warm (cron)
// doběhne za pár sekund; těžký warm ligy běž raději lokálně / opakovaně.
export const maxDuration = 60;

/**
 * Předehřeje cache.
 *  - bez parametru (denní cron): jen KATALOG (seznamy týmů, ~24 volání) –
 *    menu je instantní, zápasová data zůstávají líná.
 *  - `?league=ID`: ZÁPASOVÁ DATA všech týmů dané ligy (těžké, na vyžádání).
 * Volitelně chráněno CRON_SECRET (hlavička Authorization: Bearer …); Vercel Cron
 * ji posílá automaticky, je-li CRON_SECRET nastaveno v env. Bez env běží jako dosud
 * (otevřené) – pro ostrý provoz doporučeno secret nastavit (těžký `?league=ID`
 * jinak jde spustit veřejně a vyčerpat kvótu API).
 */
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
  if (leagueParam) {
    const id = Number(leagueParam);
    return NextResponse.json({ warmedTeams: await warmLeague(id) });
  }
  return NextResponse.json({ warmedCatalog: await warmCatalog() });
}
