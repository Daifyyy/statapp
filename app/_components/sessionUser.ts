import type { Tier } from "@/lib/entitlements";

/** Serializovatelný podmnožinový pohled na přihlášeného uživatele (server → client). */
export interface SessionUser {
  id: string;
  name?: string | null;
  image?: string | null;
  tier: Tier;
  proTrialUsed: boolean;
}
