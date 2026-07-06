// Ligový kontext hry: nabízený pool lig, prestiž (pro reputaci/job market),
// evropské poháry a sestup jako HODNOCENÍ sezóny (labely) – žádná zvlášť hraná soutěž.
// Prahy se ladí tady; čisté funkce (testovatelné).

import type { EuropeSpot, GameTeam, Objective } from "./types";

/** Ligy nabízené ve hře (Top-5 + pár dalších). id = reálné league id z katalogu. */
export const GAME_LEAGUES: {
  id: number;
  name: string;
  country: string;
  /** Prestiž ligy 0–100 – základ prestiže týmů (job market). */
  prestige: number;
}[] = [
  { id: 39, name: "Premier League", country: "Anglie", prestige: 100 },
  { id: 140, name: "La Liga", country: "Španělsko", prestige: 94 },
  { id: 135, name: "Serie A", country: "Itálie", prestige: 90 },
  { id: 78, name: "Bundesliga", country: "Německo", prestige: 90 },
  { id: 61, name: "Ligue 1", country: "Francie", prestige: 80 },
  { id: 94, name: "Primeira Liga", country: "Portugalsko", prestige: 66 },
  { id: 88, name: "Eredivisie", country: "Nizozemsko", prestige: 64 },
  { id: 144, name: "Jupiler Pro League", country: "Belgie", prestige: 58 },
  { id: 179, name: "Premiership", country: "Skotsko", prestige: 52 },
  { id: 218, name: "Bundesliga", country: "Rakousko", prestige: 50 },
  { id: 197, name: "Super League", country: "Řecko", prestige: 50 },
  { id: 345, name: "Fortuna Liga", country: "Česko", prestige: 44 },
];

/** Fiktivní liga (mock režim / bez API). */
export const MOCK_LEAGUE = { id: 0, name: "Fiktivní liga", country: "", prestige: 55 };

export function leaguePrestige(leagueId: number): number {
  if (leagueId === MOCK_LEAGUE.id) return MOCK_LEAGUE.prestige;
  return GAME_LEAGUES.find((l) => l.id === leagueId)?.prestige ?? 50;
}

export function leagueName(leagueId: number): string {
  if (leagueId === MOCK_LEAGUE.id) return MOCK_LEAGUE.name;
  return GAME_LEAGUES.find((l) => l.id === leagueId)?.name ?? "Liga";
}

/**
 * Kurátorovaný UEFA access list per liga: které místo vede do kterého poháru (a zda
 * do ZÁKLADNÍ fáze nebo PŘEDKOLA) + kolik posledních míst sestupuje. UEFA klíč není
 * v API-Football (řídí se koeficienty) → udržuje se ručně (odpovídá ~2025/26). Menší
 * ligy mají typicky jen předkola (mistr do LM přes předkolo, ne přímo do skupiny).
 */
interface LeagueAccess {
  /** Umístění → evropská příčka (jen místa, která do Evropy vedou). */
  slots: { rank: number; spot: EuropeSpot }[];
  /** Kolik posledních míst sestupuje. */
  relegBottom: number;
}

