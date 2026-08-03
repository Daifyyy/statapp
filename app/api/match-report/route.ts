import { NextResponse } from "next/server";
import { getMatchReport } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";
import { logError } from "@/lib/logError";

/**
 * Přehled **odehraného** zápasu pro záložku Výsledky: obraz hry (kdo dominoval, typ
 * zápasu, jak kdo zahrál) a k tomu **model a trh vs. skutečnost**, pokud k zápasu máme
 * uloženou predikci.
 *
 * **FREE**: je to historie, ne budoucí tip. Co model o TOMHLE zápase říkal, se ukazuje
 * až po výkopu – přesně jako `Tip: … 71 %` v řádku výsledku; budoucí tipy zůstávají PRO.
 *
 * **Rate-limitované**, protože na studený zápas spouští upstream fetch
 * (`/fixtures/statistics`, 1 volání); pak už jede z trvalé `MatchStatCache` zdarma.
 * Predikční řádek je dotaz do DB, ne do API.
 *
 * Chybějící data → `null` v příslušném poli a 200, aby UI sekci jen skrylo místo chyby.
 * Statistiky API u části zápasů nemá (~třetina reprezentačních) a čerstvě dohraný zápas
 * je dostane s odstupem; predikci nemusel cron k zápasu vůbec stihnout. Obojí je
 * normální stav, ne selhání – a jedno nesmí schovat druhé.
 */
export async function GET(req: Request) {
  if (!allowRequest(`report:${clientKey(req)}`, 30, 60_000)) return tooMany();

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

  try {
    const { report, review, events } = await getMatchReport({
      fixtureId,
      home: { id: homeId, name: p.get("hn") ?? "Domácí" },
      away: { id: awayId, name: p.get("an") ?? "Hosté" },
      goals,
    });
    // Odehraný zápas se už nezmění → dlouhá CDN cache; šetří funkci i Neon.
    return NextResponse.json(
      { report, review, events },
      { headers: publicCache(3600, 86_400) }
    );
  } catch (e) {
    // Graceful degradace ano, neviditelná ne (CLAUDE.md: `catch` nikdy nesmí mlčet).
    logError("api/match-report", e, { fixtureId, homeId, awayId });
    return NextResponse.json({ report: null, review: null, events: [] });
  }
}
