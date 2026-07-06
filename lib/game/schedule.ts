// Rozlosování ligy metodou kruhu (round-robin). Dvoukolově každý s každým:
// 20 týmů → 19 kol jednokolově → 38 kol. Druhá polovina = prohozené domácí/venku.

import type { Fixture } from "./types";

/**
 * Plný dvoukolový rozpis pro sudý počet týmů. `teamIds` musí mít sudou délku.
 * Vrací pole kol, každé kolo = n/2 zápasů. Deterministické (žádný RNG – pořadí
 * je dané kruhovou metodou; domácí výhodu vyrovná druhá polovina sezóny).
 */
export function roundRobin(teamIds: number[]): Fixture[][] {
  const n = teamIds.length;
  if (n < 2 || n % 2 !== 0) {
    throw new Error(`roundRobin: potřebuje sudý počet týmů, dostal ${n}`);
  }
  const ids = teamIds.slice();
  const half = n / 2;
  const roundsSingle = n - 1;
  const firstLeg: Fixture[][] = [];

  // Kruhová metoda: tým na indexu 0 je fixní, ostatní rotují.
  const arr = ids.slice();
  for (let r = 0; r < roundsSingle; r++) {
    const round: Fixture[] = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // Střídání domácí/venku dle kola i pozice → vyváženější rozvrh.
      const homeFirst = (r + i) % 2 === 0;
      round.push({
        round: r,
        homeId: homeFirst ? a : b,
        awayId: homeFirst ? b : a,
      });
    }
    firstLeg.push(round);
    // Rotace: fixuj arr[0], posuň zbytek o jedna doprava.
    arr.splice(1, 0, arr.pop() as number);
  }

  // Druhá polovina: stejné páry s prohozeným domácím prostředím.
  const secondLeg: Fixture[][] = firstLeg.map((round, r) =>
    round.map((f) => ({
      round: roundsSingle + r,
      homeId: f.awayId,
      awayId: f.homeId,
    }))
  );

  return [...firstLeg, ...secondLeg];
}
