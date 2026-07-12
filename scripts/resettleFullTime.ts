// Přepočet uložených výsledků na skóre po 90 minutách (`score.fulltime`).
//
// Proč: settle dřív ukládal `fixture.goals` = KONCOVÉ skóre, takže zápasy rozhodnuté
// v prodloužení (AET) nebo na penalty (PEN) nesou góly ze 120 minut. Náš model
// predikuje 90 minut → takový řádek kazí 1X2 (remíza po 90 min se tváří jako výhra),
// Over 2.5, BTTS i MLE Dixon–Coles ρ. Týká se JEN statusů AET/PEN – u FT jsou obě
// hodnoty shodné.
//
// Spuštění: npm run resettle            (suchý běh – jen vypíše, co by změnil)
//           npm run resettle -- --apply (zapíše do DB)
import { prisma } from "../lib/db.ts";
import { fetchFixturesByIds } from "../lib/data/apiFootball.ts";
import { fullTimeGoals } from "../lib/data/fixtures.ts";

const apply = process.argv.includes("--apply");
const BATCH = 20; // /fixtures?ids= zvládá ~20 ID na volání

async function main() {
  const rows = await prisma.fixturePrediction.findMany({
    where: { status: { in: ["AET", "PEN"] } },
    select: {
      fixtureId: true,
      status: true,
      homeName: true,
      awayName: true,
      homeGoals: true,
      awayGoals: true,
    },
    orderBy: { kickoff: "asc" },
  });
  console.log(
    `Řádků po prodloužení/penaltách (AET/PEN): ${rows.length}` +
      (apply ? "" : "  [suchý běh – zapiš přes -- --apply]")
  );
  if (rows.length === 0) {
    console.log("Není co přepočítat.");
    return;
  }

  const stored = new Map(rows.map((r) => [r.fixtureId, r]));
  let changed = 0;
  let same = 0;
  let missing = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const ids = rows.slice(i, i + BATCH).map((r) => r.fixtureId);
    const fixtures = await fetchFixturesByIds(ids);
    const seen = new Set<number>();

    for (const f of fixtures) {
      seen.add(f.fixture.id);
      const row = stored.get(f.fixture.id);
      if (!row) continue;
      const ft = fullTimeGoals(f);
      if (!ft) {
        missing++;
        console.log(`⚠ ${row.homeName} vs ${row.awayName}: API nevrátilo skóre`);
        continue;
      }
      if (ft.home === row.homeGoals && ft.away === row.awayGoals) {
        same++;
        continue;
      }
      changed++;
      console.log(
        `${row.status}  ${row.homeName} vs ${row.awayName}: ` +
          `${row.homeGoals}:${row.awayGoals} (koncové) → ${ft.home}:${ft.away} (90 min)`
      );
      if (apply) {
        await prisma.fixturePrediction.update({
          where: { fixtureId: f.fixture.id },
          data: { homeGoals: ft.home, awayGoals: ft.away },
        });
      }
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        missing++;
        console.log(`⚠ fixture ${id}: API ho nevrátilo`);
      }
    }
  }

  console.log(
    `\n${apply ? "Upraveno" : "K úpravě"}: ${changed} | beze změny: ${same} | bez dat: ${missing}`
  );
  if (changed > 0 && !apply) {
    console.log("Zapiš: npm run resettle -- --apply, pak spusť npm run calibrate.");
  }
}

main()
  .catch((e) => {
    console.error("❌ Přepočet selhal:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
