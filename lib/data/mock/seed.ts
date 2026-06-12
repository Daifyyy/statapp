import type { League, Team } from "@/lib/types";
import {
  generateClubMatches,
  generateEuroMatches,
  generateNationalMatches,
  type TeamProfile,
} from "./generate";

const teamLogo = (id: number) =>
  `https://media.api-sports.io/football/teams/${id}.png`;
const leagueLogo = (id: number) =>
  `https://media.api-sports.io/football/leagues/${id}.png`;

export const PREMIER_LEAGUE = 39;
export const LA_LIGA = 140;
export const NATIONALS = 9001; // syntetická „liga" pro výběr reprezentací

export const LEAGUES: League[] = [
  {
    id: PREMIER_LEAGUE,
    name: "Premier League",
    country: "Anglie",
    logoUrl: leagueLogo(PREMIER_LEAGUE),
    kind: "CLUB_LEAGUE",
  },
  {
    id: LA_LIGA,
    name: "La Liga",
    country: "Španělsko",
    logoUrl: leagueLogo(LA_LIGA),
    kind: "CLUB_LEAGUE",
  },
  {
    id: NATIONALS,
    name: "Reprezentace (UEFA)",
    country: "Evropa",
    logoUrl: leagueLogo(960),
    kind: "NATIONAL_COMP",
    confederation: "UEFA",
  },
];

interface ClubSeed {
  id: number;
  name: string;
  country: string;
  leagueId: number;
  profile: TeamProfile;
  euro?: number; // počet evropských zápasů (hraje-li v Evropě)
}

const CLUBS: ClubSeed[] = [
  // Premier League
  { id: 50, name: "Manchester City", country: "Anglie", leagueId: PREMIER_LEAGUE, euro: 6,
    profile: p(2.4, 0.9, 6.5, 9, 2.2, 16, 1.25, 1.15) },
  { id: 42, name: "Arsenal", country: "Anglie", leagueId: PREMIER_LEAGUE, euro: 6,
    profile: p(2.0, 1.0, 6.0, 10, 1.8, 14, 1.2, 1.05) },
  { id: 40, name: "Liverpool", country: "Anglie", leagueId: PREMIER_LEAGUE, euro: 5,
    profile: p(2.2, 1.2, 7.0, 9, 2.0, 15, 1.3, 0.78) },
  { id: 49, name: "Chelsea", country: "Anglie", leagueId: PREMIER_LEAGUE, euro: 4,
    profile: p(1.6, 1.3, 5.5, 11, 1.5, 13, 1.15, 1.0) },
  { id: 33, name: "Manchester United", country: "Anglie", leagueId: PREMIER_LEAGUE,
    profile: p(1.5, 1.4, 5.0, 11, 1.4, 12, 1.1, 0.9) },
  { id: 45, name: "Everton", country: "Anglie", leagueId: PREMIER_LEAGUE,
    profile: p(1.0, 1.75, 4.5, 12, 0.9, 10, 1.1, 0.95) },
  // La Liga
  { id: 541, name: "Real Madrid", country: "Španělsko", leagueId: LA_LIGA, euro: 6,
    profile: p(2.3, 0.9, 6.0, 10, 2.1, 15, 1.2, 1.1) },
  { id: 529, name: "Barcelona", country: "Španělsko", leagueId: LA_LIGA, euro: 6,
    profile: p(2.1, 1.1, 6.5, 9, 1.9, 15, 1.25, 1.0) },
  { id: 530, name: "Atlético Madrid", country: "Španělsko", leagueId: LA_LIGA, euro: 5,
    profile: p(1.6, 0.8, 5.0, 12, 1.4, 12, 1.15, 1.0) },
  { id: 536, name: "Sevilla", country: "Španělsko", leagueId: LA_LIGA, euro: 4,
    profile: p(1.2, 1.5, 4.5, 12, 1.1, 11, 1.1, 0.85) },
];

interface NationalSeed {
  id: number;
  name: string;
  profile: TeamProfile;
}

const NATIONAL_TEAMS: NationalSeed[] = [
  { id: 2, name: "Francie", profile: p(2.0, 0.8, 5.5, 11, 0, 14, 1.15, 1.05) },
  { id: 27, name: "Portugalsko", profile: p(2.1, 0.9, 6.0, 10, 0, 14, 1.1, 1.0) },
  { id: 10, name: "Anglie", profile: p(1.9, 0.8, 5.5, 10, 0, 13, 1.15, 0.95) },
  { id: 9, name: "Španělsko", profile: p(2.0, 0.9, 6.0, 9, 0, 14, 1.1, 1.1) },
  { id: 25, name: "Německo", profile: p(1.7, 1.2, 5.0, 11, 0, 13, 1.1, 1.2) },
  { id: 768, name: "Itálie", profile: p(1.4, 0.9, 5.0, 12, 0, 12, 1.1, 0.9) },
];

function p(
  GOALS_FOR: number, GOALS_AGAINST: number, CORNERS: number, FOULS: number,
  XG: number, SHOTS: number, homeBoost: number, formTrend: number
): TeamProfile {
  return { GOALS_FOR, GOALS_AGAINST, CORNERS, FOULS, XG, SHOTS, homeBoost, formTrend };
}

/** Sestaví všechny týmy s vygenerovanými zápasy (vázáno na referenční datum). */
export function buildTeams(now: Date = new Date()): Team[] {
  const clubs: Team[] = CLUBS.map((c) => ({
    id: c.id,
    name: c.name,
    logoUrl: teamLogo(c.id),
    country: c.country,
    entityType: "CLUB",
    leagueId: c.leagueId,
    leagueMatches: generateClubMatches(c.id, c.profile, now),
    euroMatches: c.euro
      ? generateEuroMatches(c.id, c.profile, c.euro, now)
      : undefined,
  }));

  const nationals: Team[] = NATIONAL_TEAMS.map((n) => ({
    id: n.id,
    name: n.name,
    logoUrl: teamLogo(n.id),
    country: n.name,
    entityType: "NATIONAL",
    leagueId: NATIONALS,
    leagueMatches: generateNationalMatches(n.id, n.profile, now),
  }));

  return [...clubs, ...nationals];
}
