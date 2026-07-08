// Náhodné manažerské eventy – deterministické dle (seed, kolo), malá kurátorovaná sada.
// Event má 2 volby; každá volba je čistá DATA (morálka / kondice / dočasný modifikátor /
// skauting / rozvojový bonus), takže applyEventChoice je serializovatelná a bezpečná.
// Choices žijí v registru, na SeasonState se drží jen odkaz `pendingEvent {id, round}`.
//
// Dvě pravidla, kterými se sada řídí:
//  1. **Žádná volba nesmí být zadarmo lepší.** Každá má cenu v jiné měně (morálka vs. λ
//     vs. kondice), aby šlo o rozhodnutí, ne o hledání jediné správné odpovědi.
//  2. **Event musí sedět na stav.** `condition` filtruje sadu podle situace – „Krizová
//     porada" nemá padnout ve vítězné sérii. Bez toho jsou eventy jen barevný šum.
//
// Pozn.: nezávisí na `analysis.ts` (to importuje `engine.ts`, které importuje tenhle
// soubor → cyklus). Formu si počítá lokálně ze `state.results`.

import { mulberry32, deriveSeed } from "./rng";
import { EVENT_CHANCE } from "./balance";
import { teamStrengthScore } from "./leagues";
import type { PendingEvent, SeasonState } from "./types";

interface EventChoiceEffect {
  /** Změna morálky (±). */
  moraleDelta?: number;
  /** Změna kondice (±). */
  fitnessDelta?: number;
  /** Bonus k rozvojovým bodům na konci sezóny. */
  devBonus?: number;
  /** Na kolik kol zvýšit spolehlivost scoutingu. */
  scoutBoostRounds?: number;
  /** Dočasný λ modifikátor: platí `rounds` kol od aktuálního. */
  modifier?: { attack?: number; concede?: number; rounds: number; label: string };
}

export interface EventChoice {
  label: string;
  detail: string;
  effect: EventChoiceEffect;
}

export interface GameEvent {
  id: string;
  title: string;
  text: string;
  /** Kdy event vůbec smí padnout. Bez podmínky = kdykoliv. */
  condition?: (state: SeasonState) => boolean;
  choices: EventChoice[];
}

// ───────────────────────── predikáty pro `condition` ─────────────────────────

/** Posledních `n` výsledků tvého týmu (nejstarší → nejnovější). */
function yourForm(state: SeasonState, n: number): ("W" | "D" | "L")[] {
  const out: ("W" | "D" | "L")[] = [];
  for (const r of state.results) {
    const isHome = r.homeId === state.yourTeamId;
    const isAway = r.awayId === state.yourTeamId;
    if (!isHome && !isAway) continue;
    const forG = isHome ? r.homeGoals : r.awayGoals;
    const agG = isHome ? r.awayGoals : r.homeGoals;
    out.push(forG > agG ? "W" : forG < agG ? "L" : "D");
  }
  return out.slice(-n);
}

/** Kolik z posledních `n` zápasů tvůj tým udržel čisté konto. */
function recentCleanSheets(state: SeasonState, n: number): number {
  const mine = state.results.filter(
    (r) => r.homeId === state.yourTeamId || r.awayId === state.yourTeamId
  );
  return mine.slice(-n).filter((r) => (r.homeId === state.yourTeamId ? r.awayGoals : r.homeGoals) === 0)
    .length;
}

/** Soupeř v nejbližším kole (nebo null, když je sezóna dohraná). */
function nextOpponentId(state: SeasonState): number | null {
  const fixtures = state.schedule[state.round];
  if (!fixtures) return null;
  const f = fixtures.find(
    (x) => x.homeId === state.yourTeamId || x.awayId === state.yourTeamId
  );
  if (!f) return null;
  return f.homeId === state.yourTeamId ? f.awayId : f.homeId;
}

/** Blíží se zápas se špičkou ligy (top 3 dle síly)? */
function bigMatchAhead(state: SeasonState): boolean {
  const oppId = nextOpponentId(state);
  if (oppId === null) return false;
  const ranked = [...state.teams].sort((a, b) => teamStrengthScore(b) - teamStrengthScore(a));
  return ranked.slice(0, 3).some((t) => t.id === oppId);
}

const inCrisis = (s: SeasonState) =>
  s.morale < 40 || yourForm(s, 3).filter((f) => f === "L").length >= 2;
const playedAtLeast = (n: number) => (s: SeasonState) => yourForm(s, 99).length >= n;
const tired = (s: SeasonState) => s.fitness < 70;

