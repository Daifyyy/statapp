import { NextResponse } from "next/server";
import { getLeagueRound } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";

/**
 * Poslední odehrané + nejbližší nadcházející kolo vybrané ligy (záložka Tabulky, FREE –
 * veřejná statistika, bez auth gate). Samostatná routa (ne rozšíření `/api/standings/table`),
 * aby se neovlivnila latence/chybovost stávajících konzumentů tabulky (Porovnání, Hra).
 * Sdílí rate-limit vzor s `/api/standings`; reprezentace/nedostupná liga → `{ round: null }`.
 */
export async function GET(req: Request) {
  if (!allowRequest(`standings:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const leagueId = Number(new URL(req.url).searchParams.get("league"));
  if (!Number.isFinite(leagueId)) {
    return NextResponse.json({ error: "Chybí liga" }, { status: 400 });
  }
  try {
    const round = await getLeagueRound(leagueId);
    return NextResponse.json({ round }, { headers: publicCache(300, 600) });
  } catch {
    return NextResponse.json({ round: null });
  }
}
