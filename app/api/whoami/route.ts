import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";

// DOČASNÝ diagnostický endpoint (oblíbené prázdné na PC vs plné na mobilu).
// Otevři /api/whoami na obou zařízeních a porovnej. Po diagnóze SMAZAT.
// Vrací jen vlastní session info → žádný únik cizích dat.
export async function GET() {
  const h = await headers();
  const host = h.get("host");
  const authConfigured = !!process.env.AUTH_SECRET;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ host, authConfigured, loggedIn: false });
  }

  const [favCount, dbUser] = await Promise.all([
    prisma.savedComparison.count({ where: { userId: user.id } }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, tier: true },
    }),
  ]);

  return NextResponse.json({
    host,
    authConfigured,
    loggedIn: true,
    userId: user.id,
    email: dbUser?.email ?? null,
    sessionTier: user.tier, // tier z session (zahrnuje PRO_EMAILS allowlist)
    dbTier: dbUser?.tier ?? null, // tier uložený v DB
    favCount, // počet oblíbených na tomto userId
  });
}
