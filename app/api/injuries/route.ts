import { NextResponse } from "next/server";
import { getInjuries } from "@/lib/data/repository";

/**
 * Zranění týmu (líně načítané UI mimo kritickou cestu porovnání). Data v API jsou
 * nekonzistentní → při chybě/nedostupnosti vrací prázdný seznam (200), aby UI sekci
 * jen skrylo, ne zobrazilo chybu.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const teamId = Number(sp.get("team"));
  const leagueId = Number(sp.get("league"));
  if (!Number.isFinite(teamId) || !Number.isFinite(leagueId)) {
    return NextResponse.json({ error: "Chybí tým nebo liga" }, { status: 400 });
  }
  try {
    const injuries = await getInjuries(teamId, leagueId);
    return NextResponse.json({ injuries });
  } catch {
    return NextResponse.json({ injuries: [] });
  }
}
