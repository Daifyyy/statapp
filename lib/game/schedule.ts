// Rozlosování ligy metodou kruhu (round-robin). Dvoukolově každý s každým:
// 20 týmů → 19 kol jednokolově → 38 kol. Druhá polovina = prohozené domácí/venku.

import type { Fixture } from "./types";

/**
 * Plný dvoukolový rozpis pro sudý počet týmů. `teamIds` musí mít sudou délku.
 * Vrací pole kol, každé kolo = n/2 zápasů. Deterministické (žádný RNG – pořadí
 * je dané kruhovou metodou; volající si `teamIds` může předem promíchat seedem).
 *
 * **Domácí/venku (Bergerova orientace).** Kruhová metoda drží jeden tým fixní a
 * ostatními rotuje. Kdyby se domácí prostředí odvozovalo z čísla kola (`r`), rotace
 * by ho vyrušila – rotující tým se posouvá o +1 pozici za kolo přesně jako roste `r`,
 * takže `(r + i)` je invariantní a tým by celou půlsezónu hrál jen doma, nebo jen venku
 * (starší verze tohohle souboru tím trpěla: 15 z 16 týmů mělo 15 zápasů v kuse).
 * Správně se orientace bere z **indexu dvojice v kole** (`i`), který se pro daný tým
 * mění každé kolo; jedinou výjimkou je fixní tým, ten se střídá dle parity kola.
 * Výsledek: každý tým `n-1`× doma a `n-1`× venku, max. **3 zápasy v kuse** ve stejném
 * prostředí (viz testy v `game.test.ts`).
 */
export function roundRobin(teamIds: number[]): Fixture[][] {
  const firstLeg = singleRoundRobin(teamIds);
  const roundsSingle = firstLeg.length;

  // Druhá polovina: stejné páry s prohozeným domácím prostředím. Když se prostředí
  // v první půlce střídá, je korektní i přechod mezi půlkami (…H|A…).
  const secondLeg: Fixture[][] = firstLeg.map((round, r) =>
    round.map((f) => ({
      round: roundsSingle + r,
      homeId: f.awayId,
      awayId: f.homeId,
    }))
  );

  return [...firstLeg, ...secondLeg];
}

/**
 * JEDNOKOLOVÝ rozpis: každý s každým právě jednou (`n-1` kol po `n/2` zápasech).
 * Turnajová skupina 4 týmů → 3 kola po 2 zápasech, 6 zápasů. `roundRobin` z něj skládá
 * dvoukolový rozpis přidáním zrcadla, takže logika kruhové metody žije jen tady.
 *
 * V turnaji na neutrální půdě je `homeId`/`awayId` jen **nominální** (kdo je vlevo na
 * tabuli): s `homeBoost: 1` vrací `homeAdvantage` nulový bonus i postih, takže na výsledek
 * nemá vliv. Stejný kompromis dělá i predikční pipeline u Ligy národů.
 */
export function singleRoundRobin(teamIds: number[]): Fixture[][] {
  const n = teamIds.length;
  if (n < 2 || n % 2 !== 0) {
    throw new Error(`singleRoundRobin: potřebuje sudý počet týmů, dostal ${n}`);
  }
  const half = n / 2;
  const rounds = n - 1; // = počet rotujících týmů (fixní je teamIds[n-1])
  const out: Fixture[][] = [];

  for (let r = 0; r < rounds; r++) {
    const round: Fixture[] = [];
    // Fixní tým vs rotující – jediná dvojice, která střídá prostředí dle parity kola.
    const fixed = teamIds[n - 1];
    const opp = teamIds[r % rounds];
    const fixedHome = r % 2 === 0;
    round.push({
      round: r,
      homeId: fixedHome ? fixed : opp,
      awayId: fixedHome ? opp : fixed,
    });
    // Zbylé dvojice: proti sobě týmy symetricky kolem `r` v kruhu rotujících.
    for (let i = 1; i < half; i++) {
      const a = teamIds[(r + i) % rounds];
      const b = teamIds[(r - i + rounds) % rounds];
      const aHome = i % 2 === 0; // orientace dle indexu dvojice, ne dle čísla kola
      round.push({
        round: r,
        homeId: aHome ? a : b,
        awayId: aHome ? b : a,
      });
    }
    out.push(round);
  }
  return out;
}
