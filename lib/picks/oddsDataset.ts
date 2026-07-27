import { parseCsv } from "@/lib/data/transfersDataset";
import type { HistoryMatch } from "./backtest";

/**
 * Historické **zavírací** kurzy z football-data.co.uk pro offline backtest.
 *
 * Proč vlastní zdroj: API-Football historické kurzy **nevrací** (ověřeno pro
 * `/odds?fixture=<minulý>`, `?date=`, i `?league=&season=` → shodně `results: 0`), takže
 * bez externího datasetu nejde na historii spočítat ani market benchmark, ani ROI –
 * jediná otázka, která u sázecího modelu rozhoduje. football-data.co.uk dává zdarma
 * zavírací 1X2 (Pinnacle, průměr trhu, nejlepší cena), zavírací Over/Under 2.5 a navíc
 * **skutečné počty rohů**, zpět do sezóny 2000/01.
 *
 * Zavírací (`C`) kurzy jsou schválně: zavírací linie je nejpřesnější odhad, jaký trh
 * vydá, takže „porazit zavření" je nejtvrdší a nejpoctivější test modelu.
 *
 * Modul je **čistý** (parsování + párování); stahování a zápis dělá `scripts/importOdds.ts`.
 */

/** Kurzy 1X2 od jednoho zdroje ceny. */
export interface OddsTriple {
  home: number;
  draw: number;
  away: number;
}

/** Kurzy Over/Under na lince 2.5. */
export interface OddsPair {
  over: number;
  under: number;
}

/**
 * Kurzy k jednomu zápasu ve třech cenových hladinách. Rozdíl mezi nimi je podstatný:
 * `pinnacle` = sharp linie (nejlepší odhad pravděpodobnosti), `average` = co dostane
 * běžný sázející, `best` = nejlepší cena napříč knihami (line-shopping).
 */
export interface MatchOddsRecord {
  pinnacle?: OddsTriple;
  average?: OddsTriple;
  best?: OddsTriple;
  /** Over/Under 2.5 – jen hlavní ligy (soubory „extra" lig totaly nemají). */
  ou25?: { pinnacle?: OddsPair; average?: OddsPair; best?: OddsPair };
  /** Skutečné rohy obou stran – vstup pro model rohů (jen hlavní ligy). */
  corners?: { home: number; away: number };
}

/** Zdroj dat pro jednu naši ligu. */
export interface LeagueSource {
  /** „main" = `mmz4281/<sezóna>/<kód>.csv` (soubor na sezónu), „extra" = `new/<kód>.csv`. */
  kind: "main" | "extra";
  code: string;
}

/**
 * Mapa našich ligových id na kódy football-data. Fortuna liga (345) zdroj **nemá** –
 * to je vědomá díra, ne opomenutí; kurzy pro ni půjde sbírat jen dopředu z API.
 */
export const LEAGUE_SOURCES: Record<number, LeagueSource> = {
  39: { kind: "main", code: "E0" }, // Premier League
  40: { kind: "main", code: "E1" }, // Championship
  140: { kind: "main", code: "SP1" },
  135: { kind: "main", code: "I1" },
  78: { kind: "main", code: "D1" },
  61: { kind: "main", code: "F1" },
  88: { kind: "main", code: "N1" }, // Eredivisie
  144: { kind: "main", code: "B1" }, // Jupiler Pro League
  94: { kind: "main", code: "P1" }, // Primeira Liga
  203: { kind: "main", code: "T1" }, // Süper Lig
  197: { kind: "main", code: "G1" }, // Super League 1
  179: { kind: "main", code: "SC0" }, // Scottish Premiership
  218: { kind: "extra", code: "AUT" },
  119: { kind: "extra", code: "DNK" },
  103: { kind: "extra", code: "NOR" },
  106: { kind: "extra", code: "POL" },
  207: { kind: "extra", code: "SUI" },
};

/** Jeden zápas ze zdrojového CSV (už znormalizovaný). */
export interface SourceMatch {
  /** Půlnoc dne zápasu v UTC (CSV nese jen datum, případný čas ignorujeme). */
  day: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  /** Sezóna ve tvaru „rok začátku" – jen u „extra" souborů, kde je sloupec `Season`. */
  season?: number;
  odds: MatchOddsRecord;
}

const DAY_MS = 86_400_000;

