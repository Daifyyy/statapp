import type { MatchStat, Metric } from "@/lib/types";
import { METRICS_BY_ENTITY } from "@/lib/types";

/** Sada metrik generovaná pro reprezentace (užší – viz METRICS_BY_ENTITY). */
const NATIONAL_METRICS = new Set<Metric>(METRICS_BY_ENTITY.NATIONAL);

/** Profil síly týmu – průměrné hodnoty metrik na zápas + modifikátory. */
export interface TeamProfile {
  GOALS_FOR: number;
  GOALS_AGAINST: number;
  CORNERS: number;
  FOULS: number;
  XG: number;
  SHOTS: number;
  /** Násobič ofenzivních metrik doma (>1 = silnější doma). */
  homeBoost: number;
  /** Násobič posledních zápasů (>1 vzestup, <1 pokles formy). */
  formTrend: number;
}

/** Deterministický PRNG (mulberry32) – stabilní data pro SSR i testy. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Metriky, které má TeamProfile přímo (ostatní se z nich odvozují). */
type BaseMetric =
  | "GOALS_FOR"
  | "GOALS_AGAINST"
  | "CORNERS"
  | "FOULS"
  | "XG"
  | "SHOTS";

const ATTACKING: BaseMetric[] = ["GOALS_FOR", "CORNERS", "XG", "SHOTS"];

function metricMean(
  profile: TeamProfile,
  metric: BaseMetric,
  isHome: boolean,
  recencyFactor: number
): number {
  let mean = profile[metric];
  if (isHome && ATTACKING.includes(metric)) mean *= profile.homeBoost;
  if (!isHome && ATTACKING.includes(metric)) mean /= profile.homeBoost;
  // Forma se promítá do nejnovějších zápasů (recencyFactor 0..1).
  mean *= 1 + (profile.formTrend - 1) * recencyFactor;
  return mean;
}

