import type { MatchStat, Metric } from "@/lib/types";

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

const ATTACKING: Metric[] = ["GOALS_FOR", "CORNERS", "XG", "SHOTS"];

function metricMean(
  profile: TeamProfile,
  metric: Metric,
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
  isPreviousSeason?: boolean;
  date: Date;
  recencyFactor: number; // 1 = nejnovější, 0 = nejstarší
  includeXg?: boolean;
}

function buildMatch(
  rand: () => number,
  fixtureId: number,
  profile: TeamProfile,
  opts: MatchOpts
): MatchStat {
  const metrics: Partial<Record<Metric, number>> = {};
  const allMetrics: Metric[] = [
    "GOALS_FOR",
    "GOALS_AGAINST",
    "CORNERS",
    "FOULS",
    "SHOTS",
  ];
  if (opts.includeXg !== false) allMetrics.push("XG");

  for (const metric of allMetrics) {
    const mean = metricMean(profile, metric, opts.isHome, opts.recencyFactor);
    // jitter ±35 % kolem průměru
    const jitter = 0.65 + rand() * 0.7;
    const raw = mean * jitter;
    metrics[metric] =
      metric === "GOALS_FOR" || metric === "GOALS_AGAINST"
        ? Math.max(0, Math.round(raw))
        : Math.round(raw * 10) / 10;
  }

  return {
    fixtureId,
    date: opts.date.toISOString(),
    isHome: opts.isHome,
    isNeutral: opts.isNeutral ?? false,
    competitive: opts.competitive ?? true,
    isPreviousSeason: opts.isPreviousSeason ?? false,
    metrics,
  };
}

const DAY = 24 * 60 * 60 * 1000;

/** Vygeneruje klubové zápasy: minulá sezóna (30) + aktuální (14), střídavě D/V. */
export function generateClubMatches(
  teamId: number,
  profile: TeamProfile,
  now: Date = new Date()
): MatchStat[] {
  const rand = mulberry32(teamId * 7919);
  const matches: MatchStat[] = [];
  let fid = teamId * 1000;

  // Aktuální sezóna – 14 zápasů, nejnovější mají recencyFactor ~1.
  for (let i = 0; i < 14; i++) {
    const date = new Date(now.getTime() - i * 7 * DAY);
    matches.push(
      buildMatch(rand, fid++, profile, {
        isHome: i % 2 === 0,
        date,
        recencyFactor: 1 - i / 14,
      })
    );
  }
  // Minulá sezóna – 30 zápasů, recencyFactor 0 (forma se neuplatní).
  for (let i = 0; i < 30; i++) {
    const date = new Date(now.getTime() - (120 + i * 7) * DAY);
    matches.push(
      buildMatch(rand, fid++, profile, {
        isHome: i % 2 === 0,
        date,
        isPreviousSeason: true,
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
    const isNeutral = competitive && i % 5 === 0; // občas turnaj na neutrální půdě
    matches.push(
      buildMatch(rand, fid++, profile, {
        isHome: isNeutral ? false : i % 2 === 0,
        isNeutral,
        competitive,
        date,
        recencyFactor: 1 - i / total,
        includeXg: false, // reprezentace bez xG
      })
    );
  }
  return matches.sort((a, b) => b.date.localeCompare(a.date));
}
