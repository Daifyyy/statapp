import { NextResponse } from "next/server";
import { getTopScorers } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";

/**
 * Nejlepší střelci ligy patřící k týmu (líně načítaný FREE kontext v Porovnání).
 * Veřejná statistika → bez auth gate (jako standings / souhrn formy). Data mohou chybět
 * (reprezentace, mimo sezónu) → při chybě/nedostupnosti vrací `{ scorers: [] }` (200),
 * aby UI sekci jen skrylo, ne zobrazilo chybu.
 */
export async function GET(req: Request) {
  if (!allowRequest(`scorers:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const sp = new URL(req.url).searchParams;
  const teamId = Number(sp.get("team"));
  const leagueId = Number(sp.get("league"));
  if (!Number.isFinite(teamId) || !Number.isFinite(leagueId)) {
    return NextResponse.json({ error: "Chybí tým nebo liga" }, { status: 400 });
  }
  try {
    const scorers = await getTopScorers(teamId, leagueId);
    return NextResponse.json({ scorers }, { headers: publicCache(600, 1200) });
  } catch {
    return NextResponse.json({ scorers: [] });
  }
}
