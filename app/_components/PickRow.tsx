import Link from "next/link";
import type { MatchPick } from "@/lib/types";
import { TeamLogo } from "./TeamLogo";
import { RankBadge } from "./RankBadge";
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
          <RankBadge rank={pick.homeRank} />
          <span className="shrink-0 text-muted">–</span>
          <TeamLogo src={pick.away.logoUrl} alt={pick.away.name} size={20} />
          <span className="min-w-0 truncate font-medium text-away">{pick.away.name}</span>
          <RankBadge rank={pick.awayRank} />
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

/**
 * Kurz + o kolik se model liší od trhu.
 *
 * Ukazuje se **rozdíl proti férové (odmaržované) ceně**, ne EV proti vyplácenému kurzu:
 * v kurzu je marže 3–4 %, takže „edge +3 %" znamená ve skutečnosti nulu. Odznak proto
 * není příslib zisku (backtest ukázal, že model trh neporazí) – je to informace
 * „tady se s trhem rozcházíme".
 */
function ValueBadge({
  value,
}: {
  value: {
    odds: number;
    impliedProb: number;
    edge: number;
    fairProb: number | null;
    edgeFair: number | null;
    best: { odds: number; bookmaker: string; books: number; edge: number } | null;
  };
}) {
  // Bez protistrany trhu (starší řádky) férovou cenu neznáme → jen kurz, žádné procento.
  const diff = value.edgeFair;
  const pct = diff == null ? null : Math.round(diff * 100);
  const pos = pct != null && pct > 0;
  const marketPct = Math.round((value.fairProb ?? value.impliedProb) * 100);
  // Nejlepší cena se ukazuje, jen když je REÁLNĚ lepší než referenční – jinak by
  // odznak přibyl na každém řádku a nic neřekl.
  const best = value.best && value.best.odds > value.odds ? value.best : null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
          pos ? "bg-positive/10 text-positive" : "bg-background text-muted"
        }`}
        title={
          `Kurz ${value.odds.toFixed(2)} · trh ${marketPct} %` +
          (pct == null
            ? " (férovou cenu neznáme – chybí protistrana trhu)"
            : ` · lišíme se o ${pct > 0 ? "+" : ""}${pct} p.b. proti férové ceně`)
        }
      >
        {value.odds.toFixed(2)}
        {pct != null && (
          <>
            {" · "}
            {pct > 0 ? "+" : ""}
            {pct} p.b.
          </>
        )}
      </span>
      {best && (
        <span
          className="rounded-full bg-positive/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-positive"
          title={
            `Nejlepší cena napříč ${best.books} sázkovkami: ${best.odds.toFixed(2)} ` +
            `(${best.bookmaker}) proti referenčnímu ${value.odds.toFixed(2)}. ` +
            `Výběr nejlepší ceny je jediná páka, která v backtestu prokazatelně ` +
            `zabrala (ROI −7.7 % → −5.2 %).`
          }
        >
          ⌃ {best.odds.toFixed(2)}
        </span>
      )}
    </span>
  );
}
