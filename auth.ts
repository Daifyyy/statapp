// Auth.js v5 (NextAuth) – účty/session v Neonu přes Prisma adapter.
// Session strategie = database (řádky v tabulce Session). Do session vystavíme
// id + tier + proTrialUsed, aby UI i route znaly oprávnění bez extra dotazu.
// Pozn. (tento stroj): odchozí TLS (Google token exchange) vyžaduje
// NODE_OPTIONS=--use-system-ca; na Vercelu netřeba.

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";
import { isProEmail, type Tier } from "@/lib/entitlements";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // U database strategie přijde `user` = řádek z DB (má tier/proTrialUsed).
    session({ session, user }) {
      const u = user as typeof user & { tier?: Tier; proTrialUsed?: boolean };
      session.user.id = u.id;
      // Always-PRO allowlist (PRO_EMAILS) přepíše DB tier → přežije reset DB / nové přihlášení.
      session.user.tier = u.tier === "PRO" || isProEmail(u.email) ? "PRO" : "FREE";
      session.user.proTrialUsed = u.proTrialUsed ?? false;
      return session;
    },
  },
});
