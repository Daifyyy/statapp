/** Výrazná jednovětná předpověď nad predikcí. */
export function MatchVerdict({ verdict }: { verdict: string }) {
  if (!verdict) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 text-center shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Verdikt
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground sm:text-base">
        {verdict}
      </p>
    </div>
  );
}
