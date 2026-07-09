// Balanc herního modulu „Manažer" – headless simulace, žádné IO ani API.
// Spuštění: npm run sim-game
//           npm run sim-game -- --seasons=300 --careers=60 --maxSeasons=12
//
// Měří pět věcí:
//  1. LIGA – náročnost jedné sezóny (Ø body mistra/posledního, jak často vyhraje favorit,
//     rozklad 1X2 a ⌀ góly). Reference: mistr ~80 b, poslední ~26 b, favorit ~30 %, 45/25/30.
//  2. ROZVOJ – kolik sezón trvá vytáhnout klub ze středu tabulky nahoru. Cílová křivka:
//     do Evropy (top 4) kolem 5.–6. sezóny, medián prvního titulu 6.–8. sezóna. Když je
//     titul do 3. sezóny, rozvoj je overpowered; když nad 10, je k ničemu. Kontrolní běh
//     BEZ rozvoje musí zůstat placatý (~10. místo napořád) – jinak měříme něco jiného.
//  3. CLAMP – jak často kombinace plán × counter × instrukce × morálka × kondice × eventy
//     narazí na `ADJUST_MIN/MAX`. Za stropem přestanou být volby cítit → má být vzácné.
//  4. INVESTICE – kam se vyplatí dávat rozvojové body. Žádná oblast nesmí ostatní dominovat.
//  5. TURNAJ – Euro/MS: jak často vyhraje favorit (turnaj je loterie), kolik vyřazovacích
//     zápasů jde do prodloužení (~25 %) a na penalty (~12 %). Malý počet běhů = velký šum:
//     u MS se titul nejsilnějšího čeká jen ~9 %, takže 0/40 není chyba.

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
import { recommendPlan } from "../lib/game/plans.ts";
import { developmentPoints, EMPTY_SPEND } from "../lib/game/development.ts";
import type { DevSpend } from "../lib/game/development.ts";
import { teamStrengthScore } from "../lib/game/leagues.ts";
import {
  EURO_FORMAT,
  WORLD_CUP_FORMAT,
  newTournament,
  simulateTournamentToEnd,
} from "../lib/game/tournament.ts";
import { ADJUST_MAX, ADJUST_MIN, STARTING_REPUTATION } from "../lib/game/balance.ts";
import type { GameTeam, Plan, SeasonState } from "../lib/game/types.ts";

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
  let h = 0;
  let d = 0;
  let a = 0;
  let goals = 0;
  for (let i = 0; i < SEASONS; i++) {
    const teams = generateLeague(1000 + i);
    const strongest = [...teams].sort((x, y) => teamStrengthScore(y) - teamStrengthScore(x))[0];
    const state = simulateToEnd(newSeason(1000 + i, teams[0].id, { teams }));
    const table = currentTable(state);
    champPts += table[0].points;
    lastPts += table[table.length - 1].points;
    if (table[0].teamId === strongest.id) strongestTitles++;
    for (const r of state.results) {
      goals += r.homeGoals + r.awayGoals;
      if (r.homeGoals > r.awayGoals) h++;
      else if (r.homeGoals < r.awayGoals) a++;
      else d++;
    }
  }
  const n = h + d + a;
  console.log(`\n── 1) Náročnost ligy (${SEASONS} sezón, hráč nezasahuje) ──`);
  console.log(`   Ø mistr              ${(champPts / SEASONS).toFixed(1)} b   (ref ~80)`);
  console.log(`   Ø poslední           ${(lastPts / SEASONS).toFixed(1)} b   (ref ~26)`);
  console.log(
    `   titul nejsilnějšího  ${((strongestTitles / SEASONS) * 100).toFixed(1)} %   (ref ~30 %)`
  );
  console.log(
    `   domácí/remíza/hosté  ${((100 * h) / n).toFixed(1)} / ${((100 * d) / n).toFixed(1)} / ${((100 * a) / n).toFixed(1)} %   (reálný fotbal ~45/25/30)`
  );
  console.log(`   Ø gólů na zápas      ${(goals / n).toFixed(2)}   (ref ~2.7–3.1)`);
}

// ───────────────────────── hráčská strategie ─────────────────────────

/**
 * Nejlepší protitah proti HLÁŠENÉMU stylu (hráč pravdu nezná). `null` = mlhavé hlášení
 * (nízká konfidence) → nemá cenu riskovat counter, jede se bezpečně.
 * Sdílí `recommendPlan` s tím, co skauti radí v UI – jeden zdroj pravdy.
 */
