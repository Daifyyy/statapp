import type { InsightCategory, InsightSeverity } from "@/lib/types";

/** Emoji dle kategorie signálu (textový význam, ne jen barva – přístupnost). */
export const CATEGORY_ICON: Record<InsightCategory, string> = {
  attack: "⚽",
  defense: "🛡️",
  form: "📈",
  tempo: "⏱️",
  setpiece: "🚩",
  discipline: "🟨",
  keeper: "🧤",
  efficiency: "🎯",
  matchup: "⚔️",
};

/** Barevný styl dle závažnosti (pozadí + text). */
export const SEVERITY_STYLE: Record<InsightSeverity, string> = {
  positive: "bg-positive/10 text-positive",
  warning: "bg-warning/10 text-warning",
  info: "bg-foreground/5 text-muted",
};
