import type { PlayedFixture, RoundFixture, UpcomingFixture } from "@/lib/types";
import { FINISHED_STATUSES, LIVE_STATUSES, type ApiFixture } from "./apiFootball";
import {
  FIXTURE_LIST_LEAGUE_IDS,
  catalogLeagueName,
  isNationalTournamentLeague,
  leagueLogoUrl,
} from "./catalog";

const FIXTURE_LEAGUES = new Set(FIXTURE_LIST_LEAGUE_IDS);

/**
 * Den (`YYYY-MM-DD`) v **pražské** zóně – hranice dne, na které stojí rozpis i Výsledky.
 * UTC by v létě posunulo večerní zápasy o den zpět (výkop 21:00 SELČ = 19:00 UTC je ještě
 * dnešek, ale 00:30 SELČ = 22:30 UTC předchozího dne už ne).
 */
export function pragueDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Statusy, po kterých zápas do Programu nepatří: dohrané (`FINISHED_STATUSES`) plus
 * zrušené/odložené/kontumované. U těch drží API původní datum výkopu, takže by v rozpisu
 * strašily jako „bude se hrát".
 */
const NOT_UPCOMING = new Set([
  ...FINISHED_STATUSES,
  "PST", // Postponed
  "CANC", // Cancelled
  "ABD", // Abandoned
  "AWD", // Technical loss
  "WO", // WalkOver
]);

/**
 * Profiltruje a normalizuje syrové zápasy z `/fixtures?date=` na lehký tvar pro
 * záložku „Zápasy": jen naše ligy (`FIXTURE_LEAGUES`), jen zápasy, které **ještě
 * nezačaly**, seřazené dle výkopu. Čistá funkce (testovatelná, bez DB).
 *
 * **Status sám nestačí** – denní rozpis je v `ApiCache` až hodinu starý, takže odehraný
 * zápas v něm ještě může nést `NS` a Program by ho ukazoval jako nadcházející. Proto
 * platí i tvrdá podmínka „výkop je v budoucnu": zápas, který ještě nezačal, JE nadcházející.
 * Zápas, který **právě běží** (`LIVE_STATUSES`), do Programu patří taky – svítí s minutou
 * a skóre; jeho živost čteme **jen z API statusu**, ne z „výkop proběhl" (drží invariant
 * proti stale cache – stale-`NS`-po-výkopu se stále vyhodí). Dohrané → do Výsledků.
 *
 * Cíl deep-linku: klub → CLUB mód s `leagueId` u obou týmů; reprezentace → NATIONAL mód,
 * kde „ligou" je konfederace týmu – tu zde neznáme (potřebuje cachované seznamy), proto
 * `null` a dotahuje ji `getFixturesByDates` (real). Mock plní klubové fixtures rovnou.
 */
