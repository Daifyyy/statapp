import type { InsightCategory, InsightReport, ScoredInsight } from "@/lib/types";
import type { MatchupContext, TeamContext } from "./context";
import type { Candidate } from "./ruleTypes";
import { TEAM_RULES } from "./rules/team";
import { FORM_RULES } from "./rules/form";
import { MATCHUP_RULES } from "./rules/matchup";
import { buildVerdict } from "./rules/verdict";

/** Důležitost kategorií – ladí, co se dostane mezi klíčové signály. */
const CATEGORY_WEIGHT: Record<InsightCategory, number> = {
  matchup: 1.0,
  form: 0.9,
  attack: 0.85,
  defense: 0.85,
  efficiency: 0.7,
  discipline: 0.55,
  tempo: 0.6,
  setpiece: 0.5,
  keeper: 0.5,
};

const KEY_SIGNALS_MAX = 5;
const KEY_SIGNALS_MIN_SCORE = 0.2;
const KEY_SIGNALS_MAX_PER_CATEGORY = 2;
const PER_TEAM_MAX = 6;

const ALL_TEAM_RULES = [...TEAM_RULES, ...FORM_RULES];

export function runInsightEngine(ctx: MatchupContext): InsightReport {
  const home = runTeam(ctx.home);
  const away = runTeam(ctx.away);
  const matchup = runMatchup(ctx);

  const all = [...home, ...away, ...matchup];
  const ranked = [...all].sort((a, b) => b.score - a.score);

  return {
    verdict: buildVerdict(ctx),
    keySignals: pickKeySignals(ranked),
    home: home.sort((a, b) => b.score - a.score).slice(0, PER_TEAM_MAX),
    away: away.sort((a, b) => b.score - a.score).slice(0, PER_TEAM_MAX),
  };
}

function runTeam(team: TeamContext): ScoredInsight[] {
  const out: ScoredInsight[] = [];
  for (const rule of ALL_TEAM_RULES) {
    const c = rule.evaluate(team);
    if (c) out.push(finalize(c, team.side));
  }
  return out;
}

function runMatchup(ctx: MatchupContext): ScoredInsight[] {
  const out: ScoredInsight[] = [];
  for (const rule of MATCHUP_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    for (const c of Array.isArray(res) ? res : [res]) {
      out.push(finalize(c, "matchup"));
    }
  }
  return out;
}

function finalize(c: Candidate, scope: ScoredInsight["scope"]): ScoredInsight {
  const weight = CATEGORY_WEIGHT[c.category] ?? 0.5;
  const confidenceFactor = c.lowConfidence ? 0.5 : 1;
  return {
    id: c.id,
    category: c.category,
    severity: c.severity,
    score: clamp01(c.strength) * weight * confidenceFactor,
    text: c.text,
    metric: c.metric,
    scope,
    lowConfidence: c.lowConfidence ?? false,
  };
}

/** Top N nad minimálním skóre, vyvážené (max 2 na kategorii). */
function pickKeySignals(ranked: ScoredInsight[]): ScoredInsight[] {
  const out: ScoredInsight[] = [];
  const perCategory = new Map<InsightCategory, number>();
  for (const s of ranked) {
    if (out.length >= KEY_SIGNALS_MAX) break;
    if (s.score < KEY_SIGNALS_MIN_SCORE) continue;
    const used = perCategory.get(s.category) ?? 0;
    if (used >= KEY_SIGNALS_MAX_PER_CATEGORY) continue;
    perCategory.set(s.category, used + 1);
    out.push(s);
  }
  return out;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