/** `dd/mm/yyyy` i `dd/mm/yy` → půlnoc UTC. `NaN` u nesmyslu. */
export function parseCsvDate(s: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return NaN;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  return Date.UTC(year, Number(mo) - 1, Number(d));
}

/**
 * Název týmu na porovnatelný tvar: bez diakritiky, bez klubových zkratek a interpunkce.
 * football-data píše „Man United" tam, kde API-Football „Manchester United", takže shoda
 * musí být tolerantní – proto se páruje podobností, ne rovností (viz `nameSimilarity`).
 */
export function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(
      /\b(fc|cf|sc|ac|as|ss|ssc|afc|cd|ud|sv|tsv|vfl|vfb|bsc|fk|nk|hb|if|ik|bk|calcio|club|de|the)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kluby, které se ve zdrojích jmenují úplně jinak (ne překlep ani zkratka) – podobnost
 * jmen je tu z principu nulová, takže pomůže jen ručně vedený alias. Klíč i hodnota se
 * porovnávají znormalizované.
 */
const NAME_ALIASES: Record<string, string> = {
  "wsg wattens": "tirol", // WSG Tirol hraje ve Wattens; football-data ho vede jako „Tirol"
};

const alias = (n: string) => NAME_ALIASES[n] ?? n;

/** Podobnost přes bigramy (Dice) – chytí překlepy a přepisy („Levadiakos" vs „Levadeiakos"). */
function diceSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/ /g, "");
    const out = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Podobnost dvou názvů 0–1. Kombinuje dva pohledy, protože každý selhává jinde:
 * shoda **tokenů** zvládne zkracování („Man" ⊂ „Manchester"), ale ne přepis jména;
 * **bigramy** zvládnou přepis („Levadiakos" vs „Levadeiakos"), ale u víceslovných názvů
 * jsou k ničemu. Bere se ten příznivější.
 */
export function nameSimilarity(a: string, b: string): number {
  const A = alias(normalizeTeamName(a));
  const B = alias(normalizeTeamName(b));
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ta = A.split(" ");
  const tb = B.split(" ");
  let hits = 0;
  for (const x of ta) {
    if (
      tb.some(
        (y) => y === x || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y))
      )
    ) {
      hits++;
    }
  }
  return Math.max(hits / Math.max(ta.length, tb.length), diceSimilarity(A, B));
}

const num = (v: string | undefined): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : undefined;
};

const triple = (
  row: Record<string, string>,
  h: string,
  d: string,
  a: string
): OddsTriple | undefined => {
  const H = num(row[h]);
  const D = num(row[d]);
  const A = num(row[a]);
  return H && D && A ? { home: H, draw: D, away: A } : undefined;
};

const pair = (
  row: Record<string, string>,
  o: string,
  u: string
): OddsPair | undefined => {
  const O = num(row[o]);
  const U = num(row[u]);
  return O && U ? { over: O, under: U } : undefined;
};

/** CSV → pole objektů dle hlavičky (prázdné/rozbité řádky se přeskočí). */
function toRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text).filter((r) => r.length > 1);
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
}

