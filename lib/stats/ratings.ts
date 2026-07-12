/**
 * Síly týmů s **korekcí na soupeře** a **exponenciálním časovým útlumem** (Maher/Dixon–Coles).
 *
 * Proč: dosavadní odhad bere průměr gólů/xG týmu ve třech oknech (70/25/5) a nezajímá se,
 * **s kým se hrálo**. Tým, který odehrál pět zápasů se dnem tabulky, vypadá silně; tým po
 * losu s elitou slabě. A tři pevná okna jsou hrubá aproximace toho, co se ve skutečnosti
 * dělá plynule: čím starší zápas, tím menší váha.
 *
 * Model je stejný jako v `expectedGoals`, jen síly se odhadují **společně pro celou ligu**:
 *
 *     góly týmu i proti j  ≈  ref × útok(i) × slabost_obrany(j)
 *
 * Útok i obrana jsou **poměry k lize** (1.0 = průměrný tým), takže výstup jde do λ beze změny.
 * Řeší se iterativně (Maherovo schéma): útoky se spočítají při daných obranách, pak obrany
 * při daných útocích, a znovu – po pár kolech se to ustálí. Čistá funkce, žádná data navíc.
 */

/** Odehraný zápas ligy pro odhad sil (góly, volitelně xG – to je stabilnější signál). */
export interface RatingMatch {
  date: string; // ISO
  homeId: number;
  awayId: number;
  homeGoals: number;
  awayGoals: number;
  homeXg?: number;
  awayXg?: number;
  /**
   * Neutrální půda (turnaje reprezentací) → obě strany se poměřují **stejným** měřítkem,
   * ne měřítkem domácích/hostů. Bez toho by turnajový „domácí" tým dostal výhodu, kterou nemá.
   */
  neutral?: boolean;
  /**
   * Násobič váhy zápasu (nad rámec časového útlumu). Slouží pro **přáteláky** – rotace
   * a experimenty z nich dělají slabší signál než ze soutěžního zápasu. `1` = plná váha.
   */
  weight?: number;
}

/** Síla týmu jako poměr k ligovému průměru (1.0 = průměr; obrana: >1 = pouští víc gólů). */
export interface TeamStrength {
  attack: number;
  defense: number;
  /** Efektivní vzorek (součet vah zápasů po útlumu) – kolik za tím reálně stojí. */
  sample: number;
}

export interface RatingOptions {
  /** Za kolik dní klesne váha zápasu na polovinu. Nahrazuje tři pevná okna. */
  halfLifeDays: number;
  /** Kolik zápasů ligového průměru se přimíchá (shrinkage – malý vzorek → skoro liga). */
  shrinkMatches: number;
  /** Váha xG proti gólům (0 = jen góly, 1 = jen xG). */
  xgWeight: number;
  /** Kolik iterací Maherova schématu (5 bohatě stačí – konverguje rychle). */
  iterations: number;
  /** Ligové měřítko: kolik gólů dá průměrný domácí / hostující tým. */
  home: number;
  away: number;
}

const MIN_RATING = 0.25;
const MAX_RATING = 4;

/**
 * Produkční nastavení, **fitnuté `npm run backtest`** (grid poločas × shrinkage, ověřeno
 * hold-outem na obou sezónách):
 *  - poločas 270 dní ≈ „zápas spolu s minulou sezónou pořád trochu váží";
 *  - shrinkage 2 (nízký – korekce na soupeře sama o sobě šum tlumí);
 *  - 5 iterací (schéma konverguje rychle).
 * Změna 1X2 log-loss: 1.0116 → 1.0001 (sezóna 2025), 1.0010 → 0.9869 (2024).
 */
export const RATING_OPTIONS = {
  halfLifeDays: 270,
  shrinkMatches: 2,
  iterations: 5,
} as const;

/** Kolik dní historie brát (starší zápasy mají po útlumu zanedbatelnou váhu). */
export const RATING_WINDOW_DAYS = 540;

/** Pod tolika zápasy ligy ratingům nevěř (rozjezd sezóny) → padne se na okenní model. */
export const RATING_MIN_MATCHES = 30;

/**
 * Reprezentace: **jeden globální pool všech národů**, ne pool per konfederace. Kdyby se
 * ratingy počítaly zvlášť pro UEFA a AFC, každý by se normalizoval na svou vlastní 1.0
 * a „útok 1.3" by v obou znamenal něco jiného – tedy přesně ta chyba, kterou opravujeme.
 * V jednom poolu propojí konfederace **přáteláky a mezikontinentální zápasy** a iterativní
 * schéma po těch hranách sílu propaguje (jako Elo).
 *
 * Fitnuto `npm run backtest-national` (675 zápasů, ověřeno na dvou obdobích zvlášť):
 *  - **poločas 3 roky** – reprezentace hrají málo a mění se pomalu; kratší paměť zahazuje
 *    víc, než kolik ušetří na zastaralosti (grid: kratší poločas = horší, a od ~3 let to
 *    saturuje);
 *  - **přáteláky s PLNOU vahou** (`friendlyWeight = 1`) – proti očekávání. Okenní model je
 *    tlumí (`matchWeight`), ale v ratingu jsou cenné: jsou to hlavně ony, co propojují
 *    konfederace. Grid: w=0.5 → 0.9657, w=1.0 → 0.9610.
 * Výsledek: log-loss **1.0182 → 0.9352**, přesnost 49.5 → 55.3 %.
 */
