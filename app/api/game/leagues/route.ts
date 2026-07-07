import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/authUser";
import { isRealDataConfigured } from "@/lib/db";
import { allowRequest, tooMany } from "@/lib/rateLimit";
import { GAME_LEAGUES, MOCK_LEAGUE } from "@/lib/game/leagues";

/** Nabízené ligy pro hru „Manažer" (reálné z katalogu; v mocku fiktivní liga). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (!allowRequest(`gameleagues:${user.id}`, 60, 60_000)) return tooMany();

  const leagues = isRealDataConfigured()
    ? GAME_LEAGUES.map((l) => ({ id: l.id, name: l.name, country: l.country }))
    : [{ id: MOCK_LEAGUE.id, name: MOCK_LEAGUE.name, country: MOCK_LEAGUE.country }];
  return NextResponse.json({ leagues });
}
