import { NextResponse } from "next/server";
import { getMatchReport } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";

/**
 * Kategorický přehled **odehraného** zápasu pro záložku Výsledky (kdo dominoval, typ
 * zápasu, jak kdo zahrál).
 *
 * **FREE**: je to historie, ne budoucí tip – nic predikčního neprozrazuje, přesně jako
 * zbytek Výsledků. **Rate-limitované**, protože na studený zápas spouští upstream fetch
 * (`/fixtures/statistics`, 1 volání); pak už jede z trvalé `MatchStatCache` zdarma.
 *
 * Chybějící statistiky → `{ report: null }` a 200, aby UI ukázalo prázdný stav místo
 * chyby. API je u části zápasů nemá (~třetina reprezentačních) a čerstvě dohraný zápas
 * je dostane s odstupem – to je normální stav, ne selhání.
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
    const report = await getMatchReport({
      fixtureId,
      home: { id: homeId, name: p.get("hn") ?? "Domácí" },
      away: { id: awayId, name: p.get("an") ?? "Hosté" },
      goals,
    });
    // Odehraný zápas se už nezmění → dlouhá CDN cache; šetří funkci i Neon.
    return NextResponse.json({ report }, { headers: publicCache(3600, 86_400) });
  } catch {
    return NextResponse.json({ report: null });
  }
}
