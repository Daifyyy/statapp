import type { ScoredInsight } from "@/lib/types";
import { CATEGORY_ICON } from "./insightStyle";

/** Řazený seznam nejdůležitějších signálů zápasu (napříč oběma týmy). */
export function KeySignals({ signals }: { signals: ScoredInsight[] }) {
  if (signals.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Klíčové signály
      </p>
      <ul className="space-y-1.5">
        {signals.map((s) => (
          <li
            key={`${s.scope}-${s.id}`}
            title={s.lowConfidence ? "Malý vzorek – orientační" : undefined}
            className={`flex items-start gap-2 text-sm ${
              s.lowConfidence ? "opacity-60" : ""
            }`}
          >
            <span className="shrink-0" aria-hidden>
              {CATEGORY_ICON[s.category]}
            </span>
            <span className="leading-snug">
              <SeverityDot severity={s.severity} />
              <span className={scopeColor(s.scope)}>{s.text}</span>
              {s.lowConfidence ? " *" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function scopeColor(scope: ScoredInsight["scope"]): string {
  if (scope === "home") return "text-home font-medium";
  if (scope === "away") return "text-away font-medium";
  return "text-foreground";
}

function SeverityDot({ severity }: { severity: ScoredInsight["severity"] }) {
  const color =
    severity === "positive"
      ? "bg-positive"
      : severity === "warning"
        ? "bg-warning"
        : "bg-muted";
  return (
    <span
      className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${color}`}
      aria-hidden
    />
  );
}
