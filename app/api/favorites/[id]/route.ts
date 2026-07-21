import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";

/** DELETE – smaže oblíbené (jen vlastní záznam přihlášeného uživatele). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });

  const { id } = await params;
  // deleteMany s e-mailem v podmínce → nelze smazat cizí záznam (vlastnictví přes e-mail).
  const res = await prisma.savedComparison.deleteMany({
    where: { id, email: user.email ?? `user:${user.id}` },
  });
  if (res.count === 0)
    return NextResponse.json({ error: "Nenalezeno" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
