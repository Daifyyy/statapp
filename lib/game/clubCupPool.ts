// Statický pool AI klubů pro klubový pohár (Liga mistrů-styl). Stejný princip jako
// `generateLeague` (FIKTIVNÍ kluby, žádná reálná jména bez reálných dat za nimi – appka
// nemá cross-league standings pro 12 lig najednou, aby mohla postavit reálný snapshot jako
// `nationalTeams.ts` u reprezentací), ale na rozdíl od ligy je tenhle pool STABILNÍ napříč
// hrami (ne generovaný per seed) – hráč tak časem pozná "věčné" evropské giganty stejně,
// jako `NATIONAL_TEAMS` je stabilní snapshot reprezentací.
//
// Ratingy jsou deterministicky vygenerované z FIXNÍHO interního seedu (ne živě dotahované
// ze standings jiných lig – `lib/game/` zůstává čistě offline/na zdroji nezávislé).
// Budoucí vylepšení: nahradit reálným snapshotem přes cross-league fetch skript, analogicky
// k `npm run build-national-teams`, až bude k dispozici.
//
// ID prostor je záměrně mimo dosah reálných API-Football id (ty jsou dnes v řádu tisíců až
// nízkých statisíců) i mimo fiktivní ligu (`generateLeague` používá 1..20) – žádná kolize.

import { mulberry32 } from "./rng";
import { HOME_BOOST_MAX, HOME_BOOST_MIN } from "./balance";
import type { GameTeam } from "./types";

const POOL_ID_BASE = 9_000_000;
/** Fixní interní seed – pool musí být stabilní napříč hrami/verzemi appky. */
const POOL_SEED = 774411;

export interface ClubCupSeed {
  id: number;
  name: string;
  short: string;
  color: string;
  attack: number;
  defense: number;
  homeBoost: number;
}

const PREFIXES = ["Real", "FC", "Athletic", "Sporting", "Dynamo", "Union", "Olympic", "United"];
const PLACES = [
  "Costero", "Vantaggio", "Nordholm", "Alvarez", "Kastel", "Rivendale", "Marbrook", "Silvaro",
  "Órdago", "Belmonte", "Trevaine", "Sundwall", "Osterby", "Calvaro", "Windmere", "Fjelltun",
  "Aranmore", "Belcastro", "Dunvara", "Halsdorf", "Ibarron", "Kronholt", "Lechvale", "Montvara",
  "Novagra", "Pellastro", "Quernbeck", "Rastova", "Salzhaven", "Tornbury", "Ulvenor", "Vesnario",
  "Wardholm", "Xantoro", "Ybarren", "Zelmark", "Corvane", "Draxholm", "Erlmoor", "Fintavel",
];
const COLORS = [
  "#b91c1c", "#1d4ed8", "#047857", "#7c3aed", "#c2410c", "#0e7490", "#be123c", "#a16207",
  "#334155", "#15803d",
];

/** Tier 0 = giganti, tier 3 = nejslabší, ale stále pohárová účast (ne relegační dno). */
const TIER_COUNTS = [8, 10, 12, 10] as const;
const TIER_BASE: { attack: number; defense: number }[] = [
  { attack: 2.05, defense: 0.95 },
  { attack: 1.75, defense: 1.05 },
  { attack: 1.55, defense: 1.15 },
  { attack: 1.35, defense: 1.25 },
];

function buildPool(): ClubCupSeed[] {
  const rand = mulberry32(POOL_SEED);
  const out: ClubCupSeed[] = [];
  let idx = 0;
  for (let tier = 0; tier < TIER_COUNTS.length; tier++) {
    const base = TIER_BASE[tier];
    for (let i = 0; i < TIER_COUNTS[tier]; i++) {
      const prefix = PREFIXES[idx % PREFIXES.length];
      const place = PLACES[idx % PLACES.length];
      const attack = round2(clamp(base.attack + jitter(rand), 0.95, 2.35));
      const defense = round2(clamp(base.defense + jitter(rand), 0.75, 1.85));
      const homeBoost = round2(HOME_BOOST_MIN + rand() * (HOME_BOOST_MAX - HOME_BOOST_MIN));
      out.push({
        id: POOL_ID_BASE + idx,
        name: `${prefix} ${place}`,
        short: place.slice(0, 3).toUpperCase(),
        color: COLORS[idx % COLORS.length],
        attack,
        defense,
        homeBoost,
      });
      idx++;
    }
  }
  return out;
}

export const CLUB_CUP_POOL: ClubCupSeed[] = buildPool();

export function clubCupSeedToGameTeam(s: ClubCupSeed): GameTeam {
  return {
    id: s.id,
    name: s.name,
    short: s.short,
    color: s.color,
    attack: s.attack,
    defense: s.defense,
    homeBoost: s.homeBoost,
  };
}

function jitter(rand: () => number): number {
  return (rand() - 0.5) * 0.24;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
