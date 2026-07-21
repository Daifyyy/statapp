import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authUser";
import { logError } from "@/lib/logError";

/**
 * DELETE – smaže účet přihlášeného uživatele (GDPR „právo být zapomenut").
 * Account/Session mají v schématu kaskádu → smažou se s User řádkem.
 * Uživatelský obsah (UserTip, SavedComparison, GameSave, Favorite*) je nově vázaný na
 * e-mail se SetNull (aby přežil re-login/reset) → při skutečném smazání účtu ho musíme
 * uklidit EXPLICITNĚ podle e-mailu (i podle fallbacku `user:<id>`). Klient poté signOut.
 */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });

  // Všechny možné vlastnické klíče uživatele (e-mail + fallback pro účet bez e-mailu).
  const owners = [user.email, `user:${user.id}`].filter((v): v is string => !!v);
  const where = { email: { in: owners } };

  try {
    // Nejdřív obsah vázaný na e-mail (relace na User už nejsou kaskádové), pak samotný účet.
    await prisma.$transaction([
      prisma.userTip.deleteMany({ where }),
      prisma.savedComparison.deleteMany({ where }),
      prisma.gameSave.deleteMany({ where }),
      prisma.favoriteLeague.deleteMany({ where }),
      prisma.favoriteFixture.deleteMany({ where }),
    ]);
    await prisma.user.delete({ where: { id: user.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("api/account.delete", e, { userId: user.id });
    return NextResponse.json({ error: "Smazání se nezdařilo" }, { status: 500 });
  }
}
