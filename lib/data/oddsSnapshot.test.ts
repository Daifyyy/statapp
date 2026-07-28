import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Konzistence nastavení snímků kurzů **napříč dvěma soubory**: `ODDS_CLOSING_HOURS`
 * v `predictions.ts` a rozvrh cronu v `.github/workflows/cron.yml`.
 *
 * Proč to hlídá test a ne komentář: ta dvě čísla spolu drží CLV, ale žijí každé jinde
 * a nic je nespojuje. Změna jednoho bez druhého **selže tiše** – zápasy prostě nedostanou
 * zavírací snímek a pozná se to až za měsíce, až bude vzorek CLV podezřele malý.
 * Přesně tenhle typ tichého selhání už projekt jednou stál rok bez jediného kurzu.
 *
 * Čte se **zdrojový text**, ne importovaná konstanta: `predictions.ts` táhne repository
 * a Prismu, což do unit testu nepatří.
 */

const ROOT = process.cwd();
const source = readFileSync(join(ROOT, "lib/data/predictions.ts"), "utf8");
const workflow = readFileSync(join(ROOT, ".github/workflows/cron.yml"), "utf8");

/** `export const ODDS_CLOSING_HOURS = 3;` → 3 */
function constantOf(name: string): number {
  const m = new RegExp(`export const ${name} = (\\d+)`).exec(source);
  if (!m) throw new Error(`V predictions.ts chybí ${name}`);
  return Number(m[1]);
}

/** Cron výraz úlohy → perioda v hodinách (`20 * * * *` → 1, `0 *​/3 * * *` → 3). */
function periodHours(expr: string): number {
  const hour = expr.trim().split(/\s+/)[1];
  if (hour === "*") return 1;
  const step = /^\*\/(\d+)$/.exec(hour);
  if (step) return Number(step[1]);
  // Konkrétní hodina (denní úloha) – pro snímky kurzů nepřipadá v úvahu.
  return 24;
}

/** Rozvrh, na který workflow mapuje `snapshot-odds`. */
function snapshotSchedule(): string {
  const m = /"([^"]+)"\)\s*path="snapshot-odds"/.exec(workflow);
  if (!m) throw new Error("Ve workflow chybí větev pro snapshot-odds");
  return m[1];
}

describe("nastavení snímků kurzů", () => {
  it("zavírací okno je ŠIRŠÍ než perioda cronu", () => {
    const closing = constantOf("ODDS_CLOSING_HOURS");
    const period = periodHours(snapshotSchedule());
    // Kdyby bylo okno užší nebo rovné periodě, zápas mezi dvěma běhy propadne a
    // zavírací snímek nedostane vůbec. Rezerva navíc kryje výpadek běhu –
    // `schedule` v GitHub Actions je best-effort.
    expect(period).toBeLessThan(closing);
    expect(closing / period).toBeGreaterThanOrEqual(2);
  });

  it("zavírací snímek padne blízko výkopu, ne půl dne předem", () => {
    // `fixturesNeedingOdds` bere PRVNÍ běh uvnitř okna, takže snímek padne zhruba
    // `ODDS_CLOSING_HOURS` před výkopem. Dřív to bylo 12 h (= odpoledne předchozího
    // dne u večerního zápasu) a CLV tím přicházelo o nejostřejší část pohybu.
    expect(constantOf("ODDS_CLOSING_HOURS")).toBeLessThanOrEqual(4);
  });

  it("otevírací okno zůstává výrazně širší než zavírací", () => {
    // Dva snímky mají smysl jen tehdy, když je mezi nimi prostor na pohyb trhu.
    expect(constantOf("ODDS_LOOKAHEAD_HOURS")).toBeGreaterThan(
      constantOf("ODDS_CLOSING_HOURS") * 5
    );
  });

  it("rozvrh ve workflow je opravdu zaregistrovaný v `schedule`", () => {
    // Větev v `case` bez odpovídajícího `- cron:` = úloha se nikdy nespustí a nic
    // nespadne. Opačný směr workflow hlídá sám (neznámý rozvrh → exit 1).
    const schedule = snapshotSchedule();
    expect(workflow).toContain(`- cron: "${schedule}"`);
  });

  it("snímky kurzů nekolidují v čase s denními úlohami", () => {
    // Minuta snímků musí být jiná než minuta kterékoli denní úlohy – jinak by v jeden
    // okamžik seděly dva rozvrhy naráz a chování by záviselo na tom, jak GitHub
    // vyhodnocuje shodné časy.
    const minuteOf = (expr: string) => expr.trim().split(/\s+/)[0];
    const snapshotMinute = minuteOf(snapshotSchedule());
    const daily = [...workflow.matchAll(/- cron: "([^"]+)"/g)]
      .map((m) => m[1])
      .filter((c) => c !== snapshotSchedule());
    for (const d of daily) {
      expect(minuteOf(d), `denní úloha "${d}" má stejnou minutu jako snímky kurzů`).not.toBe(
        snapshotMinute
      );
    }
  });
});