/** Kurátorovaná sada eventů. */
export const EVENTS: GameEvent[] = [
  {
    id: "dressing_room",
    title: "Napětí v kabině",
    text: "Dva klíčoví hráči se pohádali na tréninku.",
    choices: [
      {
        label: "Tvrdý přístup",
        detail: "Disciplína teď, nálada trochu dolů.",
        effect: {
          moraleDelta: -4,
          modifier: { concede: 0.93, rounds: 2, label: "Utažená disciplína" },
        },
      },
      {
        label: "Usmířit tým",
        detail: "Zvedneš náladu, žádný taktický zisk.",
        effect: { moraleDelta: 7 },
      },
    ],
  },
  {
    id: "key_injury",
    title: "Zranění opory",
    text: "Tvoje hvězda se zranila a vypadne na několik zápasů.",
    choices: [
      {
        label: "Zavřít obranu",
        detail: "Uber vzadu na úkor útoku.",
        effect: {
          modifier: { attack: 0.9, concede: 0.95, rounds: 3, label: "Bez opory" },
        },
      },
      {
        label: "Vsadit na útok",
        detail: "Zakryješ ztrátu ofenzivou, ale riskuješ.",
        effect: {
          moraleDelta: 3,
          modifier: { concede: 1.08, rounds: 2, label: "Odvážná náhrada" },
        },
      },
    ],
  },
  {
    id: "media_pressure",
    title: "Mediální tlak",
    text: "Média zpochybňují tvou práci po nevýrazných výsledcích.",
    condition: (s) => s.morale < 55,
    choices: [
      {
        // Dřív +5 morálky bez ceny → striktně dominovalo volbu B. Teď stojí soustředění.
        label: "Postavit se tlaku",
        detail: "Semkne to tým, ale bere ti to hlavu z tréninku.",
        effect: {
          moraleDelta: 5,
          modifier: { attack: 0.97, rounds: 1, label: "Rozptýlení tiskovkou" },
        },
      },
      {
        label: "Odstřihnout média",
        detail: "Klid na práci, ale chladná šatna.",
        effect: {
          moraleDelta: -2,
          modifier: { attack: 1.06, rounds: 2, label: "Klid na práci" },
        },
      },
    ],
  },
  {
    id: "board_confidence",
    title: "Důvěra vedení",
    text: "Vedení ti veřejně vyjádřilo podporu.",
    condition: (s) => s.morale >= 50,
    choices: [
      {
        label: "Poděkovat a makat",
        detail: "Sebevědomí nahoru.",
        effect: { moraleDelta: 6 },
      },
      {
        label: "Slíbit poháry",
        detail: "Velký tlak, velká odměna.",
        effect: {
          moraleDelta: 2,
          modifier: { attack: 1.06, concede: 1.03, rounds: 2, label: "Ofenzivní příkaz" },
        },
      },
    ],
  },
  {
    id: "board_bonus",
    title: "Nabídka vedení",
    text: "Vedení uvolnilo mimořádné peníze — můžeš je dát do klubu, nebo hráčům na prémie.",
    choices: [
      {
        label: "Investovat do klubu",
        detail: "+1 rozvojový bod na konci sezóny, hráči zklamaní.",
        effect: { devBonus: 1, moraleDelta: -4 },
      },
      {
        label: "Rozdělit hráčům na prémie",
        detail: "Šatna nadšená, klub z toho nic nemá.",
        effect: { moraleDelta: 7 },
      },
    ],
  },
  {
    id: "youth_spark",
    title: "Jiskra z akademie",
    text: "Mladík z akademie válí na tréninku.",
    // Dává smysl jen když do mládeže vůbec investuješ.
    condition: (s) => s.youth >= 1,
    choices: [
      {
        label: "Hodit ho do ohně",
        detail: "Energie a překvapení, ale nezkušenost vzadu.",
        effect: {
          moraleDelta: 3,
          modifier: { attack: 1.07, concede: 1.03, rounds: 2, label: "Mladá krev" },
        },
      },
      {
        label: "Nechat dozrát",
        detail: "Bez rizika, bez zisku.",
        effect: { moraleDelta: 1 },
      },
    ],
  },
  {
    id: "goalkeeper_injury",
    title: "Zranění brankáře",
    text: "Jednička v bráně vypadává na několik zápasů se svalovým zraněním.",
    choices: [
      {
        label: "Nasadit mladou dvojku",
        detail: "Nezkušenost může stát body.",
        effect: {
          moraleDelta: -2,
          modifier: { concede: 1.07, rounds: 3, label: "Nezkušený gólman" },
        },
      },
      {
        label: "Přeorganizovat obranu",
        detail: "Víc opatrnosti, míň risku vzadu.",
        effect: {
          modifier: { attack: 0.94, concede: 0.92, rounds: 3, label: "Kryjeme gólmana" },
        },
      },
    ],
  },
  {
    id: "captain_dispute",
    title: "Spor s kapitánem",
    text: "Kapitán nesouhlasí s tvým taktickým směřováním a chce to řešit veřejně.",
    choices: [
      {
        // Dřív čistý postih −3 bez jakékoliv kompenzace → volba bez smyslu.
        label: "Postavit se za autoritu",
        detail: "Šatna zmlkne a srovná se — za cenu nálady.",
        effect: {
          moraleDelta: -3,
          modifier: { concede: 0.95, rounds: 2, label: "Jasná autorita" },
        },
      },
      {
        label: "Vyslyšet připomínky",
        detail: "Ústupek zvedne náladu, ale oslabí tvé slovo.",
        effect: {
          moraleDelta: 6,
          modifier: { concede: 1.04, rounds: 2, label: "Rozvolněná disciplína" },
        },
      },
    ],
  },
  {
    id: "reserve_reinforcement",
    title: "Posila z rezervy",
    text: "Hráč z rezervního týmu tě přesvědčil, že si zaslouží šanci v sestavě.",
    choices: [
      {
        label: "Dát mu prostor",
        detail: "Prostřídáš a odpočineš si — ale sestava není sehraná.",
        effect: {
          moraleDelta: 2,
          fitnessDelta: 6,
          modifier: { attack: 0.97, concede: 1.03, rounds: 1, label: "Nesehraná sestava" },
        },
      },
      {
        // Dřív „morale 0" = prázdná volba. Teď má cenu v kondici (žádná rotace).
        label: "Držet se osvědčené sestavy",
        detail: "Jistota kvality, ale opory se nezastaví.",
        effect: { fitnessDelta: -5 },
      },
    ],
  },
  {
    id: "clean_sheet_confidence",
    title: "Sebevědomí v obraně",
    text: "Obrana si v posledních zápasech věří jako nikdy — hráči chtějí risknout víc vepředu.",
    condition: (s) => recentCleanSheets(s, 3) >= 2,
    choices: [
      {
        label: "Uvolnit obranu dopředu",
        detail: "Víc ofenzivy z beků, riziko vzadu.",
        effect: {
          moraleDelta: 3,
          modifier: { attack: 1.05, concede: 1.05, rounds: 2, label: "Útočící obrana" },
        },
      },
      {
        label: "Nechat obranu na svém místě",
        detail: "Proč měnit to, co funguje.",
        effect: { moraleDelta: 2 },
      },
    ],
  },
  {
    id: "losing_streak_crisis",
    title: "Krizová porada",
    text: "Série proher tlačí na tým — vedení kabiny žádá okamžitou reakci.",
    condition: inCrisis,
    choices: [
      {
        label: "Tvrdý trénink navíc",
        detail: "Zvýšíš nasazení, ale tým je unavený.",
        effect: {
          moraleDelta: -1,
          fitnessDelta: -8,
          modifier: { concede: 0.93, rounds: 2, label: "Utažená defenziva" },
        },
      },
      {
        label: "Uvolnit atmosféru",
        detail: "Stmelovací večer místo dřiny — risk, že to nezabere.",
        effect: { moraleDelta: 5, fitnessDelta: 3 },
      },
    ],
  },
  {
    id: "fan_protest",
    title: "Fanouškovský protest",
    text: "Část fanoušků si před stadionem stěžuje na výsledky a styl hry.",
    condition: (s) => s.morale < 45,
    choices: [
      {
        // Dřív čistý postih −2. Teď se tým aspoň semkne dozadu.
        label: "Ignorovat tlak zvenčí",
        detail: "Chladnější atmosféra, zato semknutá obrana.",
        effect: {
          moraleDelta: -2,
          modifier: { concede: 0.96, rounds: 2, label: "Semknutá obrana" },
        },
      },
      {
        label: "Slíbit ofenzivnější fotbal",
        detail: "Fanoušci spokojeni, závazek tě tlačí hrát nahoru.",
        effect: {
          moraleDelta: 4,
          modifier: { attack: 1.05, concede: 1.04, rounds: 2, label: "Slib ofenzivy" },
        },
      },
    ],
  },
  {
    id: "derby_motivation",
    title: "Velký zápas na obzoru",
    text: "Blíží se zápas se špičkou ligy a celé město o ničem jiném nemluví.",
    condition: (s) => bigMatchAhead(s),
    choices: [
      {
        // Dřív +5 morálky A +6 % útoku bez postihu = free lunch. Emoce teď otevřou hru.
        label: "Vyhecovat kabinu",
        detail: "Emoce nahoru, ale otevřená hra vzadu bolí.",
        effect: {
          moraleDelta: 5,
          modifier: { attack: 1.06, concede: 1.05, rounds: 1, label: "Derby nasazení" },
        },
      },
      {
        label: "Držet chladnou hlavu",
        detail: "Bez emočního výkyvu, zato beze ztrát vzadu.",
        effect: { moraleDelta: 1 },
      },
    ],
  },
  {
    id: "international_break_fatigue",
    title: "Únava z reprezentační pauzy",
    text: "Několik opor se vrátilo z reprezentace unavených a s nabušeným programem.",
    condition: tired,
    choices: [
      {
        label: "Šetřit unavené hráče",
        detail: "Míň sil vepředu, ale svěžejší nohy.",
        effect: {
          fitnessDelta: 10,
          modifier: { attack: 0.93, rounds: 2, label: "Šetření po repre pauze" },
        },
      },
      {
        label: "Spolehnout se na profesionalitu",
        detail: "Žádné šetření — riskuješ pokles výkonu.",
        effect: {
          moraleDelta: -1,
          fitnessDelta: -4,
          modifier: { concede: 1.05, rounds: 1, label: "Unavený tým" },
        },
      },
    ],
  },
  {
    id: "recovery_week",
    title: "Volný týden v programu",
    text: "Rozlosování ti dalo týden navíc. Regenerace, nebo dvoufázové tréninky?",
    condition: playedAtLeast(3),
    choices: [
      {
        label: "Regenerace",
        detail: "Tým si odpočine, nic víc.",
        effect: { fitnessDelta: 14, moraleDelta: 1 },
      },
      {
        label: "Dvoufázové tréninky",
        detail: "Dřina se vyplatí na hřišti, ale sáhneš si na dno.",
        effect: {
          fitnessDelta: -10,
          modifier: { attack: 1.05, concede: 0.96, rounds: 2, label: "Vydřená forma" },
        },
      },
    ],
  },
  {
    id: "scout_investment",
    title: "Nabídka skautského týmu",
    text: "Skauti chtějí rozpočet na podrobnou analýzu nejbližších soupeřů.",
    choices: [
      {
        label: "Zaplatit analýzu",
        detail: "Příští tři kola víš o soupeři skoro jistě — na úkor rozvoje klubu.",
        effect: { scoutBoostRounds: 3, devBonus: -1 },
      },
      {
        label: "Spolehnout se na vlastní oko",
        detail: "Ušetříš, ale hlášení zůstane nejisté.",
        effect: { moraleDelta: 1 },
      },
    ],
  },
];

