import type { LeagueGoalsAvg, Standing, StandingSplit } from "@/lib/types";
import type { EuropeSpot, LeagueAccess } from "@/lib/game/types";
import type { ApiStandingRow } from "./apiFootball";

/**
 * Vybere řádek daného týmu z hrubé ligové tabulky a normalizuje ho na {@link Standing}.
 * - Chybí-li tým v tabulce (nováček mimo tabulku / jiná soutěž) → `null` (UI sekci skryje).
 * - Chybějící číselná pole se doplní na 0 (tolerantní vůči neúplné odpovědi API).
 * Čistá funkce (kvůli testu) – jako `selectCurrentInjuries` v `injuries.ts`.
 */
export function pickTeamStanding(
  raw: ApiStandingRow[],
  teamId: number
): Standing | null {
  const row = raw.find((r) => r.team.id === teamId);
  if (!row) return null;
  return {
    rank: row.rank,
    points: row.points ?? 0,
    goalsDiff: row.goalsDiff ?? 0,
    form: row.form ?? null,
    all: split(row.all),
    home: split(row.home),
    away: split(row.away),
  };
}

/**
 * Odvodí skutečný evropský/sestupový access key ligy z reálného pole `description`
 * u každého řádku (API-Football, např. "Promotion - Champions League (Group Stage)",
 * "Promotion - Europa League (Play Offs)", "Relegation - Relegation Play-offs") –
 * náhrada za ručně udržovanou `LEAGUE_ACCESS` v lib/game/leagues.ts, sezónně přesná bez
 * ruční údržby. Vrací `null`, pokud žádný řádek nemá rozpoznatelný popis (chybějící
 * data / neznámá soutěž) → volající pak spadne na kurátorovaný fallback.
 *
 * Sestup = **počet řádků s jistým sestupem**. Nejde odvodit z ranků: ligy s nadstavbou
 * vrací několik podtabulek za sebou (základní + evropská + sestupová) a `rank` se v každé
 * počítá znovu od 1, takže `raw.length` není velikost ligy a ranky nejsou globální.
 * Nepočítá se fázový split ("Relegation Round"/"Group") ani baráž ("Relegation Play-offs")
 * – hra baráž nemodeluje, takže se do sestupové zóny počítají jen jisté pády.
 * Když se nenajde žádná sestupová příčka, vrací `relegBottom: null` (= neznámo, **ne**
 * "liga bez sestupu") → volající spadne na kurátorovanou hodnotu. Dřív se vracela `0`,
 * což u lig s nadstavbou znamenalo, že nikdo nikdy nesestoupil.
 */
export function deriveLeagueAccess(raw: ApiStandingRow[]): LeagueAccess | null {
  const slots: { rank: number; spot: EuropeSpot }[] = [];
  let relegCount = 0;
  for (const row of raw) {
    const desc = row.description?.toLowerCase() ?? "";
    if (!desc) continue;
    // Soutěž se hledá jen PŘED závorkou. Reálný evropský slot pojmenuje soutěž rovnou
    // ("Promotion - Europa League (Qualification)"), kdežto domácí play-off o Evropu má
    // v hlavičce vlastní ligu ("Promotion - Eredivisie (Conference League - Play Offs)")
    // – ten do Evropy teprve hraje, není to postupové místo (jinak by Eredivisie měla
    // 9 evropských míst z 18). Fáze (kvalifikace/předkolo) se čte z celého popisku.
    const head = desc.split("(")[0];
    const isQualifier = /qualif|play.?off|preliminary/.test(desc);
    let spot: EuropeSpot | null = null;
    if (head.includes("champions league")) spot = isQualifier ? "UCL_Q" : "UCL";
    else if (head.includes("europa league")) spot = isQualifier ? "UEL_Q" : "UEL";
    else if (head.includes("conference league")) spot = isQualifier ? "UECL_Q" : "UECL";
    if (spot) slots.push({ rank: row.rank, spot });
    // Jistý sestup popisek ZAČÍNÁ slovem "relegation" ("Relegation - Championship",
    // "Relegation"). Baráž má tvar "<Liga> (Relegation)" nebo "Relegation Play-offs",
    // fázový split nadstavby "Relegation Round"/"Group" – nic z toho není jistý pád.
    if (desc.startsWith("relegation") && !/round|group|play.?off/.test(desc)) relegCount++;
  }
  const relegBottom = relegCount > 0 ? relegCount : null;
  const prefix = contiguousPrefix(slots);
  if (prefix.length === 0 && relegBottom === null) return null;
  return { slots: prefix, relegBottom };
}

/**
 * Ponechá jen souvislou řadu evropských míst od 1. příčky dolů (a dedupuje ranky, které se
 * u nadstavbových podtabulek opakují). Reálná tabulka totiž nese i místa vysoutěžená
 * **domácím pohárem** – např. Premier League 2025/26 má `15.→UEL` (vítěz FA Cupu). Hra
 * domácí pohár nemodeluje, takže by se v tabulce rozsvítil evropský pruh u 15. místa
 * a `seasonObjective` by jako cíl „Evropa" nabídl 15. místo.
 */
function contiguousPrefix(
  slots: { rank: number; spot: EuropeSpot }[]
): { rank: number; spot: EuropeSpot }[] {
  const byRank = new Map<number, EuropeSpot>();
  for (const s of slots) if (!byRank.has(s.rank)) byRank.set(s.rank, s.spot);
  const out: { rank: number; spot: EuropeSpot }[] = [];
  for (let rank = 1; byRank.has(rank); rank++) out.push({ rank, spot: byRank.get(rank)! });
  return out;
}

/** Průměr vstřelených a obdržených gólů na zápas přes celou ligu (z cachované tabulky). */
export function computeLeagueGoalsAvg(standings: ApiStandingRow[]): LeagueGoalsAvg | null {
  const totalPlayed = standings.reduce((s, r) => s + (r.all?.played ?? 0), 0);
  if (!totalPlayed) return null;
  return {
    goalsFor: standings.reduce((s, r) => s + (r.all?.goals?.for ?? 0), 0) / totalPlayed,
    goalsAgainst: standings.reduce((s, r) => s + (r.all?.goals?.against ?? 0), 0) / totalPlayed,
  };
}

function split(s: ApiStandingRow["all"]): StandingSplit {
  return {
    played: s?.played ?? 0,
    win: s?.win ?? 0,
    draw: s?.draw ?? 0,
    lose: s?.lose ?? 0,
    goalsFor: s?.goals?.for ?? 0,
    goalsAgainst: s?.goals?.against ?? 0,
  };
}
