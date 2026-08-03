import { TeamLogo } from "./TeamLogo";
import { Hint } from "./Hint";
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
            {/* Zkratky sloupců nesly význam jen v `title=`, který na dotykovém displeji
                nejde vyvolat – a na mobilu je navíc vidět jen `Z / Skóre / +/- / B`,
                takže tabulka zůstala bez klíče právě tam, kde se nejvíc čte. */}
            <Th className="pl-3 text-left">#</Th>
            <Th className="text-left">Tým</Th>
            <Th hint="Odehrané zápasy">Z</Th>
            <Th className="hidden sm:table-cell" hint="Výhry">V</Th>
            <Th className="hidden sm:table-cell" hint="Remízy">R</Th>
            <Th className="hidden sm:table-cell" hint="Prohry">P</Th>
            <Th hint="Vstřelené : obdržené góly">Skóre</Th>
            <Th hint="Rozdíl skóre (vstřelené − obdržené)">+/-</Th>
            <Th className="pr-3" hint="Body" align="end">
              B
            </Th>
            <Th
              className="hidden md:table-cell pr-3"
              hint="Posledních 5 zápasů, nejnovější vpravo. V = výhra, R = remíza, P = prohra."
              align="end"
            >
              Forma
            </Th>
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
  hint,
  align = "center",
}: {
  children: React.ReactNode;
  className?: string;
  hint?: string;
  /** Zarovnání bubliny – u krajních sloupců jinak přeteče mimo displej. */
  align?: "start" | "center" | "end";
}) {
  return (
    <th className={`px-1.5 py-2 text-center font-medium ${className}`}>
      {hint ? (
        <span className="inline-flex items-center gap-0.5">
          {children}
          <Hint label={String(children)} align={align}>
            {hint}
          </Hint>
        </span>
      ) : (
        children
      )}
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
  const hasForm = rows.some((r) => r.form);
  if (seen.size === 0 && !hasForm) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {[...seen.entries()].map(([label, bar]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`h-3 w-1 rounded-full ${bar}`} aria-hidden />
          {label}
        </span>
      ))}
      {/* Sloupec Forma je jediné místo, kde se výsledky kódují písmenem i barvou – bez
          klíče to na mobilu (kde je sloupec skrytý až od `md`) nikdo neodvodí. */}
      {hasForm && (
        <span className="hidden items-center gap-1.5 text-xs text-muted md:flex">
          Forma:
          <FormBadge letter="V" /> výhra
          <FormBadge letter="R" /> remíza
          <FormBadge letter="P" /> prohra
        </span>
      )}
    </div>
  );
}

/** Jedno písmeno formy v české notaci (V/R/P) – sdílí ho tabulka i legenda. */
function FormBadge({ letter }: { letter: "V" | "R" | "P" }) {
  const color =
    letter === "V"
      ? "bg-positive/15 text-positive"
      : letter === "P"
        ? "bg-negative/15 text-negative"
        : "bg-border text-muted";
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${color}`}
    >
      {letter}
    </span>
  );
}

/** API vrací W/D/L, nejnovější vpravo. V UI se všude drží české V/R/P. */
function czLetter(c: string): "V" | "R" | "P" {
  return c === "W" ? "V" : c === "L" ? "P" : "R";
}

function FormBadges({ form }: { form: string | null }) {
  if (!form) return <span className="text-xs text-muted">—</span>;
  const letters = form.slice(-5).split("");
  return (
    <span className="flex items-center justify-end gap-0.5">
      {letters.map((c, i) => (
        <FormBadge key={i} letter={czLetter(c)} />
      ))}
    </span>
  );
}
