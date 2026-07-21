// Bezpečná migrace PŘED `prisma db push`: přidá nullable `email` a naplní ho z `User`
// pro všechny tabulky vázané dřív na `userId` (UserTip, SavedComparison, GameSave,
// FavoriteLeague, FavoriteFixture). Viz prisma/backfill-email-keys.sql (jediný zdroj SQL).
// Idempotentní. Po doběhnutí spusť `prisma db push` (zpevní email + prohodí klíče
// bez ztráty dat), pak teprve deploy.
//
// Spuštění: npm run backfill-email-keys
// (na tomto stroji s NODE_OPTIONS=--use-system-ca kvůli TLS proxy na Neon)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prisma } from "../lib/db.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "prisma", "backfill-email-keys.sql");

const TABLES = [
  "UserTip",
  "SavedComparison",
  "GameSave",
  "FavoriteLeague",
  "FavoriteFixture",
];

/** Rozloží .sql na jednotlivé příkazy (bez komentářů a BEGIN/COMMIT – transakci řídí Prisma). */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(BEGIN|COMMIT)$/i.test(s));
}

async function nullCount(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "${table}" WHERE "email" IS NULL`
  );
  return Number(rows[0]?.n ?? 0);
}

async function main() {
  const sql = readFileSync(sqlPath, "utf8");
  const stmts = statements(sql);
  console.log(`Spouštím ${stmts.length} příkazů v transakci…`);

  await prisma.$transaction(stmts.map((s) => prisma.$executeRawUnsafe(s)));

  console.log("\nKontrola – řádky bez e-mailu (má být všude 0):");
  let ok = true;
  for (const t of TABLES) {
    const n = await nullCount(t);
    if (n > 0) ok = false;
    console.log(`  ${t.padEnd(16)} ${n === 0 ? "0 ✓" : `${n} ⚠️`}`);
  }

  if (ok) {
    console.log(
      "\nHotovo. Teď spusť `prisma db push` (zpevní email + prohodí klíče), pak deploy."
    );
  } else {
    console.log(
      "\n⚠️ Některé řádky nemají e-mail (userId je NULL?) – NEspouštěj db push, dej vědět."
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