const LEAGUE_ACCESS: Record<number, LeagueAccess> = {
  // Top-4 koeficientové ligy: 1.–4. rovnou do ligové fáze LM.
  39: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 }, // Anglie
  140: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 }, // Španělsko
  135: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 }, // Itálie
  78: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 }, // Německo
  // Francie: 1.–2. do ligové fáze, 3. předkolo LM, 4. EL, 5. EKL.
  61: { slots: euro([["UCL", 2], ["UCL_Q", 1], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 },
  // Portugalsko: mistr do ligové fáze, 2. předkolo LM, 3. EL, 4. EKL předkolo.
  94: { slots: euro([["UCL", 1], ["UCL_Q", 1], ["UEL", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Nizozemsko: mistr do ligové fáze, 2. předkolo LM, 3. EL předkolo, 4. EKL předkolo.
  88: { slots: euro([["UCL", 1], ["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Belgie: mistr do předkola LM, 2. předkolo EL, 3. předkolo EKL.
  144: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 3 },
  // Skotsko: mistr předkolo LM, 2. předkolo EL, 3. předkolo EKL.
  179: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 1 },
  // Rakousko: mistr předkolo LM, 2. předkolo EL, 3. předkolo EKL.
  218: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Řecko: mistr předkolo LM, 2. předkolo EL, 3. předkolo EKL.
  197: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Česko (Fortuna liga): mistr PŘEDKOLO LM, 2. předkolo EL, 3. předkolo EKL.
  345: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Fiktivní liga (mock): jednoduchý generický klíč.
  0: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 },
};

/** Rozbalí kompaktní zápis [[spot, počet], …] na sekvenci míst od 1. dolů. */
function euro(spec: [EuropeSpot, number][]): { rank: number; spot: EuropeSpot }[] {
  const out: { rank: number; spot: EuropeSpot }[] = [];
  let rank = 1;
  for (const [spot, count] of spec) {
    for (let i = 0; i < count; i++) out.push({ rank: rank++, spot });
  }
  return out;
}

function accessFor(leagueId: number, size: number): LeagueAccess {
  return (
    LEAGUE_ACCESS[leagueId] ?? {
      slots: euro([["UCL", 1], ["UECL_Q", 2]]),
      relegBottom: size >= 18 ? 3 : 2,
    }
  );
}

/** Vyhodnotí konec sezóny: mistr / evropská příčka (vč. předkola) / sestup. */
export function evaluateSeason(
  rank: number,
  size: number,
  leagueId: number
): { champion: boolean; europe: EuropeSpot; relegated: boolean } {
  const a = accessFor(leagueId, size);
  return {
    champion: rank === 1,
    europe: a.slots.find((s) => s.rank === rank)?.spot ?? "NONE",
    relegated: rank > size - a.relegBottom,
  };
}

export const EUROPE_LABEL: Record<EuropeSpot, string> = {
  UCL: "Liga mistrů",
  UCL_Q: "Liga mistrů (předkolo)",
  UEL: "Evropská liga",
  UEL_Q: "Evropská liga (předkolo)",
  UECL: "Konferenční liga",
  UECL_Q: "Konferenční liga (předkolo)",
  NONE: "",
};

/** Hlavní odznak sezóny (mistr + evropská příčka / sestup / střed tabulky). */
export function seasonHeadline(s: {
  champion: boolean;
  europe: EuropeSpot;
  relegated: boolean;
}): string {
  if (s.relegated) return "Sestup";
  const euroLabel = EUROPE_LABEL[s.europe];
  if (s.champion) return euroLabel ? `Mistr 🏆 · ${euroLabel}` : "Mistr 🏆";
  return euroLabel || "Střed tabulky";
}

export function seasonTone(s: {
  champion: boolean;
  europe: EuropeSpot;
  relegated: boolean;
}): "good" | "ok" | "bad" {
  if (s.relegated) return "bad";
  if (s.champion || s.europe !== "NONE") return "good";
  return "ok";
}

/** Skóre síly týmu (útok − obrana). Vyšší = lepší. */
export function teamStrengthScore(team: GameTeam): number {
  return team.attack - team.defense;
}

/**
 * Hvězdy 1–5 dle PERCENTILU síly týmu v jeho lize (ne absolutní práh). Nejsilnější tým
 * ligy ~5★, nejslabší ~1★, střed ~3★ – rozprostřené i pro slabé ligy.
 */
export function leagueStars(team: GameTeam, league: GameTeam[]): number {
  const mine = teamStrengthScore(team);
  const below = league.filter((t) => teamStrengthScore(t) < mine).length;
  const pct = league.length > 1 ? below / (league.length - 1) : 0.5; // 0 (dno) .. 1 (top)
  return Math.max(1, Math.min(5, Math.round(pct * 4) + 1));
}

/**
 * Sezónní cíl vedení dle očekávaného umístění (síla týmu v lize) a UEFA/sestupového
 * klíče ligy. Splnění (yourRank ≤ targetRank) dá bonus k reputaci.
 */
export function seasonObjective(team: GameTeam, league: GameTeam[], leagueId: number): Objective {
  const size = league.length;
  const sorted = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
  const exp = sorted.findIndex((t) => t.id === team.id) + 1;
  const a = accessFor(leagueId, size);
  const euroSlots = Math.max(1, a.slots.length);
  const safe = size - a.relegBottom; // poslední bezpečné místo
  if (exp === 1) return { kind: "title", targetRank: 1, text: "Vyhraj ligu 🏆" };
  if (exp <= euroSlots)
    return {
      kind: "europe",
      targetRank: euroSlots,
      text: `Probojuj se do Evropy (do ${euroSlots}. místa)`,
    };
  if (exp > safe)
    return { kind: "survival", targetRank: safe, text: "Zachraň se — vyhni se sestupu" };
  return { kind: "midtable", targetRank: exp, text: `Potvrď sílu — skonči do ${exp}. místa` };
}

/**
 * Prestiž týmu 0–100 = prestiž ligy posunutá podle síly týmu v rámci ligy.
 * Top tým velké ligy ~ 95+, průměr ~ 75, dno ~ 60; slabá liga posune celý rozsah dolů.
 */
export function teamPrestige(
  team: GameTeam,
  leagueId: number,
  league: GameTeam[]
): number {
  const scores = league.map(teamStrengthScore).sort((a, b) => a - b);
  const min = scores[0];
  const max = scores[scores.length - 1];
  const range = max - min || 1;
  const pct = (teamStrengthScore(team) - min) / range; // 0 (dno) .. 1 (top)
  const base = leaguePrestige(leagueId);
  return clamp(Math.round(base - 18 + pct * 34), 0, 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
