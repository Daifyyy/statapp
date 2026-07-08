// Ligový kontext hry: nabízený pool lig, prestiž (pro reputaci/job market),
// evropské poháry a sestup jako HODNOCENÍ sezóny (labely) – žádná zvlášť hraná soutěž.
// Prahy se ladí tady; čisté funkce (testovatelné).
//
// ZNÁMÉ ZJEDNODUŠENÍ: sezóna se vždy simuluje jako plochá dvoukolová liga (round-robin).
// Některé reálné ligy v GAME_LEAGUES ve skutečnosti nehrají čistou tabulku (např. belgická
// Jupiler Pro League má po základní části play-off o titul/Evropu/sestup) – tahle hra tenhle
// split-formát nemodeluje, jen vyhodnotí finální pořadí ploché tabulky přes
// evaluateSeason/deriveLeagueAccess. Vědomý kompromis pro jednoduchost, ne bug.

import { PRESTIGE_SCALE, PRESTIGE_SHIFT, PROMOTION_PUSH_GAP } from "./balance";
import type { EuropeSpot, GameTeam, LeagueAccess, Objective } from "./types";

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

/**
 * Druhé ligy navázané na nejvyšší soutěž (reálný sestup/postup). Jen velké ligy s
 * kvalitními daty (Top-5) – menší země 2. ligu nemodelují (sestup = vyhazov → job market).
 * `promoSpots` = kolik prvních míst postupuje zpět nahoru (auto-postup, bez play-off).
 * `firstTierId` = nadřazená nejvyšší liga. Prestiž je nižší než u nejvyšší ligy → 2. liga
 * zároveň slouží jako přirozené „dno" pro pojistku job marketu (`MIN_HIREABLE_PRESTIGE`).
 */
export interface SecondTier {
  id: number;
  name: string;
  country: string;
  prestige: number;
  promoSpots: number;
  firstTierId: number;
}

export const SECOND_TIERS: SecondTier[] = [
  { id: 40, name: "Championship", country: "Anglie", prestige: 62, promoSpots: 2, firstTierId: 39 },
  { id: 141, name: "LaLiga 2", country: "Španělsko", prestige: 56, promoSpots: 2, firstTierId: 140 },
  { id: 136, name: "Serie B", country: "Itálie", prestige: 54, promoSpots: 2, firstTierId: 135 },
  { id: 79, name: "2. Bundesliga", country: "Německo", prestige: 56, promoSpots: 2, firstTierId: 78 },
  { id: 62, name: "Ligue 2", country: "Francie", prestige: 48, promoSpots: 2, firstTierId: 61 },
];

/** Id všech modelovaných 2. lig (pro allowlist API routy). */
export const SECOND_TIER_IDS = SECOND_TIERS.map((t) => t.id);

/** 2. liga navázaná na danou nejvyšší ligu (nebo undefined = malá liga bez 2. ligy). */
export function secondTierOf(firstTierId: number): SecondTier | undefined {
  return SECOND_TIERS.find((t) => t.firstTierId === firstTierId);
}

/** Nejvyšší liga nad danou 2. ligou (nebo undefined když leagueId není 2. liga). */
export function firstTierOf(secondTierId: number): number | undefined {
  return SECOND_TIERS.find((t) => t.id === secondTierId)?.firstTierId;
}

/** Je leagueId modelovaná 2. liga? */
export function isSecondTier(leagueId: number): boolean {
  return SECOND_TIERS.some((t) => t.id === leagueId);
}

/** Kolik prvních míst 2. ligy postupuje (0 = není to 2. liga). */
function promoSpotsOf(leagueId: number): number {
  return SECOND_TIERS.find((t) => t.id === leagueId)?.promoSpots ?? 0;
}

export function leaguePrestige(leagueId: number): number {
  if (leagueId === MOCK_LEAGUE.id) return MOCK_LEAGUE.prestige;
  const top = GAME_LEAGUES.find((l) => l.id === leagueId);
  if (top) return top.prestige;
  return SECOND_TIERS.find((t) => t.id === leagueId)?.prestige ?? 50;
}

export function leagueName(leagueId: number): string {
  if (leagueId === MOCK_LEAGUE.id) return MOCK_LEAGUE.name;
  const top = GAME_LEAGUES.find((l) => l.id === leagueId);
  if (top) return top.name;
  return SECOND_TIERS.find((t) => t.id === leagueId)?.name ?? "Liga";
}

/**
 * FALLBACK kurátorovaný UEFA access list per liga: které místo vede do kterého poháru
 * (a zda do ZÁKLADNÍ fáze nebo PŘEDKOLA) + kolik posledních míst sestupuje. Používá se
 * jen když se nepodaří odvodit skutečný klíč z reálné sezóny (`deriveLeagueAccess` v
 * lib/data/standings.ts, ze zápasového pole `description` v odpovědi API-Football) –
 * typicky mock režim nebo výpadek dat. UEFA klíč se řídí koeficienty a rok od roku se
 * mění → tahle tabulka je jen přibližná snímek (~2025/26), ne zdroj pravdy.
 */
