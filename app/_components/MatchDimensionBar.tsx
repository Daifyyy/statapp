import type { MatchDimension } from "@/lib/stats/matchReport";

/**
 * Vizuální primitivy sdílené přehledem **dohraného** (`MatchReportPanel`) a
 * **probíhajícího** (`LiveReportPanel`) zápasu.
 *
 * Sdílí se jen kreslení, ne interpretace – přesně stejná dělící čára jako v `lib/stats`,
 * kde oba reporty berou rozměry z jedné funkce (`buildMatchDimensions`), ale prahy a věty
 * mají vlastní. Dvě kopie tohohle pruhu by se rozešly při první úpravě odsazení.
 */

/** Jeden rozměr jako protilehlé pruhy – vizuálně shodné s Kategoriemi v Porovnání. */
export function DimensionBar({ dim }: { dim: MatchDimension }) {
  if (!dim.available) return null;
  // Hostující strana se dopočítává z už zaokrouhlené domácí (viz `pairOf`), takže
  // `100 - homeShare` vždy sedí na čísla nad pruhem. Nezávislé zaokrouhlení by dalo 10.1.
  const homeShare = dim.home * 10;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold tabular-nums text-home">{dim.home.toFixed(1)}</span>
        <span className="min-w-0 flex-1 truncate text-center uppercase tracking-wide text-muted">
          {dim.label}
        </span>
        <span className="font-semibold tabular-nums text-away">{dim.away.toFixed(1)}</span>
      </div>
      <div className="relative mt-1 flex h-2 overflow-hidden rounded-full bg-border/60">
        <div className="bar-fill bg-home/80" style={{ width: `${homeShare}%` }} />
        <div className="bar-fill bg-away/80" style={{ width: `${100 - homeShare}%` }} />
      </div>
      {dim.detail && (
        <p className="mt-0.5 text-center text-[10px] text-muted">{dim.detail}</p>
      )}
    </div>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}
