import type { LeagueScorer } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";

/**
 * Žebříček střelců/nahrávek CELÉ ligy (záložka Tabulky) – na rozdíl od `ScorerList`
 * (per tým v Porovnání) nese u každého řádku i klub, protože jde napříč týmy.
 */
export function LeagueScorerList({
  title,
  unit,
  players,
}: {
  title: string;
  /** Jednotka čísla vpravo, např. "gólů" nebo "asistencí". */
  unit: string;
  players: LeagueScorer[];
}) {
  if (players.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <ul className="space-y-1.5 text-xs">
        {players.map((p, i) => (
          <li key={p.playerId} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-right text-muted">{i + 1}.</span>
            <TeamLogo src={p.teamLogo} alt={p.teamName} size={18} />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {p.name}
            </span>
            <span className="shrink-0 text-right font-semibold tabular-nums text-muted">
              {p.value} {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
