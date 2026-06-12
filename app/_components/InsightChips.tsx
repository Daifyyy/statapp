import type { Insight } from "@/lib/types";

const SEVERITY_STYLE: Record<Insight["severity"], string> = {
  info: "bg-home/10 text-home",
  warning: "bg-warning/10 text-warning",
  positive: "bg-positive/10 text-positive",
};

const SEVERITY_ICON: Record<Insight["severity"], string> = {
  info: "ⓘ",
  warning: "⚠",
  positive: "▲",
};

export function InsightChips({
  title,
  accent,
  insights,
}: {
  title: string;
  accent: "home" | "away";
  insights: Insight[];
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
          {insights.map((ins, i) => (
            <li
              key={i}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                SEVERITY_STYLE[ins.severity]
              }`}
            >
              {SEVERITY_ICON[ins.severity]} {ins.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
