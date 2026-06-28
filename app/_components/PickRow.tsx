import Link from "next/link";
import type { MatchPick } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { buildCompareHref } from "./compareHref";

/**
 * Jeden řádek tipu = zápas + predikovaná pravděpodobnost + readiness odznak + value
 * (kurz/edge). Klikací na deep-link do Porovnání, když známe „ligu" obou stran.
 * Sdílí ho tipovací záložka (`PicksApp`) i týdenní digest (`DigestApp`).
 */
export function PickRow({ pick }: { pick: MatchPick }) {
  const date = new Date(pick.kickoff).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
  });
  const time = new Date(pick.kickoff).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Klikací, když známe „ligu" obou stran (klub vždy; reprezentace po dohledání
  // konfederace každého týmu – cross-konfederační MS zápas → dvě konfederace).
  const href = buildCompareHref(pick);
  const cardClass =
    "block rounded-xl border border-border bg-surface px-3 py-2.5 shadow-sm";
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] leading-tight text-muted">
          {date} {time}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          <TeamLogo src={pick.home.logoUrl} alt={pick.home.name} size={20} />
          <span className="min-w-0 truncate font-medium text-home">{pick.home.name}</span>
          <span className="shrink-0 text-muted">–</span>
          <TeamLogo src={pick.away.logoUrl} alt={pick.away.name} size={20} />
          <span className="min-w-0 truncate font-medium text-away">{pick.away.name}</span>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
          {Math.round(pick.prob * 100)} %
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {pick.prediction.readiness.level !== "ok" && (
            <ReadinessTag readiness={pick.prediction.readiness} />
          )}
          <span className="min-w-0 truncate text-[11px] uppercase tracking-wide text-muted">
            {pick.explanation}
          </span>
        </span>
        {pick.value && <ValueBadge value={pick.value} />}
      </div>
    </>
  );
  return (
    <li>
      {href != null ? (
        <Link
          href={href}
          className={`${cardClass} transition hover:border-foreground/30`}
        >
          {inner}
        </Link>
      ) : (
        <div className={cardClass}>{inner}</div>
      )}
    </li>
  );
}

/** Odznak nízké připravenosti tipu (málo odehraných zápasů za predikcí). */
function ReadinessTag({
  readiness,
}: {
  readiness: { sample: number; level: string };
}) {
  const low = readiness.level === "low";
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        low ? "bg-warning/15 text-warning" : "bg-background text-muted"
      }`}
      title={`Predikce stojí jen na ${readiness.sample} zápasech – ber orientačně`}
    >
      {low ? "⚠ málo dat" : "ℹ vzorek"} {readiness.sample}
    </span>
  );
}

/** Kurz + edge vůči trhu. Kladný edge zvýrazněn (value), záporný tlumený. */
function ValueBadge({
  value,
}: {
  value: { odds: number; impliedProb: number; edge: number };
}) {
  const pos = value.edge > 0;
  const edgePct = Math.round(value.edge * 100);
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        pos ? "bg-positive/10 text-positive" : "bg-background text-muted"
      }`}
      title={`Kurz ${value.odds.toFixed(2)} · trh ${Math.round(value.impliedProb * 100)} % · edge ${edgePct > 0 ? "+" : ""}${edgePct} %`}
    >
      {value.odds.toFixed(2)} · {edgePct > 0 ? "+" : ""}
      {edgePct} %
    </span>
  );
}
