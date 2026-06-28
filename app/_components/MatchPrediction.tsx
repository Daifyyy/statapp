import type { MatchPrediction as Prediction } from "@/lib/types";

/**
 * Predikce zápasu: pravděpodobnostní bar V/R/P, očekávané skóre a štítky BTTS / Over 2.5.
 * Domácí = vlevo (home accent), host = vpravo (away accent).
 */
export function MatchPrediction({
  prediction,
  homeName,
  awayName,
}: {
  prediction: Prediction;
  homeName: string;
  awayName: string;
}) {
  const { homeWin, draw, awayWin, lambdaHome, lambdaAway, bttsYes, over25, topScores } =
    prediction;
  const pct = (x: number) => Math.round(x * 100);

  if (!prediction.available) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-4 text-center shadow-sm sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Predikce
        </p>
        <p className="mt-2 text-sm text-muted">
          Nedostatek dat pro predikci – některý z týmů má příliš málo
          odehraných zápasů.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6">
      <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide">
        <span className="text-muted">
          Predikce
          {prediction.lowConfidence && (
            <span title="Malý vzorek zápasů – orientační" className="text-warning">
              {" "}
              *
            </span>
          )}
        </span>
        <span className="tabular-nums text-foreground">
          Očekávané skóre{" "}
          <strong className="text-home">{lambdaHome.toFixed(1)}</strong>
          <span className="text-muted"> – </span>
          <strong className="text-away">{lambdaAway.toFixed(1)}</strong>
        </span>
      </div>

      {prediction.readiness.level !== "ok" && (
        <ReadinessNote readiness={prediction.readiness} />
      )}

      {/* Tříbarevný pravděpodobnostní bar V / R / P */}
      <div className="flex items-center justify-between text-sm font-bold tabular-nums">
        <span className="text-home">{pct(homeWin)} %</span>
        <span className="text-muted">{pct(draw)} %</span>
        <span className="text-away">{pct(awayWin)} %</span>
      </div>
      <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-border/60">
        <div className="bar-fill bg-home/80" style={{ width: `${homeWin * 100}%` }} />
        <div className="bar-fill bg-muted/50" style={{ width: `${draw * 100}%` }} />
        <div className="bar-fill bg-away/80" style={{ width: `${awayWin * 100}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
        <span className="max-w-[40%] truncate">{homeName}</span>
        <span>Remíza</span>
        <span className="max-w-[40%] truncate text-right">{awayName}</span>
      </div>

      <div className="mt-3 flex justify-center gap-2 text-xs">
        <Chip label="Oba skórují" value={`${pct(bttsYes)} %`} />
        <Chip label="Přes 2.5 gólu" value={`${pct(over25)} %`} />
      </div>

      {topScores.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Nejpravděpodobnější výsledky
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {topScores.map((s) => (
              <span
                key={`${s.home}-${s.away}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1 text-xs"
              >
                <strong className="tabular-nums text-foreground">
                  {s.home}:{s.away}
                </strong>
                <span className="tabular-nums text-muted">{pct(s.prob)} %</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Upozornění na nízkou připravenost predikce (málo odehraných zápasů za λ). Na startu
 * sezóny je vzorek tenký → predikce stojí hlavně na minulé sezóně. „low" = silné varování,
 * „medium" = mírnější. Číslo `sample` je efektivní vzorek nejslabšího vstupu.
 */
function ReadinessNote({
  readiness,
}: {
  readiness: { sample: number; level: string };
}) {
  const low = readiness.level === "low";
  return (
    <div
      className={`mt-2 rounded-lg px-3 py-2 text-[11px] ${
        low ? "bg-warning/10 text-warning" : "bg-background text-muted"
      }`}
    >
      {low ? "⚠ Málo dat" : "ℹ Omezený vzorek"} – predikce stojí jen na{" "}
      <strong className="tabular-nums">{readiness.sample}</strong>{" "}
      {readiness.sample === 1 ? "zápase" : "zápasech"} (na startu sezóny zatím rozhoduje
      minulá sezóna). Ber orientačně.
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 font-medium text-muted">
      {label}
      <strong className="tabular-nums text-foreground">{value}</strong>
    </span>
  );
}
