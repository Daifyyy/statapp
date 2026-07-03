/**
 * Malý odznak s pozicí týmu v ligové tabulce (FREE kontext v seznamech Zápasy/Tipy).
 * Kompaktní, mobile-first; `null`/`undefined` (reprezentace / mimo tabulku) → nevykreslí se.
 */
export function RankBadge({ rank }: { rank?: number | null }) {
  if (rank == null) return null;
  return (
    <span
      className="shrink-0 rounded bg-background px-1 text-[10px] font-semibold leading-tight text-muted tabular-nums"
      title={`Pozice v tabulce: ${rank}.`}
    >
      {rank}.
    </span>
  );
}
