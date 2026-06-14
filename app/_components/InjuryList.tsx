import type { Injury } from "@/lib/types";

/**
 * Seznam zraněných/absentujících hráčů jednoho týmu (jméno — důvod). Líně načítané,
 * nezávislé na přepínači Doma/Venku/Celkově (stav kádru). Prázdný seznam = nevykreslí se
 * (řeší rodič).
 */
export function InjuryList({
  title,
  accent,
  injuries,
}: {
  title: string;
  accent: "home" | "away";
  injuries: Injury[];
}) {
  const color = accent === "home" ? "text-home" : "text-away";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${color}`}>
        🏥 {title}{" "}
        <span className="font-normal text-muted">· Zranění ({injuries.length})</span>
      </p>
      <ul className="space-y-1 text-xs">
        {injuries.map((inj) => (
          <li key={inj.playerId} className="flex justify-between gap-2">
            <span className="font-medium text-foreground">{inj.name}</span>
            <span className="shrink-0 text-right text-muted">{inj.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
