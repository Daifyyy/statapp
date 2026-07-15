import { TeamLogo } from "./TeamLogo";
import type { LeagueTableRow, LeagueTableZone } from "@/lib/types";

/**
 * Sdílený renderer ligové tabulky (vytknuto z `TabulkyApp`, používá i Porovnání).
 * Mobile-first: úzké obrazovky skryjí rozšířené sloupce (V-R-P, forma), stránka
 * nescrolluje vodorovně. `highlightTeamIds` zvýrazní vybrané řádky (oba porovnávané
 * týmy) – `TabulkyApp` ho nepředává (výstup 1:1 jako dřív).
 */
export function StandingsTable({
  rows,
  highlightTeamIds,
}: {
  rows: LeagueTableRow[];
  highlightTeamIds?: Set<number>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
            <Th className="pl-3 text-left">#</Th>
            <Th className="text-left">Tým</Th>
            <Th title="Odehráno">Z</Th>
            <Th className="hidden sm:table-cell" title="Výhry">V</Th>
            <Th className="hidden sm:table-cell" title="Remízy">R</Th>
            <Th className="hidden sm:table-cell" title="Prohry">P</Th>
            <Th title="Skóre">Skóre</Th>
            <Th title="Rozdíl skóre">+/-</Th>
            <Th className="pr-3" title="Body">B</Th>
            <Th className="hidden md:table-cell pr-3" title="Forma (posl. 5)">Forma</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const highlight = highlightTeamIds?.has(r.teamId) ?? false;
            return (
              <tr
                key={r.teamId}
                className={`border-b border-border/60 last:border-0 ${
                  highlight ? "bg-home/5" : ""
                }`}
              >
                <td className="py-2 pl-3">
                  <span className="flex items-center gap-1.5">
                    <ZoneBar zone={r.zone} />
                    <span className="w-5 text-right font-semibold tabular-nums text-foreground">
                      {r.rank}
                    </span>
                  </span>
                </td>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <TeamLogo src={r.logoUrl} alt={r.name} size={22} />
                    <span
                      className={`truncate text-foreground ${
                        highlight ? "font-bold" : "font-medium"
                      }`}
                    >
                      {r.name}
                    </span>
                  </span>
                </td>
                <Td>{r.played}</Td>
                <Td className="hidden sm:table-cell">{r.win}</Td>
                <Td className="hidden sm:table-cell">{r.draw}</Td>
                <Td className="hidden sm:table-cell">{r.lose}</Td>
                <Td className="whitespace-nowrap">
                  {r.goalsFor}:{r.goalsAgainst}
                </Td>
                <Td
                  className={
                    r.goalsDiff > 0
                      ? "text-positive"
                      : r.goalsDiff < 0
                        ? "text-negative"
                        : ""
                  }
                >
                  {r.goalsDiff > 0 ? `+${r.goalsDiff}` : r.goalsDiff}
                </Td>
                <td className="py-2 pr-3 text-center font-bold tabular-nums text-foreground">
                  {r.points}
                </td>
                <td className="hidden py-2 pr-3 md:table-cell">
                  <FormBadges form={r.form} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`px-1.5 py-2 text-center font-medium ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-1.5 py-2 text-center tabular-nums text-muted ${className}`}>
      {children}
    </td>
  );
}

const ZONE_META: Record<LeagueTableZone, { bar: string; label: string }> = {
  champions: { bar: "bg-home", label: "Liga mistrů" },
  europa: { bar: "bg-away", label: "Evropská liga" },
  conference: { bar: "bg-positive", label: "Konferenční liga" },
  promotion: { bar: "bg-positive", label: "Postup" },
  relegation: { bar: "bg-negative", label: "Sestup" },
};

function ZoneBar({ zone }: { zone: LeagueTableZone | null }) {
  return (
    <span
      aria-hidden
      className={`h-4 w-1 shrink-0 rounded-full ${zone ? ZONE_META[zone].bar : "bg-transparent"}`}
    />
  );
}

export function ZoneLegend({ rows }: { rows: LeagueTableRow[] }) {
  // Deduplikace podle popisku (KL i postup sdílí barvu, ale jiný text).
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.zone) seen.set(ZONE_META[r.zone].label, ZONE_META[r.zone].bar);
  }
  if (seen.size === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {[...seen.entries()].map(([label, bar]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`h-3 w-1 rounded-full ${bar}`} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

function FormBadges({ form }: { form: string | null }) {
  if (!form) return <span className="text-xs text-muted">—</span>;
  // API vrací nejnovější vpravo; zobraz posledních 5.
  const letters = form.slice(-5).split("");
  return (
    <span className="flex items-center justify-end gap-0.5">
      {letters.map((c, i) => {
        const color =
          c === "W"
            ? "bg-positive/15 text-positive"
            : c === "L"
              ? "bg-negative/15 text-negative"
              : "bg-border text-muted";
        return (
          <span
            key={i}
            className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${color}`}
          >
            {c === "W" ? "V" : c === "L" ? "P" : "R"}
          </span>
        );
      })}
    </span>
  );
}
