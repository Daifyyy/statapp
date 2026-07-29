// Bezpečné načtení přihlášeného uživatele na serveru. Když auth není nakonfigurovaná
// (chybí AUTH_SECRET) nebo selže, vrací null → aplikace běží dál jako anonym (FREE).
// Tím se gating nikdy nestane tvrdou závislostí pro základní (FREE) tok.

import { auth } from "@/auth";
import { isFrameworkSignal, logError } from "./logError";
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
  } catch (e) {
    // `auth()` čte `headers()`, takže při pokusu o statický render sem přiletí
    // DynamicServerError – to je ŘÍDICÍ TOK Next.js, ne selhání. Musí projít dál,
    // jinak se rozbije mechanismus, který stránku překlápí na dynamickou (a build
    // by logoval stack z každé takové routy).
    if (isFrameworkSignal(e)) throw e;
    // Degradace na anonyma je ZÁMĚRNÁ (FREE tok nesmí padat na auth), ale je to
    // nejzákeřnější tichý stav v celé appce: při výpadku session lookupu se KAŽDÝ
    // platící uživatel tiše přepne na FREE a vypadá to jako „odhlásil se".
    logError("authUser.getCurrentUser", e);
    return null;
  }
}
