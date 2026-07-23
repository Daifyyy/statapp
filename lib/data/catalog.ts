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

/**
 * Začátek aktuálního přestupního okna. Dvě okna ročně: **zimní** (od 1. 1.) a **letní**
 * (od 1. 7.). Mezi okny i po uzavření vrací start posledního **otevřeného** okna → přestupy
 * „zůstanou" zobrazené, dokud nezačne další okno (kdy se nahradí). Slouží k filtru přestupů
 * (zobrazení i prune) – viz `lib/data/transfers.ts`.
 */
export function transferWindowStart(now: Date = new Date()): Date {
  const y = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1–12
  return month >= 7 ? new Date(Date.UTC(y, 6, 1)) : new Date(Date.UTC(y, 0, 1));
}

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
 * Reprezentační soutěže sledované predikční pipeline. Na rozdíl od konfederací
 * (kvalifikace, synthetic id 9001+) jde o reálná league id soutěže, ze kterých se
 * tahají fixtures; meta týmů se bere přímo z fixture (tým z libovolné konfederace).
 * Klient-safe (jen data) → sdílí ho pipeline i UI. Mimo sezónu vrací API prázdno.
 *
 * Dvě kategorie podle toho, jak se staví tým pro predikci:
 *  - **Finálové turnaje** (neutrální půda) → venue-neutrální build (vše do TOTAL,
 *    bez domácí výhody): MS=1, EURO=4, Copa América=9, AFCON=6, Asian Cup=7, Gold Cup=22.
 *  - **Soutěže s reálným domácí/venku** (Liga národů) → build s venue splitem
 *    (HOME/AWAY z fixtures → predikce zachytí domácí výhodu): UEFA NL=5, CONCACAF NL=536.
 */
export const NATIONAL_TOURNAMENT_LEAGUE_IDS = [1, 4, 9, 6, 7, 22];
export const NATIONAL_HOME_AWAY_LEAGUE_IDS = [5, 536];

/** Všechna reprezentační league id sledovaná predikcí (turnaje + home/away soutěže). */
export const ALL_NATIONAL_PREDICTION_LEAGUE_IDS = [
  ...NATIONAL_TOURNAMENT_LEAGUE_IDS,
  ...NATIONAL_HOME_AWAY_LEAGUE_IDS,
];

/** API-Football: reprezentační přáteláky. */
export const FRIENDLIES_LEAGUE_ID = 10;

/**
 * Soutěže, ze kterých se skládá **historie pro globální reprezentační ratingy**: turnaje,
 * Liga národů, kvalifikace všech konfederací a **přáteláky**. Přáteláky tam patří: jsou to
 * hlavně ony, co propojují konfederace, takže bez nich by síly napříč nimi nebyly srovnatelné
 * (viz `NATIONAL_RATING_OPTIONS`). Sdílí `npm run backtest-national` i produkce.
 */
export const NATIONAL_HISTORY_LEAGUE_IDS = [
  ...NATIONAL_TOURNAMENT_LEAGUE_IDS,
  ...NATIONAL_HOME_AWAY_LEAGUE_IDS,
  ...CONFEDERATIONS.map((c) => c.wcQualLeagueId),
  FRIENDLIES_LEAGUE_ID,
];

/** Hraje se soutěž na neutrální půdě? (Turnaje ano; kvalifikace a Liga národů ne.) */
export function isNeutralNationalLeague(leagueId: number): boolean {
  return (
    NATIONAL_TOURNAMENT_LEAGUE_IDS.includes(leagueId) &&
    !NATIONAL_HOME_AWAY_LEAGUE_IDS.includes(leagueId)
  );
}

/** Je to reprezentační soutěž (jakákoli) – pipeline routing + UI (skrytí prokliku). */
export function isNationalTournamentLeague(leagueId: number): boolean {
  return ALL_NATIONAL_PREDICTION_LEAGUE_IDS.includes(leagueId);
}

