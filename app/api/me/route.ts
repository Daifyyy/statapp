import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/authUser";
import type { SessionUser } from "@/app/_components/sessionUser";

/**
 * Přihlášený uživatel pro klienta (statická domovská stránka ho nemůže načíst při SSR,
 * viz `app/page.tsx`). Per-uživatel → **necachovat** (`private, no-store`). Anon → null.
 */
export async function GET() {
  const u = await getCurrentUser();
  const user: SessionUser | null = u
    ? { id: u.id, name: u.name, image: u.image, tier: u.tier, proTrialUsed: u.proTrialUsed }
    : null;
  return NextResponse.json(
    { user },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