function pickPlan(state: SeasonState, oppId: number): Plan {
  const reported = scoutOpponent(state, oppId).reportedStyle;
  // Pod 55 % kondice se vyplatí ubrat, jinak by se tým uběhal.
  if (state.fitness < 55) return reported === "attacking" ? "counter" : "low_block";
  return reported ? recommendPlan(reported) : "balanced";
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
  const spend: DevSpend = { ...EMPTY_SPEND };
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

// ───────────────── 4) kam se vyplatí investovat ─────────────────
//
// Stadion (`homeBoost`) NEREGREDUJE mezi sezónami, kdežto útok/obranu drift částečně smyje.
// Čistá „mezní hodnota bodu" ho proto podceňuje – tohle měří skutečný výsledek po N sezónách
// při strategii „všechno do jedné oblasti". Žádná oblast nesmí ostatní jasně dominovat.

function areaValue() {
  // `scouting` tu záměrně chybí: nekupuje λ, ale konfidenci hlášení – simulace hraje
  // adaptivně dle scoutu, takže by měřila kvalitu `pickPlan`, ne hodnotu investice.
  const areas: (keyof DevSpend)[] = ["attack", "defense", "youth", "stadium"];
  console.log(
    `\n── 4) Kam investovat? ${CAREERS} kariér ze středu, ${MAX_SEASONS} sezón, vše do jedné oblasti ──`
  );
  for (const area of areas) {
    let sumRank = 0;
    let sumPts = 0;
    let titles = 0;
    for (let c = 0; c < CAREERS; c++) {
      const seed = 700000 + c;
      const teams = generateLeague(seed);
      const byStrength = [...teams].sort((x, y) => teamStrengthScore(y) - teamStrengthScore(x));
      let s = newSeason(seed, byStrength[Math.floor(teams.length / 2)].id, { teams });
      let reputation = STARTING_REPUTATION;
      for (let season = 1; season <= MAX_SEASONS; season++) {
        s = playSeason(s);
        const summary = summarizeSeason(s);
        if (summary.champion) titles++;
        if (season === MAX_SEASONS) {
          sumRank += summary.yourRank;
          sumPts += summary.yourPoints;
        }
        reputation = updateReputation(reputation, summary);
        const pts = developmentPoints(summary, reputation, s.teams.length, s.devBonus);
        const spend: DevSpend = { ...EMPTY_SPEND };
        spend[area] = pts;
        s = startNextSeason(s, spend);
      }
    }
    console.log(
      `   ${area.padEnd(8)} → po ${MAX_SEASONS}. sezóně Ø ${(sumRank / CAREERS).toFixed(1)}. místo, ` +
        `Ø ${(sumPts / CAREERS).toFixed(1)} b, titulů celkem ${titles}`
    );
  }
}

// ───────────────── 5) turnajové jádro (Phase 4) ─────────────────
//
// Turnaj je loterie: nejsilnější tým vyhraje řádově v jednotkách až nižších desítkách procent.
// Kontrolní čísla proti realitě: do prodloužení jde ~čtvrtina vyřazovacích zápasů a z toho
// zhruba polovina na penalty. Pole tady jen recykluje generovanou ligu (`homeBoost: 1` =
// neutrální půda) – reálné ratingy reprezentací dodá až `nationalTeams.ts` (T3).

/** Turnajové pole: přečísluje generovanou ligu a nastaví neutrální půdu. */
function tournamentField(n: number, seed: number): GameTeam[] {
  const out: GameTeam[] = [];
  let s = seed;
  while (out.length < n) {
    for (const t of generateLeague(s)) {
      if (out.length >= n) break;
      out.push({ ...t, id: out.length + 1, name: `N${out.length + 1}`, homeBoost: 1 });
    }
    s++;
  }
  return out;
}

function tournaments() {
  console.log(`\n── 5) Turnajové jádro ──`);
  for (const [format, size, runs] of [
    [EURO_FORMAT, 24, Math.max(60, Math.round(SEASONS / 2))],
    [WORLD_CUP_FORMAT, 48, Math.max(40, Math.round(SEASONS / 3))],
  ] as const) {
    let strongestTitles = 0;
    let top4Titles = 0;
    let champRankSum = 0;
    let extraTime = 0;
    let penalties = 0;
    let koMatches = 0;

    for (let i = 0; i < runs; i++) {
      const teams = tournamentField(size, 1000 + i * 7);
      const ranked = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
      const done = simulateTournamentToEnd(
        newTournament(9000 + i, teams[0].id, teams, format),
        format
      );
      const rank = ranked.findIndex((t) => t.id === done.champion) + 1;
      champRankSum += rank;
      if (rank === 1) strongestTitles++;
      if (rank <= 4) top4Titles++;
      extraTime += done.knockout.filter((k) => k.afterExtraTime).length;
      penalties += done.knockout.filter((k) => k.penalties).length;
      koMatches += done.knockout.length;
    }

    console.log(`   ${format.name} (${size} týmů, ${runs} turnajů)`);
    console.log(
      `     titul nejsilnějšího ${((100 * strongestTitles) / runs).toFixed(1).padStart(5)} %` +
        `   z top 4 ${((100 * top4Titles) / runs).toFixed(1).padStart(5)} %` +
        `   Ø síla mistra ${(champRankSum / runs).toFixed(1)}. z ${size}`
    );
    console.log(
      `     KO do prodloužení ${((100 * extraTime) / koMatches).toFixed(1).padStart(5)} % (ref ~25 %)` +
        `   na penalty ${((100 * penalties) / koMatches).toFixed(1).padStart(5)} % (ref ~12 %)`
    );
  }
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
areaValue();
tournaments();
