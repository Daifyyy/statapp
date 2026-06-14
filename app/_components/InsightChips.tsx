import type { ScoredInsight } from "@/lib/types";
import { CATEGORY_ICON, SEVERITY_STYLE } from "./insightStyle";

/** Per-tým signály jako barevné štítky (řazené dle důležitosti, s čísly). */
export function InsightChips({
  title,
  accent,
  insights,
}: {
  title: string;
  accent: "home" | "away";
  insights: ScoredInsight[];
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${color}`}>
        💡 {title}
      </p>
      {insights.length === 0 ? (
        <p className="text-xs text-muted">Žádné výrazné signály.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {insights.map((ins) => (
            <li
              key={ins.id}
              title={ins.lowConfidence ? "Malý vzorek – orientační" : undefined}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                SEVERITY_STYLE[ins.severity]
              } ${ins.lowConfidence ? "opacity-60" : ""}`}
            >
              {CATEGORY_ICON[ins.category]} {ins.text}
              {ins.lowConfidence ? " *" : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
