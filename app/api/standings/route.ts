import { NextResponse } from "next/server";
import { getStanding } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";

/**
 * Postavení týmu v ligové tabulce (líně načítaný FREE kontext mimo kritickou cestu
 * porovnání). Veřejná statistika → bez auth gate (jako metriky a souhrn formy).
 * Data v API mohou chybět (jiná soutěž, reprezentace) → při chybě/nedostupnosti vrací
 * `{ standing: null }` (200), aby UI sekci jen skrylo, ne zobrazilo chybu.
 */
export async function GET(req: Request) {
  if (!allowRequest(`standings:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const sp = new URL(req.url).searchParams;
  const teamId = Number(sp.get("team"));
  const leagueId = Number(sp.get("league"));
  if (!Number.isFinite(teamId) || !Number.isFinite(leagueId)) {
    return NextResponse.json({ error: "Chybí tým nebo liga" }, { status: 400 });
  }
  try {
    const standing = await getStanding(teamId, leagueId);
    return NextResponse.json({ standing });
  } catch {
    return NextResponse.json({ standing: null });
  }
}