/** Soubor hlavní ligy (`mmz4281/<sezóna>/<kód>.csv`): 1X2 + Over/Under 2.5 + rohy. */
export function parseMainCsv(text: string): SourceMatch[] {
  const out: SourceMatch[] = [];
  for (const r of toRecords(text)) {
    const day = parseCsvDate(r.Date);
    const hg = Number(r.FTHG);
    const ag = Number(r.FTAG);
    if (!Number.isFinite(day) || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    if (!r.HomeTeam || !r.AwayTeam) continue;

    const ou25 = {
      pinnacle: pair(r, "PC>2.5", "PC<2.5"),
      average: pair(r, "AvgC>2.5", "AvgC<2.5"),
      best: pair(r, "MaxC>2.5", "MaxC<2.5"),
    };
    const hc = Number(r.HC);
    const ac = Number(r.AC);

    out.push({
      day,
      home: r.HomeTeam,
      away: r.AwayTeam,
      homeGoals: hg,
      awayGoals: ag,
      odds: {
        pinnacle: triple(r, "PSCH", "PSCD", "PSCA"),
        average: triple(r, "AvgCH", "AvgCD", "AvgCA"),
        best: triple(r, "MaxCH", "MaxCD", "MaxCA"),
        ...(ou25.pinnacle || ou25.average || ou25.best ? { ou25 } : {}),
        ...(Number.isFinite(hc) && Number.isFinite(ac)
          ? { corners: { home: hc, away: ac } }
          : {}),
      },
    });
  }
  return out;
}

/**
 * Soubor „extra" ligy (`new/<kód>.csv`): jeden soubor přes všechny sezóny, jiné názvy
 * sloupců a **jen 1X2** (žádné totaly ani rohy). `Season` je buď „2012/2013" (podzim–jaro),
 * nebo „2024" (ligy hrané v rámci kalendářního roku, např. Norsko) – v obou případech nás
 * zajímá rok začátku, protože tak sezóny označuje i API-Football.
 */
export function parseExtraCsv(text: string): SourceMatch[] {
  const out: SourceMatch[] = [];
  for (const r of toRecords(text)) {
    const day = parseCsvDate(r.Date);
    const hg = Number(r.HG);
    const ag = Number(r.AG);
    if (!Number.isFinite(day) || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    if (!r.Home || !r.Away) continue;
    const season = Number((r.Season ?? "").slice(0, 4));
    out.push({
      day,
      home: r.Home,
      away: r.Away,
      homeGoals: hg,
      awayGoals: ag,
      season: Number.isFinite(season) ? season : undefined,
      odds: {
        pinnacle: triple(r, "PSCH", "PSCD", "PSCA"),
        average: triple(r, "AvgCH", "AvgCD", "AvgCA"),
        best: triple(r, "MaxCH", "MaxCD", "MaxCA"),
      },
    });
  }
  return out;
}

/** Výsledek párování – včetně toho, co se nespárovalo (bez toho se chyba tiše ztratí). */
export interface OddsMatchResult {
  odds: Record<number, MatchOddsRecord>;
  matched: number;
  total: number;
  /** Popisky nespárovaných zápasů (na výpis, max několik). */
  unmatched: string[];
}

/** Minimální průměrná podobnost jmen, aby se dvojice vůbec uvažovala. */
const MIN_NAME_SCORE = 0.34;

/**
 * Napáruje zdrojové řádky na naši historii.
 *
 * Klíč je trojice **datum (±1 den) + skóre + podobnost jmen**, ne jméno samotné:
 * názvy se mezi zdroji liší („Man United" vs „Manchester United“), datum se může lišit
 * o den kvůli časovým zónám a večerním výkopům, ale **skóre je tvrdý kontrolní součet** –
 * díky němu nemůže dojít k záměně dvou zápasů téhož dne. Chybná dvojice by tiše
 * podstrčila cizí kurzy, což je horší než nespárovat nic.
 */
export function matchOdds(
  history: HistoryMatch[],
  source: SourceMatch[],
  season?: number
): OddsMatchResult {
  const pool = season == null ? source : source.filter((s) => s.season == null || s.season === season);

  // Index podle dne → kandidáti se hledají jen v ±1 dni, ne přes celou sezónu.
  const byDay = new Map<number, SourceMatch[]>();
  for (const s of pool) {
    const list = byDay.get(s.day);
    if (list) list.push(s);
    else byDay.set(s.day, [s]);
  }

  const odds: Record<number, MatchOddsRecord> = {};
  const unmatched: string[] = [];
  const used = new Set<SourceMatch>();

  for (const m of history) {
    const day = Date.UTC(
      new Date(m.date).getUTCFullYear(),
      new Date(m.date).getUTCMonth(),
      new Date(m.date).getUTCDate()
    );
    let best: { s: SourceMatch; score: number } | null = null;
    for (const delta of [0, -DAY_MS, DAY_MS]) {
      for (const s of byDay.get(day + delta) ?? []) {
        if (used.has(s)) continue;
        if (s.homeGoals !== m.homeGoals || s.awayGoals !== m.awayGoals) continue;
        const score =
          (nameSimilarity(m.homeName, s.home) + nameSimilarity(m.awayName, s.away)) / 2;
        if (score >= MIN_NAME_SCORE && (!best || score > best.score)) best = { s, score };
      }
    }
    if (best) {
      used.add(best.s);
      odds[m.fixtureId] = best.s.odds;
    } else if (unmatched.length < 5) {
      unmatched.push(`${m.date.slice(0, 10)} ${m.homeName}–${m.awayName} ${m.homeGoals}:${m.awayGoals}`);
    }
  }

  return {
    odds,
    matched: Object.keys(odds).length,
    total: history.length,
    unmatched,
  };
}
