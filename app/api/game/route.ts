import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";
import { allowRequest, tooMany } from "@/lib/rateLimit";
import { SAVE_VERSION } from "@/lib/game/types";

// Uložená hra „Manažer" – vázaná na profil (jeden save na uživatele). Přihlášení
// povinné (anonym → 401). FREE pro každého přihlášeného; žádné PRO gating.

/** Pojistka proti nafouknutí DB (celý SaveState je ~40–80 KB; strop s rezervou). */
const MAX_STATE_BYTES = 512 * 1024;

// Validace tvaru SaveState. Nested objekty necháváme volnější (passthrough) – klient
// je generuje z lib/game, kontrolujeme hlavně verzi, typy polí a rozumné meze.
const teamSchema = z.object({
  id: z.number().int(),
  name: z.string().max(60),
  short: z.string().max(6),
  color: z.string().max(24),
  logo: z.string().max(300).optional(),
  attack: z.number(),
  defense: z.number(),
  homeBoost: z.number(),
});

const seasonSchema = z
  .object({
    season: z.number().int().min(1).max(1000),
    leagueId: z.number().int(),
    leagueName: z.string().max(80),
    seed: z.number().int(),
    teams: z.array(teamSchema).min(2).max(40),
    yourTeamId: z.number().int(),
    schedule: z.array(z.array(z.object({}).passthrough())).max(60),
    results: z.array(z.object({}).passthrough()).max(2000),
    round: z.number().int().min(0).max(60),
    plan: z.enum(["balanced", "open", "low_block", "press", "counter"]),
    morale: z.number(),
    objective: z.object({}).passthrough(),
    modifiers: z.array(z.object({}).passthrough()).max(50),
    pendingEvent: z.object({}).passthrough().nullable(),
  })
  .passthrough();

const saveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  // Trvalý profil (rekordy + achievementy) – loose, ukládáme původní objekt (passthrough).
  profile: z
    .object({
      allTime: z.object({}).passthrough(),
      achievements: z.array(z.object({}).passthrough()).max(200),
    })
    .passthrough(),
  manager: z.object({ reputation: z.number() }).passthrough(),
  // null = bez aktivní kariéry (po resetu / nový uživatel).
  current: seasonSchema.nullable(),
  history: z.array(z.object({}).passthrough()).max(1000),
});

/** GET – načte uloženou hru přihlášeného uživatele (nebo `{ save: null }`). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });

  const row = await prisma.gameSave.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ save: row?.state ?? null });
}

/** PUT – uloží (upsert) rozehranou hru. */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (!allowRequest(`game:${user.id}`, 120, 60_000)) return tooMany();

  const raw = await req.text();
  if (raw.length > MAX_STATE_BYTES)
    return NextResponse.json({ error: "Save je příliš velký" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Neplatný JSON" }, { status: 400 });
  }
  // Validace tvaru/verze; ukládáme PŮVODNÍ objekt (ne parsed.data), aby Zod neořízl
  // pole, která schéma explicitně nevyjmenovává.
  const original = (body as { state?: unknown })?.state ?? body;
  const parsed = saveSchema.safeParse(original);
  if (!parsed.success)
    return NextResponse.json({ error: "Neplatná data hry" }, { status: 400 });

  const state = original as object;
  await prisma.gameSave.upsert({
    where: { userId: user.id },
    create: { userId: user.id, state },
    update: { state },
  });
  return NextResponse.json({ ok: true });
}

/** DELETE – „Začít znovu": smaže uloženou hru. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  await prisma.gameSave.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
