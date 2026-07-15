import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/authUser";
import { deleteOpenTip } from "@/lib/data/tipStore";

/** DELETE – smaže vlastní NEvyhodnocený tip (settlnuté zůstávají v bilanci). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });

  const { id } = await params;
  const ok = await deleteOpenTip(user.id, id);
  if (!ok) return NextResponse.json({ error: "Nenalezeno" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
