// Balanc herního modulu „Manažer" – headless simulace, žádné IO ani API.
// Spuštění: npm run sim-game
//           npm run sim-game -- --seasons=300 --careers=60 --maxSeasons=12
//
// Měří tři věci:
//  1. LIGA – náročnost jedné sezóny (Ø body mistra/posledního, jak často vyhraje favorit).
//     Referenční hodnoty z CLAUDE.md: mistr ~80 b, poslední ~26 b, titul nejsilnějšího ~30 %.
//  2. ROZVOJ – kolik sezón trvá vytáhnout klub ze středu tabulky nahoru. Cílová křivka:
//     do Evropy (top 4) kolem 5.–6. sezóny, medián prvního titulu 6.–8. sezóna. Když je
//     titul do 3. sezóny, rozvoj je overpowered; když nad 10, je k ničemu. Kontrolní běh
//     BEZ rozvoje musí zůstat placatý (~10. místo napořád) – jinak měříme něco jiného.
//  3. CLAMP – jak často kombinace plán × counter × instrukce × morálka × kondice × eventy
//     narazí na `ADJUST_MIN/MAX`. Za stropem přestanou být volby cítit → má být vzácné.

import { generateLeague } from "../lib/game/teams.ts";
import {
  newSeason,
  currentTable,
  playRound,
  simulateToEnd,
  isSeasonOver,
  setPlan,
  setInstruction,
  resolveYourAdjust,
} from "../lib/game/engine.ts";
import { startNextSeason, summarizeSeason } from "../lib/game/career.ts";
import { updateReputation } from "../lib/game/reputation.ts";
import { applyEventChoice } from "../lib/game/events.ts";
import { scoutOpponent } from "../lib/game/scouting.ts";
import { developmentPoints } from "../lib/game/development.ts";
import type { DevSpend } from "../lib/game/development.ts";
import { teamStrengthScore } from "../lib/game/leagues.ts";
import { ADJUST_MAX, ADJUST_MIN, STARTING_REPUTATION } from "../lib/game/balance.ts";
import type { Plan, SeasonState } from "../lib/game/types.ts";

function arg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : dflt;
}
const SEASONS = arg("seasons", 300);
const CAREERS = arg("careers", 60);
const MAX_SEASONS = arg("maxSeasons", 12);

// ───────────────────────── 1) náročnost ligy ─────────────────────────

function leagueDifficulty() {
  let champPts = 0;
  let lastPts = 0;
  let strongestTitles = 0;
  for (let i = 0; i < SEASONS; i++) {
    const teams = generateLeague(1000 + i);
    const strongest = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a))[0];
    const table = currentTable(simulateToEnd(newSeason(1000 + i, teams[0].id, { teams })));
    champPts += table[0].points;
    lastPts += table[table.length - 1].points;
    if (table[0].teamId === strongest.id) strongestTitles++;
  }
  console.log(`\n── 1) Náročnost ligy (${SEASONS} sezón, hráč nezasahuje) ──`);
  console.log(`   Ø mistr              ${(champPts / SEASONS).toFixed(1)} b   (ref ~80)`);
  console.log(`   Ø poslední           ${(lastPts / SEASONS).toFixed(1)} b   (ref ~26)`);
  console.log(
    `   titul nejsilnějšího  ${((strongestTitles / SEASONS) * 100).toFixed(1)} %   (ref ~30 %)`
  );
}

// ───────────────────────── hráčská strategie ─────────────────────────

/** Nejlepší protitah proti HLÁŠENÉMU stylu (hráč pravdu nezná). */
function pickPlan(state: SeasonState, oppId: number): Plan {
  const reported = scoutOpponent(state, oppId).reportedStyle;
  // Pod 55 % kondice se vyplatí ubrat, jinak by se tým uběhal.
  if (state.fitness < 55) return reported === "attacking" ? "counter" : "low_block";
  if (reported === "attacking") return "counter";
  if (reported === "defensive") return "press";
  return "balanced";
}

let clampHits = 0;
let clampChecks = 0;

