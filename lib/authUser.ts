// Bezpečné načtení přihlášeného uživatele na serveru. Když auth není nakonfigurovaná
// (chybí AUTH_SECRET) nebo selže, vrací null → aplikace běží dál jako anonym (FREE).
// Tím se gating nikdy nestane tvrdou závislostí pro základní (FREE) tok.

import { auth } from "@/auth";
import type { Tier } from "./entitlements";

export interface CurrentUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  tier: Tier;
  proTrialUsed: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!process.env.AUTH_SECRET) return null;
  try {
    const session = await auth();
    const u = session?.user;
    if (!u?.id) return null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      tier: u.tier,
      proTrialUsed: u.proTrialUsed,
    };
  } catch {
    return null;
  }
}
