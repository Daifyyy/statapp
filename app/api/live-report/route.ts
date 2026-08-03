import { NextResponse } from "next/server";
import { getLiveMatchReport } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";
import { logError } from "@/lib/logError";

/**
 * Přehled **probíhajícího** zápasu (kdo zatím určuje hru) pro rozbalený řádek v Programu.
 *
 * **FREE**: popisuje, co se už stalo, ne co se stane – stejně jako přehled dohraného
 * zápasu nic predikčního neprozrazuje.
 *
 * Rate-limit je **přísnější než u `/api/match-report`** (20 vs 30 za minutu), a to
 * vědomě: tam miss většinou trefí trvalou `MatchStatCache` a nic nestojí, tady je každý
 * miss upstream volání, které se navíc nedá sdílet mezi zápasy. Náklad dál stropuje TTL
 * v `getLiveMatchStatsPair` (120 s, o poločase 600 s) – ten platí napříč všemi klienty.
 *
 * CDN cache je krátká (30 s / 60 s stale) – vzorem `/api/fixtures/live`. Dlouhá cache
 * jako u dohraného zápasu by tu byla přímo škodlivá: panel by zamrzl na staré minutě.
 */
export async function GET(req: Request) {
  if (!allowRequest(`livereport:${clientKey(req)}`, 20, 60_000)) return tooMany();

  const p = new URL(req.url).searchParams;
  const fixtureId = Number(p.get("fixture"));
  const homeId = Number(p.get("home"));
  const awayId = Number(p.get("away"));
  if (!Number.isFinite(fixtureId) || !Number.isFinite(homeId) || !Number.isFinite(awayId)) {
    return NextResponse.json({ error: "Chybí zápas nebo týmy" }, { status: 400 });
  }

  const goalsHome = Number(p.get("gh"));
  const goalsAway = Number(p.get("ga"));
  const goals =
    Number.isFinite(goalsHome) && Number.isFinite(goalsAway)
      ? { home: goalsHome, away: goalsAway }
      : null;
  const elapsedRaw = Number(p.get("el"));
  const elapsed = Number.isFinite(elapsedRaw) ? elapsedRaw : null;
  const status = p.get("st") || "2H";
  const htHome = Number(p.get("hh"));
  const htAway = Number(p.get("ha"));
  const halftime =
    Number.isFinite(htHome) && Number.isFinite(htAway)
      ? { home: htHome, away: htAway }
      : null;

  try {
    const { report, reason, events } = await getLiveMatchReport({
      fixtureId,
      home: { id: homeId, name: p.get("hn") ?? "Domácí" },
      away: { id: awayId, name: p.get("an") ?? "Hosté" },
      goals,
      elapsed,
      status,
      halftime,
    });
    // `reason` cestuje na klienta schválně: „ještě je brzy" a „statistiky nedorazily"
    // vypadají v UI stejně (prázdno), ale znamenají něco jiného – a rozbité parsování
    // se pozná právě tím, že celý zápasový den hlásí `nostats`.
    return NextResponse.json(
      { report, reason, events },
      { headers: publicCache(30, 60) }
    );
  } catch (e) {
    logError("api/live-report", e, { fixtureId });
    return NextResponse.json({ report: null, reason: "error", events: [] });
  }
}
