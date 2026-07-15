import { prisma } from "@/lib/db";

/**
 * Úložiště oblíbených zápasů a lig (PRO) nad tabulkami `FavoriteFixture`/`FavoriteLeague`.
 * Funguje kdykoli je `DATABASE_URL` (nezávisí na mock/real API režimu, jako `UserTip`/
 * `GameSave`). Bez snapshot meta – filtr/„primární sekce" pracuje jen nad už načteným
 * 7denním Programem, takže stačí id. Zápis vkládá route `/api/fixtures/favorites`.
 */

/** IDs oblíbených zápasů a lig uživatele (pro naplnění setů v UI). */
export async function getFavorites(
  userId: string
): Promise<{ fixtures: number[]; leagues: number[] }> {
  const [fixtures, leagues] = await Promise.all([
    prisma.favoriteFixture.findMany({
      where: { userId },
      select: { fixtureId: true },
    }),
    prisma.favoriteLeague.findMany({
      where: { userId },
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
  userId: string,
  fixtureId: number,
  on: boolean
): Promise<void> {
  if (on) {
    await prisma.favoriteFixture.upsert({
      where: { userId_fixtureId: { userId, fixtureId } },
      create: { userId, fixtureId },
      update: {},
    });
  } else {
    await prisma.favoriteFixture.deleteMany({ where: { userId, fixtureId } });
  }
}

/** Zapne/vypne oblíbenou ligu (idempotentní). */
export async function toggleFavoriteLeague(
  userId: string,
  leagueId: number,
  on: boolean
): Promise<void> {
  if (on) {
    await prisma.favoriteLeague.upsert({
      where: { userId_leagueId: { userId, leagueId } },
      create: { userId, leagueId },
      update: {},
    });
  } else {
    await prisma.favoriteLeague.deleteMany({ where: { userId, leagueId } });
  }
}
