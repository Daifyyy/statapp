import type { ScoredInsight } from "@/lib/types";
import { CATEGORY_ICON } from "./insightStyle";
import { TeamLogo } from "./TeamLogo";

interface SignalTeam {
  name: string;
  logoUrl: string;
}

/**
 * Řazený seznam nejdůležitějších signálů zápasu (napříč oběma týmy). Příslušnost
 * k týmu (`scope`) byla dřív kódovaná jen barvou textu, která navíc soutěžila s barvou
 * `SeverityDot` (ta kóduje závažnost, ne tým) → bez znalosti brand barev nešlo poznat,
 * čí signál to je. Legenda + mini logo u home/away položek to zpřehledňují; barva textu
 * zůstává jako redundantní (přístupné) kódování, ne jediný zdroj informace.
 */
export function KeySignals({
  signals,
  homeTeam,
  awayTeam,
}: {
  signals: ScoredInsight[];
  homeTeam: SignalTeam;
  awayTeam: SignalTeam;
}) {
  if (signals.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Klíčové signály
      </p>
      <Legend homeTeam={homeTeam} awayTeam={awayTeam} />
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
            {s.scope !== "matchup" && (
              <TeamLogo
                src={(s.scope === "home" ? homeTeam : awayTeam).logoUrl}
                alt={(s.scope === "home" ? homeTeam : awayTeam).name}
                size={16}
              />
            )}
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

function Legend({ homeTeam, awayTeam }: { homeTeam: SignalTeam; awayTeam: SignalTeam }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-1">
        <TeamLogo src={homeTeam.logoUrl} alt={homeTeam.name} size={14} />
        {homeTeam.name}
      </span>
      <span className="flex items-center gap-1">
        <TeamLogo src={awayTeam.logoUrl} alt={awayTeam.name} size={14} />
        {awayTeam.name}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
        pozitivní
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
        pozor
      </span>
    </div>
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