export function normalizeUpcomingFixtures(
  raw: ApiFixture[],
  now: Date = new Date()
): UpcomingFixture[] {
  const nowMs = now.getTime();
  return raw
    .filter((f) => {
      if (!FIXTURE_LEAGUES.has(f.league.id)) return false;
      const status = f.fixture.status.short;
      if (LIVE_STATUSES.has(status)) return true; // právě běží → svítí v Programu
      // jinak jen ještě nezačaté (a status není zrušený/dohraný)
      return (
        !NOT_UPCOMING.has(status) &&
        new Date(f.fixture.date).getTime() > nowMs
      );
    })
    .map((f) => {
      const national = isNationalTournamentLeague(f.league.id);
      const live = LIVE_STATUSES.has(f.fixture.status.short);
      return {
        fixtureId: f.fixture.id,
        leagueId: f.league.id,
        leagueName: catalogLeagueName(f.league.id, f.league.name),
        leagueLogoUrl: leagueLogoUrl(f.league.id),
        kickoff: f.fixture.date,
        home: { id: f.teams.home.id, name: f.teams.home.name, logoUrl: f.teams.home.logo },
        away: { id: f.teams.away.id, name: f.teams.away.name, logoUrl: f.teams.away.logo },
        national,
        compareMode: national ? ("NATIONAL" as const) : ("CLUB" as const),
        homeCompareLeagueId: national ? null : f.league.id,
        awayCompareLeagueId: national ? null : f.league.id,
        ...(live && {
          live: true,
          elapsed: f.fixture.status.elapsed ?? null,
          liveHome: f.goals.home,
          liveAway: f.goals.away,
        }),
      };
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

/**
 * Zrcadlo `normalizeUpcomingFixtures` pro záložku **Výsledky**: z téhož denního rozpisu
 * vybere **dohrané** zápasy našich lig a seřadí je od nejnovějšího výkopu.
 *
 * Proč ze stejného zdroje: Výsledky se dřív četly výhradně z uložených predikcí, takže
 * zápas bez predikce (nebo settlnutý až ranním cronem) v nich nebyl vůbec. Rozpis den
 * zná hned – tip je až **překryv** (`mergeTips`), ne podmínka zobrazení.
 *
 * Bere jen `FINISHED_STATUSES` (FT/AET/PEN); `PST`/`CANC`/`ABD`/`AWD`/`WO` sem nepatří –
 * zrušený zápas není odehraný a skóre by u něj buď chybělo, nebo lhalo. Skóre bere
 * `fullTimeGoals` (stav po 90 min, ne po prodloužení) – shodně se settle a s tím, co
 * model predikuje. Zápas bez použitelného skóre se vynechá, ne aby se dopočítával.
 */
export function normalizeFinishedFixtures(raw: ApiFixture[]): PlayedFixture[] {
  const out: PlayedFixture[] = [];
  for (const f of raw) {
    if (!FIXTURE_LEAGUES.has(f.league.id)) continue;
    const status = f.fixture.status.short;
    if (!FINISHED_STATUSES.has(status)) continue;
    const ft = fullTimeGoals(f);
    if (!ft) continue;
    const national = isNationalTournamentLeague(f.league.id);
    out.push({
      fixtureId: f.fixture.id,
      leagueId: f.league.id,
      leagueName: catalogLeagueName(f.league.id, f.league.name),
      leagueLogoUrl: leagueLogoUrl(f.league.id),
      kickoff: f.fixture.date,
      home: { id: f.teams.home.id, name: f.teams.home.name, logoUrl: f.teams.home.logo },
      away: { id: f.teams.away.id, name: f.teams.away.name, logoUrl: f.teams.away.logo },
      homeGoals: ft.home,
      awayGoals: ft.away,
      afterExtraTime: status === "AET" || status === "PEN",
      national,
      compareMode: national ? "NATIONAL" : "CLUB",
      homeCompareLeagueId: national ? null : f.league.id,
      awayCompareLeagueId: national ? null : f.league.id,
    });
  }
  // Nejnovější první – ve Výsledcích čte člověk odshora to, co se dohrálo naposled.
  return out.sort((a, b) => b.kickoff.localeCompare(a.kickoff));
}

/**
 * Skóre po **90 minutách** (regulérní hrací doba) – to, co predikuje model.
 *
 * `fixture.goals` je koncové skóre, takže u zápasů rozhodnutých v prodloužení (`AET`)
 * nebo na penalty (`PEN`) nese góly ze 120 minut: vyřazovací zápas 1:1 po 90 min
 * skončí v `goals` jako 2:1 → settle by z remízy udělal výhru a kalibrace by z toho
 * počítala 1X2, Over 2.5 i Dixon–Coles ρ proti tomu, co model vůbec nemodeluje.
 * `score.fulltime` drží stav po 90 min → settle bere jeho.
 *
 * Fallback na `goals` je pro případ, že API `score` nevrátí (u `FT` jsou obě hodnoty
 * shodné, takže fallback nic nezkreslí). `null` = skóre neznámé.
 */
export function fullTimeGoals(
  f: ApiFixture
): { home: number; away: number } | null {
  const ft = f.score?.fulltime;
  if (typeof ft?.home === "number" && typeof ft?.away === "number") {
    return { home: ft.home, away: ft.away };
  }
  const { home, away } = f.goals;
  if (home == null || away == null) return null;
  return { home, away };
}

/**
 * Vybere „poslední kolo" (nejnovější skupina odehraných zápasů) nebo „příští kolo"
 * (nejbližší skupina nadcházejících) z ligou vrácené sady zápasů – Tabulky. API nemá
 * dotaz „celé kolo", jen `last=N`/`next=N` počet zápasů → group podle `league.round`
 * a vezmi tu skupinu s nejnovějším/nejbližším průměrným datem výkopu (robustní i pro
 * kola s odloženým zápasem nebo bez číselného pořadí v názvu kola).
 */
export function pickRound(
  raw: ApiFixture[],
  direction: "last" | "next"
): RoundFixture[] {
  // U „nejbližšího kola" platí stejný důvod jako v Programu: odložený/zrušený zápas si
  // drží PŮVODNÍ (minulý) výkop, takže by tvořil vlastní skupinu s nejstarším průměrem
  // data a výběr „nejbližšího" by vyhrál – Tabulky by pak jako příští kolo ukázaly jediný
  // zápas, který se nehraje.
  const eligible =
    direction === "last"
      ? raw.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short))
      : raw.filter((f) => !NOT_UPCOMING.has(f.fixture.status.short));

  const groups = new Map<string, ApiFixture[]>();
  for (const f of eligible) {
    const round = f.league.round ?? "";
    const list = groups.get(round);
    if (list) list.push(f);
    else groups.set(round, [f]);
  }

  let bestRound: string | null = null;
  let bestAvg = direction === "last" ? -Infinity : Infinity;
  for (const [round, fixtures] of groups) {
    const avg =
      fixtures.reduce((s, f) => s + new Date(f.fixture.date).getTime(), 0) /
      fixtures.length;
    const better = direction === "last" ? avg > bestAvg : avg < bestAvg;
    if (better) {
      bestAvg = avg;
      bestRound = round;
    }
  }
  const chosen = bestRound != null ? (groups.get(bestRound) ?? []) : [];

  return chosen
    .map((f) => {
      const ft = fullTimeGoals(f);
      return {
        fixtureId: f.fixture.id,
        kickoff: f.fixture.date,
        home: { id: f.teams.home.id, name: f.teams.home.name, logoUrl: f.teams.home.logo },
        away: { id: f.teams.away.id, name: f.teams.away.name, logoUrl: f.teams.away.logo },
        homeGoals: ft?.home ?? null,
        awayGoals: ft?.away ?? null,
      };
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
