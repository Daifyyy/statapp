/**
 * Lehký per-klient rate-limit pro API routes (anti-spam). In-memory klouzavé
 * okno – best-effort: na serverless je per-instance, po škálování/cold startu se
 * resetuje. Cílem je zastavit zjevný spam jedním klientem, ne přesné kvótování.
 * Upstream API-Football řeší samostatný globální limiter (lib/data/rateLimiter.ts).
 */
const buckets = new Map<string, number[]>();

/**
 * Vrátí true, pokud je požadavek POVOLEN; false při překročení limitu.
 * @param key   identifikátor klienta (IP nebo userId)
 * @param limit max. počet požadavků v okně
 * @param windowMs délka okna v ms
 */
export function allowRequest(
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  // Líný úklid, ať mapa neroste donekonečna.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => t <= now - windowMs)) buckets.delete(k);
    }
  }
  return true;
}

/** Klientský klíč z requestu (IP z proxy hlaviček; fallback „unknown"). */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Standardní 429 odpověď. */
export function tooMany() {
  return new Response(
    JSON.stringify({ error: "Příliš mnoho požadavků, zkus to za chvíli." }),
    { status: 429, headers: { "content-type": "application/json" } }
  );
}
