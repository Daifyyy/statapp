import type { Scorer } from "@/lib/types";

/**
 * Nejlepší střelci jednoho týmu ze žebříčku ligy (jméno — góly). Líně načítané, FREE
 * kontext v Porovnání. Prázdný seznam = nevykreslí se (řeší rodič).
 */
export function ScorerList({
  title,
  accent,
  scorers,
}: {
  title: string;
  accent: "home" | "away";
  scorers: Scorer[];
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${color}`}>
        ⚽ {title}{" "}
        <span className="font-normal text-muted">· Střelci v lize</span>
      </p>
      <ul className="space-y-1 text-xs">
        {scorers.map((s) => (
          <li key={s.playerId} className="flex justify-between gap-2">
            <span className="min-w-0 truncate font-medium text-foreground">{s.name}</span>
            <span className="shrink-0 text-right font-semibold tabular-nums text-muted">
              {s.goals} gól{golSuffix(s.goals)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// České skloňování: 1 gól, 2–4 góly, 5+ gólů.
function golSuffix(n: number): string {
  if (n === 1) return "";
  if (n >= 2 && n <= 4) return "y";
  return "ů";
}
