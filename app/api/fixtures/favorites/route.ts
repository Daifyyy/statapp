import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import { allowRequest, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";
import {
  getFavorites,
  toggleFavoriteFixture,
  toggleFavoriteLeague,
} from "@/lib/data/favoritesStore";

// Oblíbené zápasy a ligy (PRO). Řídí primární sekci „⭐ Oblíbené" a filtr „Jen oblíbené"
// v Programu Zápasů. Anon → 401; FREE → { locked:true } (GET) / 403 (POST). Vlastní data
// per uživatel, žádné statistiky → PRO gate (jako /api/picks).

const postSchema = z.object({
  type: z.enum(["fixture", "league"]),
  id: z.number().int().positive(),
  on: z.boolean(),
});

/** GET – IDs oblíbených zápasů a lig. Anon/FREE → { locked:true } + prázdné sety. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ locked: true, fixtures: [], leagues: [] });
  if (!allowRequest(`fav:${user.id}`, 60, 60_000)) return tooMany();
  const ent = getEntitlement({ tier: user.tier, proTrialUsed: user.proTrialUsed });
  if (!ent.pro) {
    return NextResponse.json({ locked: true, fixtures: [], leagues: [] });
  }
  try {
    const favs = await getFavorites(user.email ?? `user:${user.id}`);
    return NextResponse.json(favs);
  } catch (e) {
    logError("api/fixtures/favorites GET", e);
    return NextResponse.json({ fixtures: [], leagues: [] }, { status: 502 });
  }
}

/** POST – toggle oblíbeného zápasu/ligy. Anon → 401, FREE → 403. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (!allowRequest(`fav:${user.id}`, 60, 60_000)) return tooMany();
  const ent = getEntitlement({ tier: user.tier, proTrialUsed: user.proTrialUsed });
  if (!ent.pro) {
    return NextResponse.json({ error: "Jen pro PRO" }, { status: 403 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Neplatná data" }, { status: 400 });
  }
  const { type, id, on } = parsed.data;
  const owner = user.email ?? `user:${user.id}`;

  try {
    if (type === "fixture") await toggleFavoriteFixture(owner, user.id, id, on);
    else await toggleFavoriteLeague(owner, user.id, id, on);
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("api/fixtures/favorites POST", e);
    return NextResponse.json({ error: "Uložení selhalo" }, { status: 502 });
  }
}
