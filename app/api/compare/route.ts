import { NextResponse } from "next/server";
import { getCompareTeam } from "@/lib/data/repository";
import { compareTeams } from "@/lib/stats/compare";
import { getCurrentUser } from "@/lib/authUser";
import { prisma } from "@/lib/db";
import { getEntitlement, toFreeResult } from "@/lib/entitlements";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

export async function GET(req: Request) {
  // Anti-spam: velkorysý strop na klienta (porovnání je drahé, stahuje data).
  if (!allowRequest(`compare:${clientKey(req)}`, 30, 60_000)) return tooMany();

  const sp = new URL(req.url).searchParams;
  const homeId = Number(sp.get("home"));
  const awayId = Number(sp.get("away"));
  const homeLeague = Number(sp.get("homeLeague"));
  const awayLeague = Number(sp.get("awayLeague"));
  const unlockTrial = sp.get("unlock") === "1";

  if (
    !Number.isFinite(homeId) ||
    !Number.isFinite(awayId) ||
    !Number.isFinite(homeLeague) ||
    !Number.isFinite(awayLeague)
  ) {
    return NextResponse.json({ error: "Chybí týmy nebo ligy" }, { status: 400 });
  }
  if (homeId === awayId) {
    return NextResponse.json({ error: "Vyber dva různé týmy" }, { status: 400 });
  }

  // Evropské poháry potřebujeme jen u týmů z různých lig (cross-league).
  const includeEuro = homeLeague !== awayLeague;

  try {
    const [home, away] = await Promise.all([
      getCompareTeam(homeId, homeLeague, includeEuro),
      getCompareTeam(awayId, awayLeague, includeEuro),
    ]);
    if (!home || !away) {
      return NextResponse.json({ error: "Tým nenalezen" }, { status: 404 });
    }
    if (home.entityType !== away.entityType) {
      return NextResponse.json(
        { error: "Nelze porovnat klub s reprezentací" },
        { status: 400 }
      );
    }

    // Jádro je vždy stejné; PRO obsah ořežeme až tady (gating na hranici route).
    const full = compareTeams(home, away);

    const u = await getCurrentUser();
    const ent = getEntitlement(
      u ? { tier: u.tier, proTrialUsed: u.proTrialUsed } : null,
      { unlockTrial }
    );
    if (!ent.pro) {
      return NextResponse.json(toFreeResult(full));
    }
    if (ent.consumeTrial && u) {
      // Spotřebuj 1× trial (best-effort; selhání nezablokuje zobrazení).
      await prisma.user
        .update({ where: { id: u.id }, data: { proTrialUsed: true } })
        .catch(() => {});
    }
    return NextResponse.json(full);
  } catch (e) {
    // Detail jen do logu; klientovi generická hláška (žádný leak interních dat).
    logError("api/compare", e, { homeId, awayId, homeLeague, awayLeague });
    return NextResponse.json({ error: "Chyba porovnání" }, { status: 502 });
  }
}
