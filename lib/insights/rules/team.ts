import type { TeamContext } from "../context";
import { perspectiveSummary } from "../context";
import type { Candidate, TeamRule } from "../ruleTypes";
import { fmt, lc, mv, pct, strengthAbove, strengthBelow } from "./util";

/**
 * Per-tým pravidla napříč metrikami (útok, obrana, tempo, standardky, disciplína,
 * brankář, přihrávky). Chybí-li metrika (reprezentace nemají xG/držení…), `total`
 * vrátí null a pravidlo se přeskočí. Texty nesou konkrétní čísla.
 */
export const TEAM_RULES: TeamRule[] = [
  // ---- Útok ----
  rule("attack_strong", "attack", (t) => {
    const v = mv(t,"GOALS_FOR");
    if (v == null || v < 1.8) return null;
    return cand("positive", strengthAbove(v, 1.8, 1.2), `Silný útok (${fmt(v)} gólu/zápas)`, "GOALS_FOR", lc(t,"GOALS_FOR"));
  }),
  rule("attack_weak", "attack", (t) => {
    const v = mv(t,"GOALS_FOR");
    if (v == null || v >= 0.9) return null;
    return cand("warning", strengthBelow(v, 0.9, 0.6), `Tupý útok (${fmt(v)} gólu/zápas)`, "GOALS_FOR", lc(t,"GOALS_FOR"));
  }),
  rule("shot_volume", "attack", (t) => {
    const v = mv(t,"SHOTS");
    if (v == null || v < 15) return null;
    return cand("positive", strengthAbove(v, 15, 6), `Hodně střílí (${fmt(v)} střel/zápas)`, "SHOTS", lc(t,"SHOTS"));
  }),
  rule("shot_accuracy", "attack", (t) => {
    const sot = mv(t,"SHOTS_ON_TARGET");
    const shots = mv(t,"SHOTS");
    if (sot == null || shots == null || shots < 5) return null;
    const ratio = sot / shots;
    if (ratio < 0.45) return null;
    return cand("positive", strengthAbove(ratio, 0.45, 0.2), `Přesná muška (${pct(ratio * 100)} na branku)`, "SHOTS_ON_TARGET", lc(t,"SHOTS_ON_TARGET"));
  }),

  // ---- Efektivita (xG) ----
  rule("xg_over", "efficiency", (t) => {
    const gf = mv(t,"GOALS_FOR");
    const xg = mv(t,"XG");
    if (gf == null || xg == null) return null;
    const d = gf - xg;
    if (d <= 0.3) return null;
    return cand("positive", strengthAbove(d, 0.3, 0.6), `Přestřeluje xG (+${fmt(d)}/zápas)`, "XG", lc(t,"XG"));
  }),
  rule("xg_under", "efficiency", (t) => {
    const gf = mv(t,"GOALS_FOR");
    const xg = mv(t,"XG");
    if (gf == null || xg == null) return null;
    const d = gf - xg;
    if (d >= -0.3) return null;
    return cand("info", strengthBelow(d, -0.3, 0.6), `Pod xG (${fmt(d)}/zápas)`, "XG", lc(t,"XG"));
  }),

  // ---- Obrana ----
  rule("defense_solid", "defense", (t) => {
    const v = mv(t,"GOALS_AGAINST");
    if (v == null || v >= 0.8) return null;
    return cand("positive", strengthBelow(v, 0.8, 0.6), `Pevná obrana (${fmt(v)} obdrženého/zápas)`, "GOALS_AGAINST", lc(t,"GOALS_AGAINST"));
  }),
  rule("defense_leaky", "defense", (t) => {
    const v = mv(t,"GOALS_AGAINST");
    if (v == null || v <= 1.6) return null;
    return cand("warning", strengthAbove(v, 1.6, 1), `Děravá obrana (${fmt(v)} obdrženého/zápas)`, "GOALS_AGAINST", lc(t,"GOALS_AGAINST"));
  }),
  rule("clean_sheets", "defense", (t) => {
    const s = perspectiveSummary(t);
    if (!s || s.cleanSheetPct == null || s.cleanSheetPct < 50) return null;
    return cand("positive", strengthAbove(s.cleanSheetPct, 50, 40), `Často čisté konto (${pct(s.cleanSheetPct)})`, "GOALS_AGAINST", s.sampleSize < 5);
  }),

  // ---- Tempo / standardky / disciplína / brankář / přihrávky ----
  rule("possession_high", "tempo", (t) => {
    const v = mv(t,"POSSESSION");
    if (v == null || v < 58) return null;
    return cand("info", strengthAbove(v, 58, 12), `Drží míč (${pct(v)} držení)`, "POSSESSION", lc(t,"POSSESSION"));
  }),
  rule("possession_low", "tempo", (t) => {
    const v = mv(t,"POSSESSION");
    if (v == null || v > 42) return null;
    return cand("info", strengthBelow(v, 42, 12), `Málo drží míč (${pct(v)} držení)`, "POSSESSION", lc(t,"POSSESSION"));
  }),
  rule("corner_threat", "setpiece", (t) => {
    const v = mv(t,"CORNERS");
    if (v == null || v < 6.5) return null;
    return cand("info", strengthAbove(v, 6.5, 3), `Hrozba ze standardek (${fmt(v)} rohů/zápas)`, "CORNERS", lc(t,"CORNERS"));
  }),
  rule("card_risk", "discipline", (t) => {
    const y = mv(t,"YELLOW_CARDS");
    const r = mv(t,"RED_CARDS");
    if (y == null) return null;
    const cards = y + (r ?? 0) * 2;
    if (cards < 2.6) return null;
    return cand("warning", strengthAbove(cards, 2.6, 1.5), `Kartové riziko (${fmt(cards)} karet/zápas)`, "YELLOW_CARDS", lc(t,"YELLOW_CARDS"));
  }),
  rule("keeper_busy", "keeper", (t) => {
    const v = mv(t,"SAVES");
    if (v == null || v < 4) return null;
    return cand("info", strengthAbove(v, 4, 3), `Vytížený brankář (${fmt(v)} zákroků/zápas)`, "SAVES", lc(t,"SAVES"));
  }),
  rule("passing_accurate", "tempo", (t) => {
    const v = mv(t,"PASS_ACCURACY");
    if (v == null || v < 87) return null;
    return cand("info", strengthAbove(v, 87, 8), `Přesná rozehrávka (${pct(v)} přihrávek)`, "PASS_ACCURACY", lc(t,"PASS_ACCURACY"));
  }),
];

// ---- helpery ----

function rule(
  id: string,
  category: TeamRule["category"],
  evaluate: (t: TeamContext) => Candidate | null
): TeamRule {
  return { id, category, evaluate: (t) => withId(id, category, evaluate(t)) };
}

/** Doplní do kandidáta id+kategorii pravidla (aby je rule nemusel opakovat). */
function withId(
  id: string,
  category: TeamRule["category"],
  c: Candidate | null
): Candidate | null {
  return c ? { ...c, id, category } : null;
}

function cand(
  severity: Candidate["severity"],
  strength: number,
  text: string,
  metric: Candidate["metric"],
  lowConfidence: boolean
): Candidate {
  // id/category doplní `withId`.
  return { id: "", category: "attack", severity, strength, text, metric, lowConfidence };
}