export const NATIONAL_RATING_OPTIONS = {
  halfLifeDays: 1095,
  shrinkMatches: 2,
  iterations: 5,
  xgWeight: 0, // reprezentace xG v API většinou nemají
} as const;

/** Váha přáteláku v reprezentačním ratingu (1 = stejná jako soutěžní zápas – viz výše). */
export const NATIONAL_FRIENDLY_WEIGHT = 1;

/**
 * Odhadne síly všech týmů ze zápasů odehraných **před** `asOf` (point-in-time – do budoucna
 * se model nikdy nepodívá). Vrací mapu `teamId → TeamStrength`; tým bez zápasů v mapě chybí
 * (volající použije ligový průměr).
 */
export function computeRatings(
  matches: RatingMatch[],
  asOf: string,
  opts: RatingOptions
): Map<number, TeamStrength> {
  const now = Date.parse(asOf);
  const halfLifeMs = opts.halfLifeDays * 24 * 3600 * 1000;

  // Jeden „pozorovaný útok" = kolik gólů/xG tým v zápase vyrobil, a proti komu.
  interface Obs {
    teamId: number;
    oppId: number;
    scored: number;
    conceded: number;
    /** Ligová hladina pro TENHLE zápas z pohledu týmu (doma vs venku). */
    refFor: number;
    refAgainst: number;
    weight: number;
  }
  const obs: Obs[] = [];

  const totalRef = (opts.home + opts.away) / 2;

  for (const m of matches) {
    const t = Date.parse(m.date);
    if (!(t < now)) continue; // jen minulost
    const weight = Math.pow(0.5, (now - t) / halfLifeMs) * (m.weight ?? 1);
    if (weight < 0.01) continue; // zanedbatelné, ať se to nevleče

    const w = opts.xgWeight;
    const homeVal = m.homeXg != null ? m.homeGoals * (1 - w) + m.homeXg * w : m.homeGoals;
    const awayVal = m.awayXg != null ? m.awayGoals * (1 - w) + m.awayXg * w : m.awayGoals;

    // Neutrální půda → obě strany stejným měřítkem (žádná domácí výhoda).
    const refHome = m.neutral ? totalRef : opts.home;
    const refAway = m.neutral ? totalRef : opts.away;

    obs.push({
      teamId: m.homeId,
      oppId: m.awayId,
      scored: homeVal,
      conceded: awayVal,
      refFor: refHome, // doma se góly poměřují měřítkem domácích…
      refAgainst: refAway, // …a inkasované měřítkem hostů
      weight,
    });
    obs.push({
      teamId: m.awayId,
      oppId: m.homeId,
      scored: awayVal,
      conceded: homeVal,
      refFor: refAway,
      refAgainst: refHome,
      weight,
    });
  }

  const teams = new Set(obs.flatMap((o) => [o.teamId, o.oppId]));
  const attack = new Map<number, number>();
  const defense = new Map<number, number>();
  for (const id of teams) {
    attack.set(id, 1);
    defense.set(id, 1);
  }

  // Maherovo schéma: útoky při daných obranách, obrany při daných útocích, a znovu.
  // `k` (shrinkage) drží týmy s tenkým vzorkem u ligového průměru = pojistka proti šumu.
  const k = opts.shrinkMatches;
  for (let it = 0; it < opts.iterations; it++) {
    const nextAttack = new Map<number, number>();
    for (const id of teams) {
      let num = k; // shrinkage: k „zápasů" ligově průměrného výkonu
      let den = k;
      for (const o of obs) {
        if (o.teamId !== id) continue;
        // Kolik tým dal vzhledem k tomu, JAK DOBROU obranu měl proti sobě.
        num += o.weight * (o.scored / o.refFor);
        den += o.weight * (defense.get(o.oppId) ?? 1);
      }
      nextAttack.set(id, clamp(num / den, MIN_RATING, MAX_RATING));
    }

    const nextDefense = new Map<number, number>();
    for (const id of teams) {
      let num = k;
      let den = k;
      for (const o of obs) {
        if (o.teamId !== id) continue;
        // Kolik tým dostal vzhledem k tomu, JAK SILNÝ útok proti sobě měl.
        num += o.weight * (o.conceded / o.refAgainst);
        den += o.weight * (nextAttack.get(o.oppId) ?? 1);
      }
      nextDefense.set(id, clamp(num / den, MIN_RATING, MAX_RATING));
    }

    // Normalizace na ligový průměr 1.0 (jinak by celá liga mohla ujet nahoru/dolů).
    normalize(nextAttack);
    normalize(nextDefense);
    for (const id of teams) {
      attack.set(id, nextAttack.get(id)!);
      defense.set(id, nextDefense.get(id)!);
    }
  }

  const sample = new Map<number, number>();
  for (const o of obs) {
    sample.set(o.teamId, (sample.get(o.teamId) ?? 0) + o.weight);
  }

  const out = new Map<number, TeamStrength>();
  for (const id of teams) {
    out.set(id, {
      attack: attack.get(id)!,
      defense: defense.get(id)!,
      sample: sample.get(id) ?? 0,
    });
  }
  return out;
}

function normalize(m: Map<number, number>): void {
  const mean = [...m.values()].reduce((a, b) => a + b, 0) / (m.size || 1);
  if (mean <= 0) return;
  for (const [id, v] of m) m.set(id, v / mean);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
