import {
  EVENT_ICON,
  EVENT_LABEL,
  formatMinute,
  type MatchEvent,
} from "@/lib/stats/matchEvents";

/**
 * Průběh zápasu: góly, karty a střídání na časové ose.
 *
 * Sdílí ji **dohraný** (`MatchReportPanel`) i **živý** zápas (`LiveReportPanel`) – je to
 * týž seznam, jen u živého roste. Druhá kopie by se rozešla přesně jako u rozměrů
 * přehledu, kde je proto `buildMatchDimensions` jediná.
 *
 * Mobile-first: domácí vlevo, hosté vpravo, minuta uprostřed. Jméno se zkracuje
 * (`truncate`), aby dlouhé jméno nerozšířilo řádek a nerozjelo vodorovný scroll.
 */
export function EventTimeline({
  events,
  homeTeamId,
  /** Živý zápas: nejnovější nahoru (co se právě stalo, je to zajímavé). */
  newestFirst = false,
}: {
  events: MatchEvent[];
  homeTeamId: number;
  newestFirst?: boolean;
}) {
  if (events.length === 0) return null;
  const list = newestFirst ? [...events].reverse() : events;

  return (
    <div className="border-t border-border pt-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Průběh zápasu
      </p>
      <ul className="space-y-1">
        {list.map((e, i) => {
          const home = e.teamId === homeTeamId;
          return (
            <li
              key={`${e.minute}-${e.extra ?? 0}-${e.kind}-${e.player ?? i}`}
              className="flex items-center gap-2 text-[11px]"
            >
              <span className={`min-w-0 flex-1 ${home ? "text-left" : "text-right order-3"}`}>
                <EventText event={e} />
              </span>
              <span className="order-2 flex shrink-0 items-center gap-1 tabular-nums text-muted">
                <span aria-hidden>{EVENT_ICON[e.kind]}</span>
                {/* Ikona sama význam nenese – pro odečítač je tu slovo. */}
                <span className="sr-only">{EVENT_LABEL[e.kind]}</span>
                <span className="w-9 text-center">{formatMinute(e)}</span>
              </span>
              {/* Prázdná protistrana drží minutu ve středu i u jednostranných událostí. */}
              <span className={`min-w-0 flex-1 ${home ? "order-3" : "order-1"}`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EventText({ event }: { event: MatchEvent }) {
  const { kind, player, assist } = event;
  if (kind === "sub") {
    return (
      <span className="block truncate text-muted">
        {assist ?? "?"} <span className="text-positive">▲</span>{" "}
        <span className="text-negative">▼</span> {player ?? "?"}
      </span>
    );
  }
  return (
    <span className="block truncate">
      <span className="font-medium text-foreground">{player ?? "—"}</span>
      {kind === "ownGoal" && <span className="text-negative"> (vlastní)</span>}
      {kind === "penalty" && <span className="text-muted"> (penalta)</span>}
      {assist && <span className="text-muted"> · {assist}</span>}
    </span>
  );
}
