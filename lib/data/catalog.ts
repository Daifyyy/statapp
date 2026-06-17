import type { League } from "@/lib/types";

/** Startovní rok sezóny dle data (API-Football: season = rok začátku). */
export function computeSeason(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;
}

/** Poslední dokončená sezóna (má kompletní data) + předchozí. */
export const CURRENT_SEASON = computeSeason();
export const PREVIOUS_SEASON = CURRENT_SEASON - 1;

/** Evropské poháry (TOP-3) pro cross-country kontext: UCL, UEL, UECL. */
export const EURO_LEAGUE_IDS = [2, 3, 848];

const leagueLogo = (id: number) =>
  `https://media.api-sports.io/football/leagues/${id}.png`;

/** Kurátorované top evropské klubové ligy (ID ověřena živě přes /leagues). */
export const CLUB_LEAGUES: League[] = [
  { id: 39, name: "Premier League", country: "Anglie", logoUrl: leagueLogo(39), kind: "CLUB_LEAGUE" },
  { id: 140, name: "La Liga", country: "Španělsko", logoUrl: leagueLogo(140), kind: "CLUB_LEAGUE" },
  { id: 135, name: "Serie A", country: "Itálie", logoUrl: leagueLogo(135), kind: "CLUB_LEAGUE" },
  { id: 78, name: "Bundesliga", country: "Německo", logoUrl: leagueLogo(78), kind: "CLUB_LEAGUE" },
  { id: 61, name: "Ligue 1", country: "Francie", logoUrl: leagueLogo(61), kind: "CLUB_LEAGUE" },
  { id: 94, name: "Primeira Liga", country: "Portugalsko", logoUrl: leagueLogo(94), kind: "CLUB_LEAGUE" },
  { id: 88, name: "Eredivisie", country: "Nizozemsko", logoUrl: leagueLogo(88), kind: "CLUB_LEAGUE" },
  { id: 40, name: "Championship", country: "Anglie", logoUrl: leagueLogo(40), kind: "CLUB_LEAGUE" },
  { id: 144, name: "Jupiler Pro League", country: "Belgie", logoUrl: leagueLogo(144), kind: "CLUB_LEAGUE" },
  { id: 203, name: "Süper Lig", country: "Turecko", logoUrl: leagueLogo(203), kind: "CLUB_LEAGUE" },
  { id: 345, name: "Fortuna Liga", country: "Česko", logoUrl: leagueLogo(345), kind: "CLUB_LEAGUE" },
  { id: 179, name: "Premiership", country: "Skotsko", logoUrl: leagueLogo(179), kind: "CLUB_LEAGUE" },
  { id: 197, name: "Super League 1", country: "Řecko", logoUrl: leagueLogo(197), kind: "CLUB_LEAGUE" },
  { id: 103, name: "Eliteserien", country: "Norsko", logoUrl: leagueLogo(103), kind: "CLUB_LEAGUE" },
  { id: 119, name: "Superliga", country: "Dánsko", logoUrl: leagueLogo(119), kind: "CLUB_LEAGUE" },
  { id: 106, name: "Ekstraklasa", country: "Polsko", logoUrl: leagueLogo(106), kind: "CLUB_LEAGUE" },
  { id: 218, name: "Bundesliga", country: "Rakousko", logoUrl: leagueLogo(218), kind: "CLUB_LEAGUE" },
  { id: 207, name: "Super League", country: "Švýcarsko", logoUrl: leagueLogo(207), kind: "CLUB_LEAGUE" },
];

/**
 * Konfederace jako vybíratelné „ligy". Národní týmy se táhnou dynamicky ze
 * soutěže `wcQualLeagueId` (WC kvalifikace) v dané sezóně. ID i sezóny ověřeny
 * živě přes /leagues (sezóny patří k cyklu MS 2026; aktualizovat při novém cyklu).
 */
export interface Confederation {
  id: number; // syntetické league id (9001+)
  name: string;
  code: string;
  wcQualLeagueId: number;
  season: number;
  /**
   * Týmy, které v kvalifikační soutěži nejsou, ale do konfederace patří – typicky
   * pořadatelé MS s automatickou kvalifikací (nehrají kvalifikaci, tak je seznam
   * týmů `wcQualLeagueId` nevrací). Doplní se do výběru ručně. (Cyklus MS 2026.)
   */
  extraTeams?: { id: number; name: string }[];
}

export const CONFEDERATIONS: Confederation[] = [
  { id: 9001, name: "Reprezentace – Evropa (UEFA)", code: "UEFA", wcQualLeagueId: 32, season: 2024 },
  { id: 9002, name: "Reprezentace – Jižní Amerika (CONMEBOL)", code: "CONMEBOL", wcQualLeagueId: 34, season: 2026 },
  // Pořadatelé MS 2026 (USA, Kanada, Mexiko) mají automatickou kvalifikaci → v seznamu
  // kvalifikace CONCACAF nejsou, doplňujeme je ručně.
  { id: 9003, name: "Reprezentace – Sev./Stř. Amerika (CONCACAF)", code: "CONCACAF", wcQualLeagueId: 31, season: 2026,
    extraTeams: [
      { id: 2384, name: "USA" },
      { id: 5529, name: "Canada" },
      { id: 16, name: "Mexico" },
    ] },
  { id: 9004, name: "Reprezentace – Afrika (CAF)", code: "CAF", wcQualLeagueId: 29, season: 2023 },
  { id: 9005, name: "Reprezentace – Asie (AFC)", code: "AFC", wcQualLeagueId: 30, season: 2026 },
  { id: 9006, name: "Reprezentace – Oceánie (OFC)", code: "OFC", wcQualLeagueId: 33, season: 2026 },
];

/**
 * Reprezentační turnaje (finálové), které sleduje predikční pipeline. Na rozdíl od
 * konfederací (kvalifikace, synthetic id 9001+) jde o reálná league id turnaje, ze
 * kterých se tahají fixtures; meta týmů se bere přímo z fixture (tým z libovolné
 * konfederace). Klient-safe (jen data) → sdílí ho pipeline i UI. WC finále = id 1.
 */
export const NATIONAL_TOURNAMENT_LEAGUE_IDS = [1];

export function isNationalTournamentLeague(leagueId: number): boolean {
  return NATIONAL_TOURNAMENT_LEAGUE_IDS.includes(leagueId);
}

/** URL loga týmu z jeho ID (stejný tvar jako API-Football `team.logo`). */
export const teamLogoUrl = (id: number) =>
  `https://media.api-sports.io/football/teams/${id}.png`;

export const NATIONAL_LEAGUES: League[] = CONFEDERATIONS.map((c) => ({
  id: c.id,
  name: c.name,
  country: "Mezinárodní",
  logoUrl: leagueLogo(c.wcQualLeagueId),
  kind: "NATIONAL_COMP",
  confederation: c.code,
}));

const CONFEDERATION_IDS = new Set(CONFEDERATIONS.map((c) => c.id));

export function isNationalLeague(leagueId: number): boolean {
  return CONFEDERATION_IDS.has(leagueId);
}

export function getConfederation(leagueId: number): Confederation | undefined {
  return CONFEDERATIONS.find((c) => c.id === leagueId);
}
