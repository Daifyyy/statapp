// Balanc herního modulu „Manažer" – headless simulace, žádné IO ani API.
// Spuštění: npm run sim-game
//           npm run sim-game -- --seasons=300 --careers=60 --maxSeasons=12
//
// Měří sedm věcí:
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
//  6. AGENCY – opačný konec než sekce 3: je vůbec CÍTIT, že hráč něco zvolil? Porovná
//     „nesaháš na nic" / „podle skautů" / „s pravdou" / „naschvál špatně" párově na týchž
//     seedech. Pozorná hra má vynést ~+2.5 b/sezónu proti šumu ±8 b (signál/šum ~0.3 sd).
//  7. AUTOPLAY – kolik kliků sezóna stojí přes „Hrát dál" a kolik bodů to pohodlí stojí.

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
import { PLANS } from "../lib/game/plans.ts";
import { recommendPlan, outcomeValue } from "../lib/game/planChoice.ts";
import { composeAdjust } from "../lib/game/adjust.ts";
import { matchStakes } from "../lib/game/stakes.ts";
import { playUntilDecision } from "../lib/game/autoplay.ts";
import { predictProbs, NEUTRAL_ADJUST } from "../lib/game/simulate.ts";
import { teamById } from "../lib/game/teams.ts";
import {
  INSTRUCTIONS,
  MATCHUP,
  recommendInstruction,
} from "../lib/game/instructions.ts";
import { seasonTacticImpact } from "../lib/game/tacticImpact.ts";
import { developmentPoints, EMPTY_SPEND } from "../lib/game/development.ts";
import type { DevSpend } from "../lib/game/development.ts";
import { teamStrengthScore } from "../lib/game/leagues.ts";
import {
  EURO_FORMAT,
  WORLD_CUP_FORMAT,
  newTournament,
  simulateTournamentToEnd,
} from "../lib/game/tournament.ts";
import {
  ADJUST_MAX,
  ADJUST_MIN,
  SCOUT_LEVEL_MAX,
  STARTING_REPUTATION,
} from "../lib/game/balance.ts";
import type {
  GameTeam,
  Instruction,
  OppStyle,
  Plan,
  SeasonState,
  Trait,
} from "../lib/game/types.ts";

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
function pickPlan(state: SeasonState, oppId: number, youHome: boolean): Plan {
  const scout = scoutOpponent(state, oppId);
  // Pod 55 % kondice se vyplatí ubrat, jinak by se tým uběhal.
  if (state.fitness < 55) return scout.reportedStyle === "attacking" ? "counter" : "low_block";
  if (!scout.reportedStyle) return "balanced";
  // Plán se měří vahami ZÁPASU (co odsud potřebuješ), ne gólovým rozdílem – viz stakes.ts.
  return recommendPlan(
    state,
    oppId,
    youHome,
    scout.reportedStyle,
    scout.reportedTraits,
    matchStakes(state, oppId).weights
  );
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
      s = setPlan(s, pickPlan(s, oppId, f.homeId === s.yourTeamId));
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

// ───────────────── 6) agency: vynesou hráčova rozhodnutí vůbec něco? ─────────────────
//
// Sekce 3 měří, jestli páky nenarážejí na strop. Tahle měří opačný konec: jestli je vůbec
// CÍTIT, že hráč něco zvolil. Čtyři strategie na TÝCHŽ seedech (stejná liga, stejný tým,
// stejné RNG), takže je porovnání párové a šum ligy se z rozdílu odečte.
//
// Referenční stav při zavedení (300 sezón): nesaháš 51.3 b · podle skautů 53.8 · s pravdou
// 54.4 · naschvál špatně 50.0. Rozpětí CELÉ agency je tedy ~4.4 bodu proti sd sezóny ±8.1 —
// poměr signál/šum 0.38 sd. To je vědomě málo (efekty se drží malé kvůli `ADJUST_MIN/MAX`,
// viz sekce 3) a právě proto appka dopad volby ukazuje explicitně (`lib/game/tacticImpact.ts`);
// z tabulky by ho hráč nepřečetl. Když tenhle poměr spadne k nule, taktická vrstva přestala
// existovat; když vyskočí, hra se stala deterministickou.

/** Nejhorší možný plán podle TÉŽE metriky jako doporučení – dolní mez agency. */
function pickWorstPlan(
  state: SeasonState,
  oppId: number,
  youHome: boolean,
  style: OppStyle,
  traits: Trait[],
  weights: { win: number; draw: number }
): Plan {
  const you = teamById(state.teams, state.yourTeamId);
  const opp = teamById(state.teams, oppId);
  let worst: Plan = "balanced";
  let score = Infinity;
  for (const p of PLANS) {
    const adj = composeAdjust(state, style, traits, p, "none");
    const pr = predictProbs(
      youHome ? you : opp,
      youHome ? opp : you,
      youHome ? adj : NEUTRAL_ADJUST,
      youHome ? NEUTRAL_ADJUST : adj
    );
    const v = outcomeValue(youHome ? pr.homeWin : pr.awayWin, pr.draw, weights);
    if (v < score) {
      score = v;
      worst = p;
    }
  }
  return worst;
}

/** Instrukce, jejíž `punishedBy` trait soupeř má (a `rewards` ne) – tedy čistý postih. */
function pickInstruction(traits: Trait[], best: boolean): Instruction {
  for (const i of INSTRUCTIONS) {
    if (i === "none") continue;
    const m = MATCHUP[i as Exclude<Instruction, "none">];
    const hit = traits.includes(m.rewards);
    const miss = traits.includes(m.punishedBy);
    if (best ? hit && !miss : miss && !hit) return i;
  }
  return "none";
}

type Strategy = "nesaháš" | "podle skautů" | "s pravdou" | "naschvál špatně";

function agency() {
  const runs = Math.max(100, Math.round(SEASONS / 2));
  const strategies: Strategy[] = ["nesaháš", "podle skautů", "s pravdou", "naschvál špatně"];
  const points: Record<Strategy, number[]> = {
    nesaháš: [],
    "podle skautů": [],
    "s pravdou": [],
    "naschvál špatně": [],
  };
  let shiftSum = 0;
  let shiftSeasons = 0;
  let vague = 0;
  let standard = 0;
  let detailed = 0;
  let scoutRounds = 0;

  for (let i = 0; i < runs; i++) {
    const seed = 900000 + i;
    const teams = generateLeague(seed);
    const byStrength = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    const you = byStrength[Math.floor(teams.length / 2)];

    for (const strategy of strategies) {
      let s = newSeason(seed, you.id, { teams });
      while (!isSeasonOver(s)) {
        const f = s.schedule[s.round].find(
          (x) => x.homeId === s.yourTeamId || x.awayId === s.yourTeamId
        );
        if (f) {
          const oppId = f.homeId === s.yourTeamId ? f.awayId : f.homeId;
          const scout = scoutOpponent(s, oppId);
          if (strategy === "podle skautů") {
            scoutRounds++;
            if (scout.quality === "vague") vague++;
            else if (scout.quality === "standard") standard++;
            else detailed++;
          }
          const youHome = f.homeId === s.yourTeamId;
          const weights = matchStakes(s, oppId).weights;
          let plan: Plan = "balanced";
          let instruction: Instruction = "none";
          if (strategy === "podle skautů") {
            // Přesně to, co UI hráči nabízí: hlášený styl a odhalené traity, ne pravda.
            plan = scout.reportedStyle
              ? recommendPlan(s, oppId, youHome, scout.reportedStyle, scout.reportedTraits, weights)
              : "balanced";
            instruction = recommendInstruction(scout.reportedTraits);
          } else if (strategy === "s pravdou") {
            plan = recommendPlan(s, oppId, youHome, scout.style, scout.traits, weights);
            instruction = pickInstruction(scout.traits, true);
          } else if (strategy === "naschvál špatně") {
            plan = pickWorstPlan(s, oppId, youHome, scout.style, scout.traits, weights);
            instruction = pickInstruction(scout.traits, false);
          }
          s = setInstruction(setPlan(s, plan), instruction);
        }
        // Event ve všech větvích stejně (první volba) – ať se neměří štěstí na eventy.
        if (s.pendingEvent) s = applyEventChoice(s, 0);
        s = playRound(s);
      }
      const row = currentTable(s).find((r) => r.teamId === you.id)!;
      points[strategy].push(row.points);
      if (strategy === "podle skautů") {
        const impact = seasonTacticImpact(s.results, s.yourTeamId);
        if (impact.matches) {
          shiftSum += impact.avgShift;
          shiftSeasons++;
        }
      }
    }
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a: number[]) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((acc, v) => acc + (v - m) ** 2, 0) / (a.length - 1));
  };

  console.log(`\n── 6) Agency — vynesou rozhodnutí něco? (${runs} sezón, párově na týchž seedech) ──`);
  for (const st of strategies) {
    console.log(`   ${st.padEnd(16)} Ø ${mean(points[st]).toFixed(1).padStart(5)} b`);
  }
  const noise = sd(points["nesaháš"]);
  const real = mean(points["podle skautů"]) - mean(points["nesaháš"]);
  const span = mean(points["s pravdou"]) - mean(points["naschvál špatně"]);
  console.log(
    `   pozorná hra nad „nesaháš": +${real.toFixed(2)} b/sezónu   (ref ~+2.5)`
  );
  console.log(`   rozpětí celé agency:        ${span.toFixed(2)} b   (ref ~4.4)`);
  console.log(
    `   šum sezóny (sd):            ±${noise.toFixed(1)} b → signál/šum ${(real / noise).toFixed(2)} sd   (ref ~0.31)`
  );
  console.log(
    `   Ø posun šance na výhru:     ${(shiftSum / Math.max(1, shiftSeasons)).toFixed(1)} p.b./zápas   (ref ~+2.2)`
  );
  console.log(
    `   kvalita scoutingu:          vague ${((100 * vague) / scoutRounds).toFixed(0)} % · ` +
      `standard ${((100 * standard) / scoutRounds).toFixed(0)} % · detailed ${((100 * detailed) / scoutRounds).toFixed(0)} %` +
      `   (ref 10/85/4 — hráč BEZ investice do skautingu; detailed jen z eventu)`
  );

  // Náběh podle investice. Tohle je ta podstatná osa: dřív byl podíl detailních hlášení
  // `0 · 0 · 50 · 50 · 84 · 87 %`, tedy tři z pěti bodů byly němé. Musí růst na každém kroku.
  const ramp: number[] = [];
  for (let level = 0; level <= SCOUT_LEVEL_MAX; level++) {
    let d = 0;
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const seed = 6000 + i;
      const teams = generateLeague(seed);
      const byStrength = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
      let s = newSeason(seed, byStrength[Math.floor(teams.length / 2)].id, {
        teams,
        scouting: level,
      });
      // Průměr přes CELOU sezónu, ne jeden okamžik: po ~20. kole má každý soupeř plný
      // vzorek i odvetu, takže by se měřil jen strop a všechny úrovně by vyšly stejně.
      while (!isSeasonOver(s)) {
        const oppId = s.schedule[s.round].find(
          (f) => f.homeId === s.yourTeamId || f.awayId === s.yourTeamId
        );
        if (oppId) {
          const id = oppId.homeId === s.yourTeamId ? oppId.awayId : oppId.homeId;
          n++;
          if (scoutOpponent({ ...s, scoutBoostUntilRound: null }, id).quality === "detailed") d++;
        }
        s = playRound(s);
      }
    }
    ramp.push((100 * d) / n);
  }
  console.log(
    `   detailed dle investice:     ${ramp.map((x) => `${x.toFixed(0)} %`).join(" → ")}` +
      `   (musí růst na KAŽDÉM kroku; ref 0 → 50 → 84 → 89 → 95 → 100)`
  );
}