interface MatchOpts {
  isHome: boolean;
  isNeutral?: boolean;
  competitive?: boolean;
  season?: number;
  isBaseline?: boolean;
  date: Date;
  recencyFactor: number; // 1 = nejnovější, 0 = nejstarší
  /** Pokud zadáno, generují se jen tyto metriky (reprezentace mají užší sadu). */
  allowed?: Set<Metric>;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function buildMatch(
  rand: () => number,
  fixtureId: number,
  profile: TeamProfile,
  opts: MatchOpts
): MatchStat {
  const metrics: Partial<Record<Metric, number>> = {};
  const allow = (m: Metric) => !opts.allowed || opts.allowed.has(m);
  // jitter ±(spread/2) kolem 1; default ±35 %
  const jit = (spread = 0.7) => 1 - spread / 2 + rand() * spread;
  const set = (m: Metric, v: number, decimals = 1) => {
    if (!allow(m)) return;
    const f = 10 ** decimals;
    metrics[m] = Math.max(0, Math.round(v * f) / f);
  };

  // Základní metriky z profilu týmu.
  const baseMetrics: BaseMetric[] = [
    "GOALS_FOR",
    "GOALS_AGAINST",
    "CORNERS",
    "FOULS",
    "SHOTS",
    "XG",
  ];
  for (const metric of baseMetrics) {
    if (!allow(metric)) continue;
    const mean = metricMean(profile, metric, opts.isHome, opts.recencyFactor);
    const isGoals = metric === "GOALS_FOR" || metric === "GOALS_AGAINST";
    set(metric, mean * jit(), isGoals ? 0 : 1);
  }

  // Odvozené metriky ze střel / faulů (zachovají homeBoost i formu skrz SHOTS).
  const shots = metricMean(profile, "SHOTS", opts.isHome, opts.recencyFactor);
  const fouls = metrics.FOULS ?? profile.FOULS;
  set("SHOTS_ON_TARGET", shots * 0.4 * jit(0.4), 1);
  set("SHOTS_OFF_TARGET", shots * 0.35 * jit(0.4), 1);
  set("BLOCKED_SHOTS", shots * 0.22 * jit(0.5), 1);
  set("SHOTS_INSIDE_BOX", shots * 0.6 * jit(0.4), 1);
  set("SHOTS_OUTSIDE_BOX", shots * 0.4 * jit(0.4), 1);
  set("OFFSIDES", 1.8 * jit(0.9), 0);
  set("YELLOW_CARDS", fouls * 0.16 * jit(0.6), 0);
  set("RED_CARDS", rand() < 0.08 ? 1 : 0, 0);
  set("SAVES", (2.5 + profile.GOALS_AGAINST) * jit(0.5), 1);

  // Držení a přesnost přihrávek (v %, clamp 0–100), přihrávky odvozené od držení.
  const possession = clamp(50 + (shots - 13) * 1.4 + (rand() - 0.5) * 14, 32, 68);
  const passAcc = clamp(78 + (shots - 13) * 0.7 + (rand() - 0.5) * 6, 68, 93);
  const passesTotal = Math.round(380 * (possession / 50) * jit(0.3));
  set("POSSESSION", possession, 1);
  set("PASS_ACCURACY", passAcc, 1);
  set("PASSES_TOTAL", passesTotal, 0);
  set("PASSES_ACCURATE", (passesTotal * passAcc) / 100, 0);

  return {
    fixtureId,
    date: opts.date.toISOString(),
    isHome: opts.isHome,
    isNeutral: opts.isNeutral ?? false,
    competitive: opts.competitive ?? true,
    season: opts.season ?? 0,
    isBaseline: opts.isBaseline ?? false,
    metrics,
  };
}

const DAY = 24 * 60 * 60 * 1000;
// Mock sezóny: aktuální (forma) a minulá (baseline „minulá sezóna").
const MOCK_CURRENT = 2025;
const MOCK_PREVIOUS = 2024;

/** Vygeneruje klubové zápasy: minulá sezóna (30) + aktuální (14), střídavě D/V. */
export function generateClubMatches(
  teamId: number,
  profile: TeamProfile,
  now: Date = new Date()
): MatchStat[] {
  const rand = mulberry32(teamId * 7919);
  const matches: MatchStat[] = [];
  let fid = teamId * 1000;

  // Aktuální sezóna – 14 zápasů (forma: LAST10/LAST5), nejnovější recencyFactor ~1.
  for (let i = 0; i < 14; i++) {
    const date = new Date(now.getTime() - i * 7 * DAY);
    matches.push(
      buildMatch(rand, fid++, profile, {
        isHome: i % 2 === 0,
        date,
        season: MOCK_CURRENT,
        recencyFactor: 1 - i / 14,
      })
    );
  }
  // Minulá (baseline) sezóna – 30 zápasů, recencyFactor 0 (forma se neuplatní).
  for (let i = 0; i < 30; i++) {
    const date = new Date(now.getTime() - (120 + i * 7) * DAY);
    matches.push(
      buildMatch(rand, fid++, profile, {
        isHome: i % 2 === 0,
        date,
        season: MOCK_PREVIOUS,
        isBaseline: true,
        recencyFactor: 0,
      })
    );
  }
  return matches.sort((a, b) => b.date.localeCompare(a.date));
}

/** Vygeneruje pár evropských zápasů (UCL/UEL/UECL) – pro cross-country porovnání. */
export function generateEuroMatches(
  teamId: number,
  profile: TeamProfile,
  count: number,
  now: Date = new Date()
): MatchStat[] {
  const rand = mulberry32(teamId * 104729);
  const matches: MatchStat[] = [];
  let fid = teamId * 1000 + 500;
  for (let i = 0; i < count; i++) {
    const date = new Date(now.getTime() - (10 + i * 21) * DAY);
    matches.push(
      buildMatch(rand, fid++, profile, {
        isHome: i % 2 === 0,
        date,
        recencyFactor: 1 - i / Math.max(count, 1),
      })
    );
  }
  return matches.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Vygeneruje reprezentační zápasy za posledních ~24 měsíců:
 * mix kvalifikací/turnajů (competitive) a přáteláků, některé na neutrální půdě.
 */
export function generateNationalMatches(
  teamId: number,
  profile: TeamProfile,
  now: Date = new Date()
): MatchStat[] {
  const rand = mulberry32(teamId * 15485863);
  const matches: MatchStat[] = [];
  let fid = teamId * 1000;
  // ~20 zápasů rozložených po ~5 týdnech (reprezentační kalendář je řídký).
  const total = 20;
  for (let i = 0; i < total; i++) {
    const date = new Date(now.getTime() - i * 35 * DAY);
    const competitive = i % 3 !== 0; // ~2/3 soutěžních
    matches.push(
      buildMatch(rand, fid++, profile, {
        // Reprezentace bereme jako venue-neutrální (turnaje, neutrální půda) →
        // doma/venku u nich nedělíme; parita s realRepository.
        isHome: i % 2 === 0, // ponecháno pro generování metrik, do venue nevstupuje
        isNeutral: true,
        competitive,
        date,
        recencyFactor: 1 - i / total,
        allowed: NATIONAL_METRICS, // reprezentace mají užší sadu metrik
      })
    );
  }
  return matches.sort((a, b) => b.date.localeCompare(a.date));
}
