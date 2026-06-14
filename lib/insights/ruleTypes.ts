import type { InsightCategory, InsightSeverity, Metric } from "@/lib/types";
import type { MatchupContext, TeamContext } from "./context";

/** Kandidát produkovaný pravidlem (engine z něj dopočítá skóre a scope). */
export interface Candidate {
  id: string;
  category: InsightCategory;
  severity: InsightSeverity;
  strength: number; // 0–1 jak silně pravidlo sepnulo (dle vzdálenosti od prahu)
  text: string;
  metric?: Metric;
  lowConfidence?: boolean;
}

export interface TeamRule {
  id: string;
  category: InsightCategory;
  evaluate(ctx: TeamContext): Candidate | null;
}

export interface MatchupRule {
  id: string;
  category: InsightCategory;
  evaluate(ctx: MatchupContext): Candidate | Candidate[] | null;
}
