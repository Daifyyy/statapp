import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/authUser";
import { isRealDataConfigured } from "@/lib/db";
import { allowRequest, tooMany } from "@/lib/rateLimit";
import { GAME_LEAGUES, MOCK_LEAGUE, SECOND_TIERS } from "@/lib/game/leagues";

/**
 * Nabízené ligy pro hru „Manažer" (reálné z katalogu; v mocku fiktivní liga).
 * Vrací i **2. ligy** (`tier: 2`) – kluby v nich mají nízkou prestiž, takže projdou
 * `isHireable` na startovní reputaci a dávají kariéru „zdola nahoru". Dřív byly
 * dosažitelné jen sestupem, i když je `/api/game/league` v allowlistu měl.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (!allowRequest(`gameleagues:${user.id}`, 60, 60_000)) return tooMany();

  const leagues = isRealDataConfigured()
    ? [
        ...GAME_LEAGUES.map((l) => ({ id: l.id, name: l.name, country: l.country, tier: 1 })),
        ...SECOND_TIERS.map((l) => ({ id: l.id, name: l.name, country: l.country, tier: 2 })),
      ]
    : [{ id: MOCK_LEAGUE.id, name: MOCK_LEAGUE.name, country: MOCK_LEAGUE.country, tier: 1 }];
  return NextResponse.json({ leagues });
}
