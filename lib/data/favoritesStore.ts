import { prisma } from "@/lib/db";

/**
 * Úložiště oblíbených zápasů a lig (PRO) nad tabulkami `FavoriteFixture`/`FavoriteLeague`.
 * Funguje kdykoli je `DATABASE_URL` (nezávisí na mock/real API režimu, jako `UserTip`/
 * `GameSave`). Bez snapshot meta – filtr/„primární sekce" pracuje jen nad už načteným
 * 7denním Programem, takže stačí id. Zápis vkládá route `/api/fixtures/favorites`.
 */

/**
 * IDs oblíbených zápasů a lig uživatele (pro naplnění setů v UI). Vlastnictví běží přes
 * **e-mail** (stabilní přes re-login/reset User řádku), ne přes `userId`. `userId` se ukládá
 * jen jako volitelná reference (obnoví se při dalším přepnutí).
 */
export async function getFavorites(
  email: string
): Promise<{ fixtures: number[]; leagues: number[] }> {
  const [fixtures, leagues] = await Promise.all([
    prisma.favoriteFixture.findMany({
      where: { email },
      select: { fixtureId: true },
    }),
    prisma.favoriteLeague.findMany({
      where: { email },
      select: { leagueId: true },
    }),
  ]);
  return {
    fixtures: fixtures.map((f) => f.fixtureId),
    leagues: leagues.map((l) => l.leagueId),
  };
}

/** Zapne/vypne oblíbený zápas (idempotentní). */
export async function toggleFavoriteFixture(
  email: string,
  userId: string | null,
  fixtureId: number,
  on: boolean
): Promise<void> {
  if (on) {
    await prisma.favoriteFixture.upsert({
      where: { email_fixtureId: { email, fixtureId } },
      create: { email, userId, fixtureId },
      update: { userId },
    });
  } else {
    await prisma.favoriteFixture.deleteMany({ where: { email, fixtureId } });
  }
}

/** Zapne/vypne oblíbenou ligu (idempotentní). */
export async function toggleFavoriteLeague(
  email: string,
  userId: string | null,
  leagueId: number,
  on: boolean
): Promise<void> {
  if (on) {
    await prisma.favoriteLeague.upsert({
      where: { email_leagueId: { email, leagueId } },
      create: { email, userId, leagueId },
      update: { userId },
    });
  } else {
    await prisma.favoriteLeague.deleteMany({ where: { email, leagueId } });
  }
}
