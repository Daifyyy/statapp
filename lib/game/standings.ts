// Čistá redukce výsledků → ligová tabulka. Body 3/1/0, řazení body → rozdíl →
// vstřelené → id. (Dnešní standings.ts jen čte tabulku z API; tohle je herní obdoba.)
//
// Pro TURNAJ použij `groupTable` – v lize je poslední tiebreak `teamId` neškodný (o titul
// rozhodne 38 kol), ale ve skupině o 3 kolech by o postupu do osmifinále rozhodovalo
// databázové id týmu.

import { deriveSeed } from "./rng";
import type { MatchResult, TableRow } from "./types";

/** Poskládá tabulku ze všech odehraných výsledků. `teamIds` = všechny týmy ligy. */
export function buildTable(teamIds: number[], results: MatchResult[]): TableRow[] {
  const rows = new Map<number, TableRow>();
  for (const id of teamIds) {
    rows.set(id, {
      teamId: id,
      played: 0,
      win: 0,
      draw: 0,
      loss: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalsDiff: 0,
      points: 0,
      rank: 0,
    });
  }

  for (const r of results) {
    const home = rows.get(r.homeId);
    const away = rows.get(r.awayId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.goalsFor += r.homeGoals;
    home.goalsAgainst += r.awayGoals;
    away.goalsFor += r.awayGoals;
    away.goalsAgainst += r.homeGoals;
    if (r.homeGoals > r.awayGoals) {
      home.win++;
      home.points += 3;
      away.loss++;
    } else if (r.homeGoals < r.awayGoals) {
      away.win++;
      away.points += 3;
      home.loss++;
    } else {
      home.draw++;
      away.draw++;
      home.points += 1;
      away.points += 1;
    }
  }

  const table = [...rows.values()];
  for (const row of table) row.goalsDiff = row.goalsFor - row.goalsAgainst;
  table.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsDiff - a.goalsDiff ||
      b.goalsFor - a.goalsFor ||
      a.teamId - b.teamId
  );
  table.forEach((row, i) => (row.rank = i + 1));
  return table;
}

/**
 * Deterministický „los" pro neřešitelné shody. Klíč závisí jen na `(seed, salt, teamId)`,
 * **ne na pořadí vstupu** – jinak by výsledek závisel na tom, jak přišly týmy do pole.
 */
function drawKey(seed: number, salt: number, teamId: number): number {
  return deriveSeed(deriveSeed(seed, salt), teamId);
}

/**
 * Turnajová skupinová tabulka. Řazení: **body → vzájemné zápasy → gólový rozdíl →
 * vstřelené → seedovaný los**.
 *
 * Vzájemné zápasy (UEFA klíč) se počítají jen mezi týmy, které mají stejný počet bodů:
 * z jejich vzájemných utkání se postaví minitabulka a rozhodne se v ní. Když ani ta
 * nerozsekne (typicky trojitá shoda 1-1-1), padne se na celkový rozdíl a nakonec na los.
 *
 * `results` může být globální pole celého turnaje – `buildTable` zápasy mimo skupinu ignoruje.
 */
export function groupTable(
  teamIds: number[],
  results: MatchResult[],
  seed: number,
  /** Odlišuje los mezi skupinami, ať dvě skupiny nedostanou stejné pořadí při shodě. */
  salt = 0
): TableRow[] {
  const base = buildTable(teamIds, results);
  const inGroup = new Set(teamIds);
  const groupResults = results.filter((r) => inGroup.has(r.homeId) && inGroup.has(r.awayId));

  // Řadí se PO BLOCÍCH stejného počtu bodů, ne jedním komparátorem. Minitabulka vzájemných
  // zápasů totiž nemusí být tranzitivní (trojitá shoda A>B>C>A) a nekonzistentní komparátor
  // by ve V8 vrátil libovolné pořadí.
  const byPoints = new Map<number, TableRow[]>();
  for (const row of base) {
    const bucket = byPoints.get(row.points) ?? [];
    bucket.push(row);
    byPoints.set(row.points, bucket);
  }

  const out: TableRow[] = [];
  for (const points of [...byPoints.keys()].sort((a, b) => b - a)) {
    const bucket = byPoints.get(points)!;
    if (bucket.length === 1) {
      out.push(bucket[0]);
      continue;
    }
    // UEFA klíč: mezi týmy se stejnými body rozhodnou nejdřív jejich vzájemná utkání.
    const h2h = buildTable(bucket.map((r) => r.teamId), groupResults);
    const mini = new Map(h2h.map((r) => [r.teamId, r]));
    bucket.sort((a, b) => {
      const ma = mini.get(a.teamId)!;
      const mb = mini.get(b.teamId)!;
      return (
        mb.points - ma.points ||
        mb.goalsDiff - ma.goalsDiff ||
        mb.goalsFor - ma.goalsFor ||
        b.goalsDiff - a.goalsDiff ||
        b.goalsFor - a.goalsFor ||
        // Los – nikdy `teamId`.
        drawKey(seed, salt, a.teamId) - drawKey(seed, salt, b.teamId)
      );
    });
    out.push(...bucket);
  }

  out.forEach((row, i) => (row.rank = i + 1));
  return out;
}

/**
 * Seřadí týmy z různých skupin, které skončily na stejné příčce (typicky třetí místa).
 * Euro bere 4 nejlepší třetí ze 6 skupin, MS 8 z 12. Klíč: body → gólový rozdíl →
 * vstřelené → seedovaný los.
 */
export function rankAcrossGroups(rows: TableRow[], seed: number, salt = 1): TableRow[] {
  return [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalsDiff - a.goalsDiff ||
      b.goalsFor - a.goalsFor ||
      drawKey(seed, salt, a.teamId) - drawKey(seed, salt, b.teamId)
  );
}
