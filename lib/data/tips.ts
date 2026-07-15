import { prisma } from "@/lib/db";
import { fetchFixturesByIds, FINISHED_STATUSES } from "./apiFootball";
import { fullTimeGoals } from "./fixtures";
import { settleTip } from "@/lib/tips/settle";
import type { TipMarket, TipSelection } from "@/lib/tips/types";

/**
 * Dotažení výsledků u osobních tipů, jejichž zápas už proběhl (cron `settle-tips`).
 * Levné: batch `/fixtures?ids=`, jeden zápas pokryje i víc tipů (různí uživatelé /
 * trhy). Skóre po 90 min (`fullTimeGoals`) jako u predikcí, aby AET/PEN nezkreslily
 * 1X2/Over. Kurz se NEmění (snapshot je z okamžiku vložení tipu).
 */
export async function runSettleTips(
  graceMs = 3 * 60 * 60 * 1000
): Promise<{ pending: number; settled: number }> {
  const pending = await prisma.userTip.findMany({
    where: { status: "NS", kickoff: { lt: new Date(Date.now() - graceMs) } },
    select: {
      id: true,
      fixtureId: true,
      market: true,
      selection: true,
      line: true,
    },
    orderBy: { kickoff: "asc" },
  });
  if (pending.length === 0) return { pending: 0, settled: 0 };

  const fixtureIds = [...new Set(pending.map((t) => t.fixtureId))];
  // Skóre po 90 min per fixtureId (jen dohrané).
  const scores = new Map<number, { home: number; away: number; status: string }>();
  for (let i = 0; i < fixtureIds.length; i += 20) {
    const chunk = fixtureIds.slice(i, i + 20);
    let fixtures;
    try {
      fixtures = await fetchFixturesByIds(chunk);
    } catch {
      continue; // výpadek jedné dávky nezastaví ostatní
    }
    for (const f of fixtures) {
      if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
      const ft = fullTimeGoals(f);
      if (!ft) continue;
      scores.set(f.fixture.id, {
        home: ft.home,
        away: ft.away,
        status: f.fixture.status.short,
      });
    }
  }

  let settled = 0;
  for (const t of pending) {
    const sc = scores.get(t.fixtureId);
    if (!sc) continue;
    const hit = settleTip(
      t.market as TipMarket,
      t.selection as TipSelection,
      t.line,
      sc.home,
      sc.away
    );
    await prisma.userTip.update({
      where: { id: t.id },
      data: {
        status: sc.status,
        homeGoals: sc.home,
        awayGoals: sc.away,
        hit,
        settledAt: new Date(),
      },
    });
    settled++;
  }
  return { pending: pending.length, settled };
}
