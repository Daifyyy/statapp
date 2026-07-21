-- Bezpečný backfill e-mailových klíčů PŘED `prisma db push`.
--
-- Kontext: uživatelská data (UserTip, SavedComparison, GameSave, FavoriteLeague,
-- FavoriteFixture) se nově identifikují podle stabilního `email`, ne podle `User.id`
-- (aby přežila re-login / reset User řádku). Nové schéma má `email` jako POVINNÝ.
-- Přidat povinný sloupec na NEPRÁZDNOU tabulku by `prisma db push` odmítl a hrozila
-- by ztráta dat. Tenhle skript proto NEJDŘÍV přidá `email` jako nullable a naplní ho
-- z `User` (fallback 'user:<userId>' pro řádky, jejichž účet už neexistuje).
--
-- Idempotentní (ADD COLUMN IF NOT EXISTS + WHERE email IS NULL) → lze spustit opakovaně.
-- Po jeho doběhnutí má každý řádek `email` → následné `prisma db push` (zpevnění na
-- NOT NULL + prohození unique/PK klíčů + userId nullable + FK SetNull) proběhne
-- BEZ ZTRÁTY DAT.
--
-- Spuštění: `npm run backfill-email-keys`  (pak teprve `prisma db push`, pak deploy)
-- Nebo vlož obsah do Neon SQL editoru.

BEGIN;

-- 1) UserTip
ALTER TABLE "UserTip" ADD COLUMN IF NOT EXISTS "email" TEXT;
UPDATE "UserTip" x SET "email" = u."email" FROM "User" u
  WHERE u."id" = x."userId" AND x."email" IS NULL AND u."email" IS NOT NULL;
UPDATE "UserTip" x SET "email" = 'user:' || x."userId"
  WHERE x."email" IS NULL AND x."userId" IS NOT NULL;

-- 2) SavedComparison
ALTER TABLE "SavedComparison" ADD COLUMN IF NOT EXISTS "email" TEXT;
UPDATE "SavedComparison" x SET "email" = u."email" FROM "User" u
  WHERE u."id" = x."userId" AND x."email" IS NULL AND u."email" IS NOT NULL;
UPDATE "SavedComparison" x SET "email" = 'user:' || x."userId"
  WHERE x."email" IS NULL AND x."userId" IS NOT NULL;

-- 3) GameSave
ALTER TABLE "GameSave" ADD COLUMN IF NOT EXISTS "email" TEXT;
UPDATE "GameSave" x SET "email" = u."email" FROM "User" u
  WHERE u."id" = x."userId" AND x."email" IS NULL AND u."email" IS NOT NULL;
UPDATE "GameSave" x SET "email" = 'user:' || x."userId"
  WHERE x."email" IS NULL AND x."userId" IS NOT NULL;

-- 4) FavoriteLeague
ALTER TABLE "FavoriteLeague" ADD COLUMN IF NOT EXISTS "email" TEXT;
UPDATE "FavoriteLeague" x SET "email" = u."email" FROM "User" u
  WHERE u."id" = x."userId" AND x."email" IS NULL AND u."email" IS NOT NULL;
UPDATE "FavoriteLeague" x SET "email" = 'user:' || x."userId"
  WHERE x."email" IS NULL AND x."userId" IS NOT NULL;

-- 5) FavoriteFixture
ALTER TABLE "FavoriteFixture" ADD COLUMN IF NOT EXISTS "email" TEXT;
UPDATE "FavoriteFixture" x SET "email" = u."email" FROM "User" u
  WHERE u."id" = x."userId" AND x."email" IS NULL AND u."email" IS NOT NULL;
UPDATE "FavoriteFixture" x SET "email" = 'user:' || x."userId"
  WHERE x."email" IS NULL AND x."userId" IS NOT NULL;

COMMIT;