/**
 * Klubové ligy zobrazované v „Zápasy" (Program/Výsledky) a v Tipovačce – **užší**
 * podmnožina `CLUB_LEAGUES` (Top 8 UEFA + Fortuna liga, ČR), ne všech 18. Predikce
 * (`PREDICTION_LEAGUES` v `predictions.ts`) běží nad VŠEMI 18 ligami – tenhle seznam
 * je jen o tom, co appka NABÍZÍ k prokliku/tipování v denním seznamu, aby Program
 * neslibovat klikací zápas z ligy, kterou uživatel v UI nechce vidět denně. Vědomě
 * ODDĚLENO od `PREDICTION_LEAGUES` (dřív byly jeden zdroj pravdy → buď appka nabízela
 * moc lig denně, nebo model počítal málo lig; potřeby jsou různé).
 */
export const PROGRAM_CLUB_LEAGUE_IDS = [39, 140, 135, 78, 61, 94, 88, 144, 345];

/** Je klubová liga v užším seznamu pro Zápasy/Tipovačku (ne ve všech 18 `CLUB_LEAGUES`)? */
export function isProgramClubLeague(leagueId: number): boolean {
  return PROGRAM_CLUB_LEAGUE_IDS.includes(leagueId);
}

/**
 * Ligy zobrazované v záložce „Zápasy" (denní seznam) a Tipovačce: užší klubový seznam
 * (`PROGRAM_CLUB_LEAGUE_IDS`) + reprezentační soutěže. Jeden zdroj pravdy pro filtr
 * `/fixtures?date=`.
 */
export const FIXTURE_LIST_LEAGUE_IDS = [
  ...PROGRAM_CLUB_LEAGUE_IDS,
  ...ALL_NATIONAL_PREDICTION_LEAGUE_IDS,
];

/** Má soutěž reálné domácí/venku (Liga národů) → build s venue splitem (ne neutrální)? */
export function isNationalHomeAwayLeague(leagueId: number): boolean {
  return NATIONAL_HOME_AWAY_LEAGUE_IDS.includes(leagueId);
}

/** URL loga týmu z jeho ID (stejný tvar jako API-Football `team.logo`). */
export const teamLogoUrl = (id: number) =>
  `https://media.api-sports.io/football/teams/${id}.png`;

/** URL loga ligy/soutěže z jejího ID (stejný tvar jako API-Football `league.logo`). */
export const leagueLogoUrl = (id: number) =>
  `https://media.api-sports.io/football/leagues/${id}.png`;

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

const ALL_LEAGUES_BY_ID = new Map<number, League>(
  [...CLUB_LEAGUES, ...NATIONAL_LEAGUES].map((l) => [l.id, l])
);

// Kolikrát se dané jméno v katalogu opakuje (dnes: „Bundesliga" pro Německo i Rakousko).
const NAME_COUNTS = new Map<string, number>();
for (const l of [...CLUB_LEAGUES, ...NATIONAL_LEAGUES]) {
  NAME_COUNTS.set(l.name, (NAME_COUNTS.get(l.name) ?? 0) + 1);
}

/**
 * Zobrazovaný název ligy – přidá zemi v závorce, ALE JEN když je název v katalogu
 * dvojznačný (dnes jen obě „Bundesligy"). Ostatní ligy zůstávají beze změny (kompaktnější
 * seznamy), disambiguace se řeší jen tam, kde je skutečně potřeba.
 */
export function leagueDisplayName(league: Pick<League, "name" | "country">): string {
  const count = NAME_COUNTS.get(league.name) ?? 1;
  return count > 1 ? `${league.name} (${league.country})` : league.name;
}

/**
 * Kurátorovaný název ligy (`CLUB_LEAGUES`/`NATIONAL_LEAGUES`, disambiguovaný přes
 * `leagueDisplayName`), fallback na syrový název z API pro neznámé ID. Jeden zdroj pravdy
 * pro název ligy napříč Zápasy/Tipovačkou (dřív braly `f.league.name` přímo z živé
 * odpovědi API-Football) a Porovnáním/Tabulkami (braly `catalog.ts`) – ty se pro stejné
 * `leagueId` mohly lišit.
 */
export function catalogLeagueName(leagueId: number, fallback: string): string {
  const league = ALL_LEAGUES_BY_ID.get(leagueId);
  return league ? leagueDisplayName(league) : fallback;
}