/** Vyhledá event dle id (pro UI render z pendingEvent). */
export function getEvent(id: string): GameEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}

/**
 * Rozhodne, zda v aktuálním kole `state.round` nastane event. Losuje jen z eventů, jejichž
 * `condition` na daný stav sedí. Deterministické dle (seed, kolo) – salt 90000 odděluje
 * RNG od simulace zápasů (`deriveSeed(seed, round)`) i od scoutingu (salt 70000).
 * Stav je odvozený ze seedu, takže je to reprodukovatelné i po reloadu.
 */
export function maybeEvent(state: SeasonState): PendingEvent | null {
  const rand = mulberry32(deriveSeed(state.seed, 90000 + state.round));
  if (rand() >= EVENT_CHANCE) return null;
  const eligible = EVENTS.filter((e) => !e.condition || e.condition(state));
  if (eligible.length === 0) return null;
  const idx = Math.floor(rand() * eligible.length);
  return { id: eligible[idx].id, round: state.round };
}

/**
 * Aplikuje zvolenou možnost pendingEventu: morálka / kondice / rozvojový bonus / scouting
 * + případný dočasný modifikátor (platí `rounds` kol od aktuálního), a vyčistí pendingEvent.
 * Čistá funkce.
 */
export function applyEventChoice(state: SeasonState, choiceIndex: number): SeasonState {
  const pe = state.pendingEvent;
  if (!pe) return state;
  const ev = getEvent(pe.id);
  const choice = ev?.choices[choiceIndex];
  if (!choice) return { ...state, pendingEvent: null };
  const e = choice.effect;

  const morale = e.moraleDelta ? clamp(state.morale + e.moraleDelta, 0, 100) : state.morale;
  const fitness = e.fitnessDelta ? clamp(state.fitness + e.fitnessDelta, 0, 100) : state.fitness;
  const devBonus = e.devBonus ? state.devBonus + e.devBonus : state.devBonus;
  const scoutBoostUntilRound = e.scoutBoostRounds
    ? state.round + e.scoutBoostRounds - 1
    : state.scoutBoostUntilRound;

  const modifiers = state.modifiers.slice();
  if (e.modifier) {
    const m = e.modifier;
    modifiers.push({
      untilRound: state.round + m.rounds - 1,
      attack: m.attack,
      concede: m.concede,
      label: m.label,
    });
  }
  return {
    ...state,
    morale,
    fitness,
    devBonus,
    scoutBoostUntilRound,
    modifiers,
    pendingEvent: null,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
