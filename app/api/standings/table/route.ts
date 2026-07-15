import { NextResponse } from "next/server";
import { getLeagueTable } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";

/**
 * Celá ligová tabulka pro záložku Tabulky (FREE – veřejná statistika, bez auth gate).
 * Sdílí `standings:` cache s Porovnáním/Programem/Hrou → cold liga spustí 1 upstream
 * fetch, proto **rate-limit** (jako `/api/standings`). Reprezentace/nedostupná liga →
 * `{ table: null }` (200), aby UI ukázalo prázdný stav, ne chybu.
 */
export async function GET(req: Request) {
  if (!allowRequest(`standings:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const leagueId = Number(new URL(req.url).searchParams.get("league"));
  if (!Number.isFinite(leagueId)) {
    return NextResponse.json({ error: "Chybí liga" }, { status: 400 });
  }
  try {
    const table = await getLeagueTable(leagueId);
    // Veřejná, pomalu se měnící statistika → CDN cache (5 min) šetří funkci i Neon.
    return NextResponse.json({ table }, { headers: publicCache(300, 600) });
  } catch {
    return NextResponse.json({ table: null });
  }
}
