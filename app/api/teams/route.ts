import { NextResponse } from "next/server";
import { getTeamsByLeague } from "@/lib/data/repository";

export const revalidate = 86400;

export async function GET(req: Request) {
  const leagueId = Number(new URL(req.url).searchParams.get("league"));
  if (!Number.isFinite(leagueId)) {
    return NextResponse.json({ error: "Neplatná liga" }, { status: 400 });
  }
  try {
    const teams = await getTeamsByLeague(leagueId);
    return NextResponse.json({ teams });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chyba načtení týmů" },
      { status: 502 }
    );
  }
}
