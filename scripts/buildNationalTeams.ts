// Vygeneruje offline snapshot reprezentačních ratingů → `lib/game/nationalTeams.ts`.
// Spuštění: npm run build-national-teams
//           npm run build-national-teams -- UEFA CONMEBOL     (jen vybrané konfederace)
//
// PROČ SKRIPTEM A NE RUČNĚ: ratingy ~200 reprezentací nejde poctivě odhadnout od oka.
// Tady jdou z reálných dat.
//
// PROČ SNAPSHOT A NE ZA BĚHU: herní modul musí fungovat offline, v testech a bez API kvóty.
// Cena stažení je jednorázová; výstup se commituje.
//
// CENA: 6 volání na soupisky konfederací (cachované) + **1 volání na reprezentaci**.
// Pozor: `buildNationalTeam` v realRepository stojí ~26 volání na tým, protože tahá
// per-zápas statistiky (xG, střely). `GameTeam` potřebuje jen průměr vstřelených
// a obdržených gólů — a ty jsou přímo v `/fixtures` (`goals.home/away`). Odtud ~217 celkem.
//
// Snapshot stárne (formy reprezentací se mění) → přegeneruj, jako `refresh-transfers`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchLastFixtures, FINISHED_STATUSES } from "../lib/data/apiFootball.ts";
import { getTeamsByLeague } from "../lib/data/realRepository.ts";
import { CONFEDERATIONS } from "../lib/data/catalog.ts";
import { shrink } from "../lib/game/teams.ts";

/** Kolik posledních zápasů brát na rating. Víc = stabilnější, ale zastaralejší forma. */
const LAST_FIXTURES = 20;
/** Souběžnost stahování – stejný strop jako `mapLimit` v realRepository (edge burst). */
const CONCURRENCY = 2;
/** Meze ratingu (jako `standingsToTeams`). */
const MIN_RATING = 0.3;
const MAX_RATING = 3.2;
/**
 * Kolik nejsilnějších reprezentací tvoří REFERENČNÍ populaci pro převod koeficientů na góly.
 * Zhruba ti, kdo se kvalifikují na MS (48). Viz komentář u výpočtu.
 */
const REFERENCE_POOL = 48;

const OUT = "lib/game/nationalTeams.ts";
/** Syrové zápasy z API. Umožňuje přepočítat ratingy bez dalších volání (gitignorováno). */
const FIXTURE_CACHE = "scripts/.national-fixtures.json";

/** Zápas mezi dvěma reprezentacemi z našeho seznamu. */
interface Match {
  homeId: number;
  awayId: number;
  homeGoals: number;
  awayGoals: number;
}

