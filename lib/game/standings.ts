// Čistá redukce výsledků → ligová tabulka. Body 3/1/0, řazení body → rozdíl →
// vstřelené → id. (Dnešní standings.ts jen čte tabulku z API; tohle je herní obdoba.)

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
