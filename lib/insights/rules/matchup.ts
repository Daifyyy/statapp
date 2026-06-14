import type { Metric } from "@/lib/types";
import type { MatchupContext, TeamContext } from "../context";
import { perspectiveSummary } from "../context";
import type { Candidate, MatchupRule } from "../ruleTypes";
import { valueOrTotal } from "@/lib/stats/metricLookup";
import { fmt, pct } from "./util";
import { predictionReasons } from "./predictionReasons";

const SIDE = { home: "Domácí", away: "Host" } as const;

/**
 * Maticová pravidla: spojují oba týmy a predikci do výroků o souboji.
 */
export const MATCHUP_RULES: MatchupRule[] = [
  // Útok jednoho proti obraně druhého → tlak na góly.
  {
    id: "attack_vs_defense",
    category: "matchup",
    evaluate: (ctx) => {
      const out: Candidate[] = [];
      const h = mismatch(ctx.home, ctx.away, "home");
      const a = mismatch(ctx.away, ctx.home, "away");
      if (h) out.push(h);
      if (a) out.push(a);
      return out;
    },
  },

  // Gólové očekávání z predikce (Over 2.5).
  {
    id: "goal_expectation",
    category: "matchup",
    evaluate: (ctx) => {
      const o = ctx.prediction.over25;
      if (o > 0.6) return matchupCand("goal_expectation", "positive", clamp01((o - 0.6) / 0.3), `Sázka na góly (Over 2.5 ${pct(o * 100)})`);
      if (o < 0.4) return matchupCand("goal_expectation", "info", clamp01((0.4 - o) / 0.3), `Spíš opatrný zápas (Over 2.5 ${pct(o * 100)})`);
      return null;
    },
  },

  // Oba skórují.
  {
    id: "btts",
    category: "matchup",
    evaluate: (ctx) => {
      const b = ctx.prediction.bttsYes;
      if (b <= 0.6) return null;
      return matchupCand("btts", "info", clamp01((b - 0.6) / 0.3), `Oba pravděpodobně skórují (BTTS ${pct(b * 100)})`);
    },
  },

  // Střet forem (jeden hot, druhý cold).
  {
    id: "form_clash",
    category: "matchup",
    evaluate: (ctx) => {
      const hw = perspectiveSummary(ctx.home)?.form.filter((r) => r === "W").length ?? 0;
      const aw = perspectiveSummary(ctx.away)?.form.filter((r) => r === "W").length ?? 0;
      if (hw >= 4 && aw <= 1) return matchupCand("form_clash", "positive", 0.8, `Domácí ve formě (${hw}V z 5) proti tápajícímu soupeři`);
      if (aw >= 4 && hw <= 1) return matchupCand("form_clash", "positive", 0.8, `Host ve formě (${aw}V z 5) proti tápajícímu soupeři`);
      return null;
    },
  },

  // Srovnání klíčových metrik s čísly (kde má jeden výrazně navrch).
  {
    id: "metric_edge",
    category: "matchup",
    evaluate: (ctx) => {
      const out: Candidate[] = [];
      for (const e of EDGES) {
        const c = edge(ctx, e);
        if (c) out.push(c);
      }
      return out;
    },
  },

  // Vysvětlení predikce (proč favorit).
  {
    id: "prediction_explain",
    category: "matchup",
    evaluate: (ctx) => {
      const r = predictionReasons(ctx);
      if (!r.favorite || r.reasons.length === 0) return null;
      return matchupCand("prediction_explain", "info", 0.7, `Predikce favorizuje ${SIDE[r.favorite]}: ${r.reasons.join(", ")}`);
    },
  },
];

// ---- pomocné ----

interface EdgeDef {
  metric: Metric;
  minRatio: number;
  lowerBetter: boolean;
  text: string; // doplní se „(x vs y)"
}

const EDGES: EdgeDef[] = [
  { metric: "GOALS_FOR", minRatio: 0.25, lowerBetter: false, text: "silnější útok" },
  { metric: "GOALS_AGAINST", minRatio: 0.25, lowerBetter: true, text: "lepší obranu" },
  { metric: "POSSESSION", minRatio: 0.15, lowerBetter: false, text: "víc drží míč" },
  { metric: "SHOTS_ON_TARGET", minRatio: 0.3, lowerBetter: false, text: "víc střel na branku" },
  { metric: "CORNERS", minRatio: 0.3, lowerBetter: false, text: "víc standardek" },
];

function edge(ctx: MatchupContext, e: EdgeDef): Candidate | null {
  const h = valueOrTotal(ctx.home.values, e.metric, ctx.home.venue);
  const a = valueOrTotal(ctx.away.values, e.metric, ctx.away.venue);
  if (h == null || a == null) return null;
  const max = Math.max(h, a);
  if (max <= 0) return null;
  const ratio = Math.abs(h - a) / max;
  if (ratio < e.minRatio) return null;
  const homeBetter = e.lowerBetter ? h < a : h > a;
  const side = homeBetter ? "home" : "away";
  const better = homeBetter ? h : a;
  const worse = homeBetter ? a : h;
  return matchupCand(`edge_${e.metric}`, "info", clamp01(ratio), `${SIDE[side]} mají ${e.text} (${fmt(better)} vs ${fmt(worse)})`, e.metric);
}

/** Útok týmu proti (slabé) obraně soupeře. */
function mismatch(
  attacker: TeamContext,
  defender: TeamContext,
  side: "home" | "away"
): Candidate | null {
  const gf = valueOrTotal(attacker.values, "GOALS_FOR", attacker.venue);
  const ga = valueOrTotal(defender.values, "GOALS_AGAINST", defender.venue);
  if (gf == null || ga == null) return null;
  if (gf < 1.6 || ga < 1.4) return null; // silný útok vs děravá obrana
  const strength = clamp01((gf - 1.6) / 1 + (ga - 1.4) / 1) / 2 + 0.4;
  return matchupCand(
    `mismatch_${side}`,
    "warning",
    clamp01(strength),
    `Útok ${side === "home" ? "domácích" : "hostů"} (${fmt(gf)}) proti děravé obraně soupeře (${fmt(ga)}) → tlak na góly`,
    "GOALS_FOR"
  );
}

function matchupCand(
  id: string,
  severity: Candidate["severity"],
  strength: number,
  text: string,
  metric?: Candidate["metric"]
): Candidate {
  return { id, category: "matchup", severity, strength, text, metric };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
