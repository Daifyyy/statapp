import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";
import { allowRequest, tooMany } from "@/lib/rateLimit";

// Oblíbená porovnání – PRO funkce. Drží IDs (re-run) i JSON snapshot (okamžité zobrazení).

/** Max. počet oblíbených na uživatele (brání nafouknutí DB). */
const MAX_FAVORITES = 50;

const saveSchema = z.object({
  mode: z.enum(["CLUB", "NATIONAL"]),
  homeTeamId: z.number().int(),
  homeLeagueId: z.number().int(),
  awayTeamId: z.number().int(),
  awayLeagueId: z.number().int(),
  label: z.string().trim().max(120).optional(),
  // Snapshot je celý CompareResult (uloží se tak, jak přišel z /api/compare).
  snapshot: z.unknown(),
});

/** GET – seznam oblíbených přihlášeného PRO uživatele (nejnovější první). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (user.tier !== "PRO")
    return NextResponse.json({ error: "Jen pro PRO" }, { status: 403 });

  const favorites = await prisma.savedComparison.findMany({
    where: { userId: user.id },
    orderBy: { savedAt: "desc" },
  });
  return NextResponse.json({ favorites });
}

/** POST – uloží/aktualizuje oblíbené (upsert dle dvojice týmů+lig). */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (user.tier !== "PRO")
    return NextResponse.json({ error: "Jen pro PRO" }, { status: 403 });

  if (!allowRequest(`fav:${user.id}`, 30, 60_000)) return tooMany();

  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Neplatná data" }, { status: 400 });
  const d = parsed.data;

  const key = {
    userId: user.id,
    homeTeamId: d.homeTeamId,
    awayTeamId: d.awayTeamId,
    homeLeagueId: d.homeLeagueId,
    awayLeagueId: d.awayLeagueId,
  };

  // Limit počtu: nové uložení zamítni nad strop (úprava existujícího projde).
  const existing = await prisma.savedComparison.findUnique({
    where: { userId_homeTeamId_awayTeamId_homeLeagueId_awayLeagueId: key },
    select: { id: true },
  });
  if (!existing) {
    const count = await prisma.savedComparison.count({ where: { userId: user.id } });
    if (count >= MAX_FAVORITES) {
      return NextResponse.json(
        { error: `Dosažen limit ${MAX_FAVORITES} oblíbených. Nějaké smaž a zkus znovu.` },
        { status: 409 }
      );
    }
  }
  const data = {
    ...key,
    mode: d.mode,
    label: d.label ?? null,
    snapshot: d.snapshot as object,
  };

  const favorite = await prisma.savedComparison.upsert({
    where: {
      userId_homeTeamId_awayTeamId_homeLeagueId_awayLeagueId: key,
    },
    create: data,
    update: { label: data.label, snapshot: data.snapshot, savedAt: new Date() },
  });
  return NextResponse.json({ favorite });
}
