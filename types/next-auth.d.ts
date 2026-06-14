// Rozšíření Auth.js session.user o naše pole (tier, proTrialUsed, id).
import type { Tier } from "@/lib/entitlements";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tier: Tier;
      proTrialUsed: boolean;
    } & DefaultSession["user"];
  }
}
