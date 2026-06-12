import type { DataSource, MatchStat, Team } from "@/lib/types";

/** Minimální počet evropských zápasů, aby se dal použít kontext pohárů. */
const MIN_EURO_MATCHES = 3;
/** Minimální počet soutěžních internacionálů, než se hlásí doplnění přáteláky. */
const MIN_COMPETITIVE_NATIONAL = 4;

export interface ResolvedSource {
  source: DataSource;
  sourceNote?: string;
  homeMatches: MatchStat[];
  awayMatches: MatchStat[];
}

/**
 * Rozhodne, ze kterých zápasů se pro daný pár týmů počítají statistiky.
 * Kluby: stejná liga → EURO poháry → fallback domácí liga.
 * Reprezentace: soutěžní internacionály (+ přáteláky jako doplnění vzorku).
 */
export function resolveSource(home: Team, away: Team): ResolvedSource {
  if (home.entityType === "NATIONAL" || away.entityType === "NATIONAL") {
    const competitiveCount = Math.min(
      countCompetitive(home.leagueMatches),
      countCompetitive(away.leagueMatches)
    );
    const sparse = competitiveCount < MIN_COMPETITIVE_NATIONAL;
    return {
      source: sparse ? "NATIONAL_FB" : "NATIONAL",
      sourceNote: sparse ? "Včetně přátelských zápasů" : undefined,
      homeMatches: home.leagueMatches,
      awayMatches: away.leagueMatches,
    };
  }

  // Oba kluby ve stejné domácí lize.
  if (home.leagueId === away.leagueId) {
    return {
      source: "LEAGUE",
      homeMatches: home.leagueMatches,
      awayMatches: away.leagueMatches,
    };
  }

  // Různé země → zkus společné evropské poháry (UCL/UEL/UECL).
  const homeEuro = home.euroMatches ?? [];
  const awayEuro = away.euroMatches ?? [];
  if (
    homeEuro.length >= MIN_EURO_MATCHES &&
    awayEuro.length >= MIN_EURO_MATCHES
  ) {
    return {
      source: "EURO_CUPS",
      homeMatches: homeEuro,
      awayMatches: awayEuro,
    };
  }

  // Fallback: data z domácí ligy s upozorněním.
  return {
    source: "FALLBACK",
    sourceNote: "Data z domácí ligy",
    homeMatches: home.leagueMatches,
    awayMatches: away.leagueMatches,
  };
}

function countCompetitive(matches: MatchStat[]): number {
  return matches.filter((m) => m.competitive).length;
}
