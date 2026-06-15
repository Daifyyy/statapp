import { NextResponse } from "next/server";
import { getTeamsByLeague } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

export const revalidate = 86400;

export async function GET(req: Request) {
  if (!allowRequest(`teams:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const leagueId = Number(new URL(req.url).searchParams.get("league"));
  if (!Number.isFinite(leagueId) || leagueId <= 0) {
    return NextResponse.json({ error: "Neplatná liga" }, { status: 400 });
  }
  try {
    const teams = await getTeamsByLeague(leagueId);
    return NextResponse.json({ teams });
  } catch (e) {
    logError("api/teams", e, { leagueId });
    return NextResponse.json({ error: "Chyba načtení týmů" }, { status: 502 });
  }
}