/** Odehraje sezónu s adaptivní strategií (plán dle scoutu, event = první volba). */
function playSeason(state: SeasonState): SeasonState {
  let s = state;
  while (!isSeasonOver(s)) {
    if (s.pendingEvent) s = applyEventChoice(s, 0);
    const fixtures = s.schedule[s.round];
    const f = fixtures.find((x) => x.homeId === s.yourTeamId || x.awayId === s.yourTeamId);
    if (f) {
      const oppId = f.homeId === s.yourTeamId ? f.awayId : f.homeId;
      s = setPlan(s, pickPlan(s, oppId));
      s = setInstruction(s, "wing_play");
      const adj = resolveYourAdjust(s, oppId);
      clampChecks++;
      if (
        adj.attack >= ADJUST_MAX - 1e-9 ||
        adj.attack <= ADJUST_MIN + 1e-9 ||
        adj.concede >= ADJUST_MAX - 1e-9 ||
        adj.concede <= ADJUST_MIN + 1e-9
      )
        clampHits++;
    }
    s = playRound(s);
  }
  return s;
}

/** Rozdělí rozvojové body: střídavě útok/obrana, každý 3. do mládeže. */
function allocate(points: number, season: number): DevSpend {
  const spend: DevSpend = { attack: 0, defense: 0, youth: 0, stadium: 0 };
  for (let i = 0; i < points; i++) {
    if (season <= 2 && i === 0) spend.youth++;
    else if (i % 2 === 0) spend.attack++;
    else spend.defense++;
  }
  return spend;
}

// ───────────────────────── 2) rozvoj klubu ─────────────────────────

function development(withDev: boolean) {
  const seasonsToTitle: number[] = [];
  let neverWon = 0;
  const rankBySeason: number[][] = Array.from({ length: MAX_SEASONS }, () => []);

  for (let c = 0; c < CAREERS; c++) {
    const seed = 500000 + c;
    const teams = generateLeague(seed);
    // Vezmi přesný střed tabulky dle síly.
    const byStrength = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    const you = byStrength[Math.floor(teams.length / 2)];

    let s = newSeason(seed, you.id, { teams });
    let reputation = STARTING_REPUTATION;
    let won = 0;

    for (let season = 1; season <= MAX_SEASONS; season++) {
      s = playSeason(s);
      const summary = summarizeSeason(s);
      rankBySeason[season - 1].push(summary.yourRank);
      if (summary.champion && !won) {
        seasonsToTitle.push(season);
        won = season;
      }
      reputation = updateReputation(reputation, summary);
      const pts = withDev
        ? developmentPoints(summary, reputation, s.teams.length, s.devBonus)
        : 0;
      s = startNextSeason(s, allocate(pts, season));
    }
    if (!won) neverWon++;
  }

  const label = withDev ? "S rozvojem" : "BEZ rozvoje (kontrola)";
  console.log(`\n── 2) ${label} — ${CAREERS} kariér ze STŘEDU tabulky, ${MAX_SEASONS} sezón ──`);
  const avgRank = rankBySeason.map(
    (rs) => Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10
  );
  console.log(`   Ø umístění po sezónách: ${avgRank.join(" → ")}`);
  if (seasonsToTitle.length) {
    const med = [...seasonsToTitle].sort((a, b) => a - b)[Math.floor(seasonsToTitle.length / 2)];
    console.log(
      `   titul získalo ${seasonsToTitle.length}/${CAREERS} kariér, medián v sezóně ${med}` +
        (withDev ? "   (cíl 6–8; do Evropy kolem 5.–6.)" : "")
    );
  } else {
    console.log(`   titul nezískala ani jedna kariéra`);
  }
  console.log(`   bez titulu do ${MAX_SEASONS}. sezóny: ${neverWon}/${CAREERS}`);
}

// ───────────────────────── main ─────────────────────────

leagueDifficulty();
clampHits = 0;
clampChecks = 0;
development(false);
development(true);
console.log(`\n── 3) Clamp ADJUST_MIN/MAX ──`);
console.log(
  `   dotčeno ${clampHits}/${clampChecks} zápasů (${((clampHits / clampChecks) * 100).toFixed(2)} %) — má být vzácné`
);
