import { NextResponse } from "next/server";
import { getLeagueAssists, getLeagueScorers } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";

/**
 * Nejlepší střelci + nahrávači CELÉ ligy (záložka Tabulky, FREE – veřejná statistika,
 * bez auth gate). Střelci sdílí `topscorers:` cache s Porovnáním (0 API navíc, když je
 * liga zahřátá); nahrávači jsou nový endpoint (`/players/topassists`).
 * **Vlastní rate-limit bucket** ze stejného důvodu jako `/api/standings/round`.
 */
export async function GET(req: Request) {
  if (!allowRequest(`standings-scorers:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const leagueId = Number(new URL(req.url).searchParams.get("league"));
  if (!Number.isFinite(leagueId)) {
    return NextResponse.json({ error: "Chybí liga" }, { status: 400 });
  }
  try {
    const [scorers, assists] = await Promise.all([
      getLeagueScorers(leagueId),
      getLeagueAssists(leagueId),
    ]);
    // Stejná data i TTL jako `/api/scorers` (12 h upstream) → stejné CDN okno.
    return NextResponse.json({ scorers, assists }, { headers: publicCache(600, 1200) });
  } catch {
    return NextResponse.json({ scorers: [], assists: [] });
  }
}