const LEAGUE_ACCESS: Record<number, LeagueAccess> = {
  // Top-4 koeficientové ligy: 1.–4. rovnou do ligové fáze LM. Sestup 3 přímo (20 týmů).
  39: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 }, // Anglie
  140: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 }, // Španělsko
  135: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 3 }, // Itálie
  // Německo (18): 2 přímo, 16. baráž → baráž nepočítáme jako jistý sestup.
  78: { slots: euro([["UCL", 4], ["UEL", 1], ["UECL", 1]]), relegBottom: 2 },
  // Francie (18): 1.–2. do ligové fáze, 3. předkolo LM, 4. EL, 5. EKL. Sestup 2 + baráž.
  61: { slots: euro([["UCL", 2], ["UCL_Q", 1], ["UEL", 1], ["UECL", 1]]), relegBottom: 2 },
  // Portugalsko (18): mistr do ligové fáze, 2. předkolo LM, 3. EL, 4. EKL předkolo.
  94: { slots: euro([["UCL", 1], ["UCL_Q", 1], ["UEL", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Nizozemsko (18): mistr do ligové fáze, 2. předkolo LM, 3. EL předkolo, 4. EKL předkolo.
  // Sestup: 17.–18. přímo, 16. baráž (ověřeno `npm run audit-leagues`).
  88: { slots: euro([["UCL", 1], ["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Belgie (16, nadstavba): mistr předkolo LM, 2. předkolo EL, 3. předkolo EKL. Sestup 1 + baráž.
  144: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 1 },
  // Skotsko (12, nadstavba): mistr předkolo LM, 2. předkolo EL, 3. předkolo EKL. 12. přímo, 11. baráž.
  179: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 1 },
  // Rakousko (12, nadstavba): mistr předkolo LM, 2. předkolo EL, 3. předkolo EKL. Poslední přímo.
  218: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 1 },
  // Řecko (14, nadstavba): mistr předkolo LM, 2. předkolo EL, 3. předkolo EKL.
  197: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 2 },
  // Česko (16, nadstavba): mistr PŘEDKOLO LM, 2. předkolo EL, 3. předkolo EKL.
  // Sestup: poslední přímo, 15. baráž → 1.
  345: { slots: euro([["UCL_Q", 1], ["UEL_Q", 1], ["UECL_Q", 1]]), relegBottom: 1 },

  // ── 2. ligy (evropské sloty se u nich stejně vynucují na NONE v `evaluateSeason`;
  // podstatný je jen `relegBottom`, postup řeší `promoSpots` v SECOND_TIERS). ──
  40: { slots: [], relegBottom: 3 }, // Championship (24)
  141: { slots: [], relegBottom: 4 }, // LaLiga 2 (22)
  136: { slots: [], relegBottom: 3 }, // Serie B (20)
  79: { slots: [], relegBottom: 2 }, // 2. Bundesliga (18): 2 přímo + baráž
  62: { slots: [], relegBottom: 2 }, // Ligue 2 (18): 2 přímo + baráž

  // Fiktivní liga (mock, 20 týmů): jednoduchý generický klíč.
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

/** Kurátorovaný klíč ligy (bez slučování s odvozeným) – pro audit skript. */
export function curatedAccess(leagueId: number): LeagueAccess | null {
  return LEAGUE_ACCESS[leagueId] ?? null;
}

/** Access key s jistotou, že `relegBottom` je číslo (po sloučení s fallbackem). */
type ResolvedAccess = { slots: { rank: number; spot: EuropeSpot }[]; relegBottom: number };

/**
 * Sloučí odvozený klíč (z reálné sezóny) s kurátorovaným fallbackem **po polích**, ne
 * all-or-nothing. Ligy s nadstavbou dají odvodit evropské sloty, ale ne sestup
 * (`relegBottom: null`) – dřív takový override zkratoval fallback a nikdo nesestupoval.
 */
function accessFor(
  leagueId: number,
  size: number,
  override?: LeagueAccess | null
): ResolvedAccess {
  const curated: ResolvedAccess = LEAGUE_ACCESS[leagueId]
    ? {
        slots: LEAGUE_ACCESS[leagueId].slots,
        relegBottom: LEAGUE_ACCESS[leagueId].relegBottom ?? (size >= 18 ? 3 : 2),
      }
    : { slots: euro([["UCL", 1], ["UECL_Q", 2]]), relegBottom: size >= 18 ? 3 : 2 };
  if (!override) return curated;
  return {
    slots: override.slots.length ? override.slots : curated.slots,
    relegBottom: override.relegBottom ?? curated.relegBottom,
  };
}

/**
 * Vyhodnotí konec sezóny: mistr / evropská příčka (vč. předkola) / sestup.
 * `override` = access key odvozený z reálné sezóny (`SeasonState.leagueAccess`); bez
 * něj (mock/neznámá liga) se použije kurátorovaný fallback `LEAGUE_ACCESS`.
 */
export function evaluateSeason(
  rank: number,
  size: number,
  leagueId: number,
  override?: LeagueAccess | null
): { champion: boolean; europe: EuropeSpot; relegated: boolean; promoted: boolean } {
  const a = accessFor(leagueId, size, override);
  const second = isSecondTier(leagueId);
  return {
    champion: rank === 1,
    // Z 2. ligy se do Evropy nepostupuje → vždy NONE (jen postup/sestup).
    europe: second ? "NONE" : a.slots.find((s) => s.rank === rank)?.spot ?? "NONE",
    relegated: rank > size - a.relegBottom,
    promoted: second && rank <= promoSpotsOf(leagueId),
  };
}

/**
 * Přechod do další sezóny podle výsledku a úrovně ligy:
 * - 2. liga + postupová zóna → `up` (do nejvyšší ligy),
 * - 2. liga + sestupová zóna → `sacked` (3. ligu nemodelujeme → vyhazov),
 * - nejvyšší liga + sestup + existuje 2. liga → `down`,
 * - nejvyšší liga + sestup bez modelované 2. ligy (malé ligy) → `sacked`,
 * - jinak → `stay` (pokračuj se stejným klubem, drift ratingů).
 * Čistá funkce; fetch cílové ligy dělá až UI.
 */
export type Transition =
  | { type: "stay" }
  | { type: "up"; leagueId: number; leagueName: string }
  | { type: "down"; leagueId: number; leagueName: string }
  | { type: "sacked" };

export function nextTransition(
  summary: { relegated: boolean; promoted?: boolean },
  leagueId: number
): Transition {
  if (isSecondTier(leagueId)) {
    if (summary.promoted) {
      const upId = firstTierOf(leagueId)!;
      return { type: "up", leagueId: upId, leagueName: leagueName(upId) };
    }
    if (summary.relegated) return { type: "sacked" };
    return { type: "stay" };
  }
  if (summary.relegated) {
    const second = secondTierOf(leagueId);
    if (second) return { type: "down", leagueId: second.id, leagueName: second.name };
    return { type: "sacked" }; // malá liga bez modelované 2. ligy
  }
  return { type: "stay" };
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

/** Hlavní odznak sezóny (postup / mistr + evropská příčka / sestup / střed tabulky). */
export function seasonHeadline(s: {
  champion: boolean;
  europe: EuropeSpot;
  relegated: boolean;
  promoted?: boolean;
}): string {
  if (s.promoted) return s.champion ? "Vítěz 2. ligy 🏆 · Postup 🔼" : "Postup 🔼";
  if (s.relegated) return "Sestup";
  const euroLabel = EUROPE_LABEL[s.europe];
  if (s.champion) return euroLabel ? `Mistr 🏆 · ${euroLabel}` : "Mistr 🏆";
  return euroLabel || "Střed tabulky";
}

export function seasonTone(s: {
  champion: boolean;
  europe: EuropeSpot;
  relegated: boolean;
  promoted?: boolean;
}): "good" | "ok" | "bad" {
  if (s.promoted) return "good";
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
export function seasonObjective(
  team: GameTeam,
  league: GameTeam[],
  leagueId: number,
  leagueAccess?: LeagueAccess | null
): Objective {
  const size = league.length;
  const sorted = [...league].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
  const exp = sorted.findIndex((t) => t.id === team.id) + 1;
  const a = accessFor(leagueId, size, leagueAccess);
  // Ve 2. lize je smysl sezóny postup nahoru – ale jen pro klub, který na to má.
  // Kariéru lze ve 2. lize i ZAČÍT (slabý klub), takže musí existovat i cíl záchrany;
  // jinak by outsider dostal „Zabojuj o postup — skonči do 21. místa".
  if (isSecondTier(leagueId)) {
    const spots = promoSpotsOf(leagueId);
    const safeRank = size - a.relegBottom;
    if (exp <= spots)
      return {
        kind: "promotion",
        targetRank: spots,
        text: `Postup do nejvyšší ligy (do ${spots}. místa)`,
      };
    if (exp > safeRank)
      return { kind: "survival", targetRank: safeRank, text: "Zachraň se — vyhni se sestupu" };
    // Blízko postupové zóny → tlač na postup; jinak prostě potvrď sílu.
    const target = Math.max(spots + 1, exp);
    return exp <= spots + PROMOTION_PUSH_GAP
      ? { kind: "midtable", targetRank: target, text: `Zabojuj o postup — skonči do ${target}. místa` }
      : { kind: "midtable", targetRank: target, text: `Potvrď sílu — skonči do ${target}. místa` };
  }
  // Nejnižší příčka, která ještě vede do Evropy. Kurátorované i odvozené sloty jsou
  // souvislé od 1. místa (`euro()` / `contiguousPrefix`), ale bereme maximum ranku
  // místo `slots.length` – nespoléhá to na tu invariantu.
  const euroSlots = a.slots.length ? Math.max(...a.slots.map((s) => s.rank)) : 1;
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
  return clamp(Math.round(base + PRESTIGE_SHIFT + pct * PRESTIGE_SCALE), 0, 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
