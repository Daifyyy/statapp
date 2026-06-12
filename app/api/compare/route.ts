import { NextResponse } from "next/server";
import { getCompareTeam } from "@/lib/data/repository";
import { compareTeams } from "@/lib/stats/compare";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const homeId = Number(sp.get("home"));
  const awayId = Number(sp.get("away"));
  const homeLeague = Number(sp.get("homeLeague"));
  const awayLeague = Number(sp.get("awayLeague"));

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
    return NextResponse.json(compareTeams(home, away));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Chyba porovnání" },
      { status: 502 }
    );
  }
}