// ───────────────── 7) autoplay: kolik kliků sezóna stojí ─────────────────
//
// „Hrát dál" (`autoplay.ts`) je střed mezi „Odehrát kolo" (38 kliků, 38 rozhodnutí) a
// „Dohrát sezónu" (0 kliků, 0 rozhodnutí). Měří se dvě věci, které jdou proti sobě:
// kolik kliků sezóna stojí a kolik bodů to pohodlí stojí. Referenční stav při zavedení:
// 19.5 kliku/sezónu (z toho jen ~9 administrativy, zbytek jsou volby v událostech),
// Ø dávka 1.95 kola, cena ~1.0 b/sezónu.
//
// Tu cenu je potřeba číst proti sekci 6: pozorná ruční hra vynese +2.9 b nad „nesaháš",
// takže autoplay vrací zhruba TŘETINU taktické výhody za polovinu kliků. Je to nabídka,
// ne past – „Odehrát kolo" zůstává a dá plnou hodnotu. Klesne-li „administrativa" k nule,
// zastávky přestaly fungovat; vyskočí-li cena nad ~1.5 b, autoplay bere hráči příliš.

function autoplayErgonomics() {
  const runs = Math.max(100, Math.round(SEASONS / 2));
  const reasons: Record<string, number> = {};
  let clicks = 0;
  let rounds = 0;
  let ptsAuto = 0;
  let ptsManual = 0;

  for (let i = 0; i < runs; i++) {
    const seed = 900000 + i;
    const teams = generateLeague(seed);
    const byStrength = [...teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
    const you = byStrength[Math.floor(teams.length / 2)];

    // Hráč rozhoduje JEN na zastávkách; mezi nimi jede stávající plán.
    let s = newSeason(seed, you.id, { teams });
    while (!isSeasonOver(s)) {
      if (s.pendingEvent) s = applyEventChoice(s, 0);
      const f = s.schedule[s.round].find(
        (x) => x.homeId === s.yourTeamId || x.awayId === s.yourTeamId
      );
      if (f) {
        s = setPlan(s, pickPlan(s, f.homeId === s.yourTeamId ? f.awayId : f.homeId, f.homeId === s.yourTeamId));
        s = setInstruction(s, "wing_play");
      }
      clicks++;
      const out = playUntilDecision(s);
      rounds += out.rounds;
      reasons[out.reason] = (reasons[out.reason] ?? 0) + 1;
      s = out.state;
    }
    ptsAuto += currentTable(s).find((r) => r.teamId === you.id)!.points;

    // Kontrola: tentýž hráč, ale rozhoduje každé kolo.
    ptsManual += currentTable(playSeason(newSeason(seed, you.id, { teams }))).find(
      (r) => r.teamId === you.id
    )!.points;
  }

  const admin = clicks - (reasons["event"] ?? 0);
  console.log(`\n── 7) Autoplay „Hrát dál" (${runs} sezón) ──`);
  console.log(
    `   kliků na sezónu     ${(clicks / runs).toFixed(1)}   (ruční hra 38)   z toho administrativa ${(admin / runs).toFixed(1)}   (ref 19.5 / 9.0)`
  );
  console.log(`   Ø délka dávky       ${(rounds / clicks).toFixed(2)} kola   (ref ~1.9)`);
  console.log(
    `   cena pohodlí        ${((ptsManual - ptsAuto) / runs).toFixed(2)} b/sezónu   (ref ~1.0 = třetina agency; nad 1.5 b moc)`
  );
  console.log(
    `   důvody zastávek     ` +
      Object.entries(reasons)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${((100 * v) / clicks).toFixed(0)} %`)
        .join(" · ")
  );
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
agency();
autoplayErgonomics();