interface Row {
  id: number;
  name: string;
  confed: string;
  /** Syrový průměr vstřelených/obdržených na zápas. */
  rawFor: number;
  rawAgainst: number;
  /** Kolik dohraných zápasů za tím stojí (0 = jen fallback). */
  sample: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Posledních `LAST_FIXTURES` zápasů týmu (1 volání).
 *
 * Selhání volání se **nesmí** tiše spolknout: dřív tu bylo `.catch(() => [])` a při rate-limitu
 * pak celá konfederace dostala fallback 1.20/1.20 (všech 11 týmů OFC identických), aniž by to
 * bylo z výstupu poznat. Chyba po pěti pokusech vyhodí výjimku a skript ji nahlásí.
 */
async function teamFixtures(id: number) {
  let lastErr: unknown;
  // Edge api-sports vrací 429 i pod minutovým limitem (distribuované nody) → dlouhý backoff.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fetchLastFixtures(id, LAST_FIXTURES);
    } catch (e) {
      lastErr = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error(`tým ${id}: ${(lastErr as Error)?.message ?? lastErr}`);
}

/**
 * Ratingy útoku/obrany fitnuté **s ohledem na sílu soupeře** (multiplikativní Poissonův model,
 * jádro Dixon–Colese bez časových vah): `E[góly_h] = útok_h × obrana_a × γ`.
 *
 * Bez toho je rating slepý: Vietnam dává 2,2 gólu na zápas, jenže proti Laosu — a v syrovém
 * průměru pak skončí v top 12 světa vedle Argentiny. Iterace střídavě dopočítává útok a obranu
 * z realizovaných gólů dělených silou soupeřů, `γ` je globální domácí výhoda.
 *
 * Nula extra volání: soupeře máme přímo v už stažených zápasech.
 */
function fitRatings(matches: Match[], teamIds: number[]) {
  const atk = new Map(teamIds.map((id) => [id, 1]));
  const def = new Map(teamIds.map((id) => [id, 1]));
  let gamma = 1.2;

  const scored = new Map(teamIds.map((id) => [id, 0]));
  const conceded = new Map(teamIds.map((id) => [id, 0]));
  for (const m of matches) {
    scored.set(m.homeId, scored.get(m.homeId)! + m.homeGoals);
    scored.set(m.awayId, scored.get(m.awayId)! + m.awayGoals);
    conceded.set(m.homeId, conceded.get(m.homeId)! + m.awayGoals);
    conceded.set(m.awayId, conceded.get(m.awayId)! + m.homeGoals);
  }

  for (let iter = 0; iter < 60; iter++) {
    // útok: vstřelené / (součet obran soupeřů, doma × γ)
    const atkDen = new Map(teamIds.map((id) => [id, 0]));
    const defDen = new Map(teamIds.map((id) => [id, 0]));
    for (const m of matches) {
      atkDen.set(m.homeId, atkDen.get(m.homeId)! + def.get(m.awayId)! * gamma);
      atkDen.set(m.awayId, atkDen.get(m.awayId)! + def.get(m.homeId)!);
      defDen.set(m.awayId, defDen.get(m.awayId)! + atk.get(m.homeId)! * gamma);
      defDen.set(m.homeId, defDen.get(m.homeId)! + atk.get(m.awayId)!);
    }
    for (const id of teamIds) {
      if (atkDen.get(id)! > 0) atk.set(id, Math.max(0.05, scored.get(id)! / atkDen.get(id)!));
      if (defDen.get(id)! > 0) def.set(id, Math.max(0.05, conceded.get(id)! / defDen.get(id)!));
    }
    // Normalizace: průměrný útok = 1 (jinak model ujede do libovolného měřítka).
    const meanAtk = teamIds.reduce((s, id) => s + atk.get(id)!, 0) / teamIds.length;
    for (const id of teamIds) atk.set(id, atk.get(id)! / meanAtk);
    // γ = domácí góly / očekávané domácí góly
    let hg = 0;
    let exp = 0;
    for (const m of matches) {
      hg += m.homeGoals;
      exp += atk.get(m.homeId)! * def.get(m.awayId)!;
    }
    if (exp > 0) gamma = clamp(hg / exp, 1, 1.6);
  }
  return { atk, def, gamma };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

async function main() {
  const only = process.argv.slice(2).map((s) => s.toUpperCase());
  const confeds = only.length ? CONFEDERATIONS.filter((c) => only.includes(c.code)) : CONFEDERATIONS;

  // ── 1) soupisky (6 cachovaných volání) ──
  const roster: { id: number; name: string; confed: string }[] = [];
  for (const confed of confeds) {
    const teams = await getTeamsByLeague(confed.id);
    if (!teams.length) throw new Error(`${confed.code}: prázdná soupiska (výpadek API?)`);
    for (const t of teams) roster.push({ id: t.id, name: t.name, confed: confed.code });
  }
  const ids = roster.map((r) => r.id);
  const known = new Set(ids);
  console.log(`Soupisky: ${roster.length} reprezentací v ${confeds.length} konfederacích`);

  // ── 2) zápasy (1 volání na tým; cache umožní přepočet ratingů zadarmo) ──
  let matches: Match[];
  const cacheKey = confeds.map((c) => c.code).join(",");
  const cached = existsSync(FIXTURE_CACHE)
    ? (JSON.parse(readFileSync(FIXTURE_CACHE, "utf8")) as { key: string; matches: Match[]; played: Record<string, number> })
    : null;
  let played: Record<string, number>;

  if (cached?.key === cacheKey) {
    matches = cached.matches;
    played = cached.played;
    console.log(`Zápasy: z cache ${FIXTURE_CACHE} (${matches.length}) – žádné volání API`);
  } else {
    const seen = new Set<number>();
    const collected: Match[] = [];
    played = {};
    const failures: string[] = [];
    let done = 0;
    await mapLimit(roster, CONCURRENCY, async (t) => {
      try {
        const fixtures = await teamFixtures(t.id);
        for (const f of fixtures) {
          if (!FINISHED_STATUSES.has(f.fixture.status.short)) continue;
          if (f.goals.home === null || f.goals.away === null) continue;
          played[t.id] = (played[t.id] ?? 0) + 1;
          // Zápas si zapamatuj jen jednou a jen mezi týmy, které máme v seznamu.
          if (seen.has(f.fixture.id)) continue;
          seen.add(f.fixture.id);
          if (!known.has(f.teams.home.id) || !known.has(f.teams.away.id)) continue;
          collected.push({
            homeId: f.teams.home.id,
            awayId: f.teams.away.id,
            homeGoals: f.goals.home,
            awayGoals: f.goals.away,
          });
        }
      } catch (e) {
        failures.push(`${t.name}: ${(e as Error).message}`);
      }
      if (++done % 40 === 0) process.stdout.write(`  …${done}/${roster.length}
`);
    });
    if (failures.length) {
      console.error(`
✗ ${failures.length} týmů se nepodařilo stáhnout ani po 3 pokusech:`);
      for (const f of failures.slice(0, 5)) console.error(`   ${f}`);
      throw new Error("Snapshot by obsahoval tichá fallback data. Spusť znovu, až se rate-limit uvolní.");
    }
    matches = collected;
    writeFileSync(FIXTURE_CACHE, JSON.stringify({ key: cacheKey, matches, played }), "utf8");
    console.log(`Zápasy: ${matches.length} mezi známými reprezentacemi (cache → ${FIXTURE_CACHE})`);
  }

  // ── 3) ratingy s ohledem na sílu soupeře ──
  const { atk, def, gamma } = fitRatings(matches, ids);

  // Převod bezrozměrných koeficientů na GÓLY vyžaduje referenčního soupeře. Globální průměr
  // by byl nesmysl: populace jde od Německa po Americkou Samou (obrana 24.66), takže "průměrný
  // soupeř" by špičce nasadil 7 gólů na zápas a po clampu [0.3, 3.2] by všechny dobré týmy
  // splynuly. Referencí je proto průměr TOP `REFERENCE_POOL` týmů – tedy zhruba ti, kdo se na
  // turnaj kvalifikují. Slabé reprezentace pak vyjdou extrémně a to je správně: proti špičce
  // extrémně hrají.
  const byStrength = [...ids].sort((a, b) => atk.get(b)! / def.get(b)! - atk.get(a)! / def.get(a)!);
  const pool = byStrength.slice(0, REFERENCE_POOL);
  const refDef = pool.reduce((s, id) => s + def.get(id)!, 0) / pool.length;
  const refAtk = pool.reduce((s, id) => s + atk.get(id)!, 0) / pool.length;
  const globalFor = pool.reduce((s, id) => s + atk.get(id)! * refDef, 0) / pool.length;
  const globalAgainst = pool.reduce((s, id) => s + def.get(id)! * refAtk, 0) / pool.length;
  console.log(
    `Fit: γ (domácí výhoda) = ${gamma.toFixed(2)}; reference = top ${REFERENCE_POOL} týmů ` +
      `(⌀ ${globalFor.toFixed(2)} vstřelených / ${globalAgainst.toFixed(2)} obdržených proti sobě)`
  );

  const rows: Row[] = roster.map((t) => {
    const sample = played[t.id] ?? 0;
    // Shrink ke GLOBÁLNÍMU průměru referenční populace (ratingy jsou už očištěné o soupeře,
    // takže konfederace nehraje roli – slabá konfederace neznamená slabý tým).
    return {
      ...t,
      rawFor: shrink(atk.get(t.id)! * refDef, globalFor, sample),
      rawAgainst: shrink(def.get(t.id)! * refAtk, globalAgainst, sample),
      sample,
    };
  });

  rows.sort((a, b) => b.rawFor - b.rawAgainst - (a.rawFor - a.rawAgainst));

  console.log(`\nTop 12 dle síly (útok − obrana):`);
  for (const r of rows.slice(0, 12)) {
    console.log(
      `  ${r.name.padEnd(22)} ${r.confed.padEnd(9)} útok ${r.rawFor.toFixed(2)}  obrana ${r.rawAgainst.toFixed(2)}  (${r.sample} záp.)`
    );
  }
  console.log(`\nDno 6:`);
  for (const r of rows.slice(-6)) {
    console.log(
      `  ${r.name.padEnd(22)} ${r.confed.padEnd(9)} útok ${r.rawFor.toFixed(2)}  obrana ${r.rawAgainst.toFixed(2)}  (${r.sample} záp.)`
    );
  }

  const noData = rows.filter((r) => r.sample === 0);
  if (noData.length) {
    console.log(`\n⚠ bez dohraných zápasů (jen fallback): ${noData.length} – ${noData.map((r) => r.name).join(", ")}`);
  }

  const body = rows
    .map(
      (r) =>
        `  { id: ${r.id}, name: ${JSON.stringify(r.name)}, confed: "${r.confed}", ` +
        `attack: ${round2(clamp(r.rawFor, MIN_RATING, MAX_RATING))}, ` +
        `defense: ${round2(clamp(r.rawAgainst, MIN_RATING, MAX_RATING))}, sample: ${r.sample} },`
    )
    .join("\n");

  const file = `// GENEROVÁNO \`npm run build-national-teams\` – needituj ručně.
// Snapshot reprezentačních ratingů z reálných dat (API-Football, ${LAST_FIXTURES} posledních
// dohraných zápasů). Ratingy jsou fitnuté multiplikativním Poissonovým modelem, takže berou
// v potaz SÍLU SOUPEŘE – syrový průměr gólů by poslal Vietnam do top 12 světa (dává 2.2 gólu,
// jenže na Laos). Měřítko je v gólech proti průměru top 48 týmů. Malý vzorek → shrink.
// Herní modul musí běžet offline, v testech a bez API kvóty → data se commitují.
// Ratingy stárnou; přegeneruj skriptem (\`scripts/.national-fixtures.json\` šetří volání).
//
// Vygenerováno: ${new Date().toISOString().slice(0, 10)} · ${rows.length} reprezentací
// γ (domácí výhoda ve fitu) = ${gamma.toFixed(2)}

import type { GameTeam } from "./types";

export type ConfedCode = ${[...new Set(rows.map((r) => r.confed))].map((c) => `"${c}"`).join(" | ")};

export interface NationalSeed {
  id: number;
  name: string;
  confed: ConfedCode;
  /** Průměr vstřelených gólů na zápas. */
  attack: number;
  /** Průměr obdržených gólů na zápas (nižší = lepší). */
  defense: number;
  /** Kolik dohraných zápasů za odhadem stojí (0 = jen fallback konfederace). */
  sample: number;
}

/** Loga jdou z ID bez jediného volání (stejný tvar jako \`teamLogoUrl\` v lib/data/catalog). */
const LOGO = (id: number) => \`https://media.api-sports.io/football/teams/\${id}.png\`;

/**
 * Reprezentace jako \`GameTeam\`. \`homeBoost: 1\` = **neutrální půda** (\`homeAdvantage(1)\`
 * vrací nulový bonus i postih); pořadatel turnaje si ho může zvednout.
 */
export function nationalGameTeam(seed: NationalSeed): GameTeam {
  return {
    id: seed.id,
    name: seed.name,
    short: seed.name.slice(0, 3).toUpperCase(),
    color: \`hsl(\${(seed.id * 137) % 360} 55% 42%)\`,
    logo: LOGO(seed.id),
    attack: seed.attack,
    defense: seed.defense,
    homeBoost: 1,
  };
}

export function nationalsByConfed(confed: ConfedCode): NationalSeed[] {
  return NATIONAL_TEAMS.filter((t) => t.confed === confed);
}

/** Seřazeno od nejsilnějšího (útok − obrana). */
export const NATIONAL_TEAMS: NationalSeed[] = [
${body}
];
`;

  writeFileSync(OUT, file, "utf8");
  console.log(`\n✓ zapsáno ${rows.length} reprezentací do ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
