import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/authUser";
import { allowRequest, tooMany } from "@/lib/rateLimit";
import { getGameLeague } from "@/lib/data/repository";
import { GAME_LEAGUES, MOCK_LEAGUE, SECOND_TIER_IDS } from "@/lib/game/leagues";

// Nejvyšší ligy (výběr/job market) + 2. ligy (cíl sestupu/postupu) + mock.
const ALLOWED = new Set<number>([
  ...GAME_LEAGUES.map((l) => l.id),
  ...SECOND_TIER_IDS,
  MOCK_LEAGUE.id,
]);

/**
 * Týmy jedné ligy s herními ratingy (výběr klubu / job market). Na cold cache spouští
 * 1 upstream fetch (ligová tabulka) → rate-limit jako ostatní FREE routy.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (!allowRequest(`gameleague:${user.id}`, 30, 60_000)) return tooMany();

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id) || !ALLOWED.has(id))
    return NextResponse.json({ error: "Neznámá liga" }, { status: 400 });

  try {
    const { teams, leagueAccess } = await getGameLeague(id);
    if (teams.length < 2)
      return NextResponse.json({ error: "Liga zatím nemá data" }, { status: 503 });
    return NextResponse.json({ teams, leagueAccess });
  } catch {
    return NextResponse.json({ error: "Nepodařilo se načíst ligu" }, { status: 502 });
  }
}
