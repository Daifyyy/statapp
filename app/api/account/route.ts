import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";
import { logError } from "@/lib/logError";

/**
 * DELETE – smaže účet přihlášeného uživatele (GDPR „právo být zapomenut").
 * Kaskáda v Prisma schématu odstraní Account/Session/SavedComparison.
 * Klient po úspěchu provede signOut.
 */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });

  try {
    await prisma.user.delete({ where: { id: user.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("api/account.delete", e, { userId: user.id });
    return NextResponse.json({ error: "Smazání se nezdařilo" }, { status: 500 });
  }
}
