import { NextResponse } from "next/server";
import { getLiveFixtures } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { publicCache } from "@/lib/cacheHeaders";

/**
 * Živé skóre našich lig (FREE). Klient (`useLiveScores` v Zápasech) sem pollí ~90 s.
 * Upstream volání stropuje sdílená `fixlive` cache (`LIVE_TTL`), takže náklad nezávisí
 * na počtu uživatelů. Chyba → `{ live: [] }` (200), aby UI jen schovalo živý stav.
 */
export async function GET(req: Request) {
  if (!allowRequest(`fixlive:${clientKey(req)}`, 60, 60_000)) return tooMany();
  try {
    const live = await getLiveFixtures();
    // Krátký CDN cache (20 s): sdílené živé skóre, ale drží se čerstvé kvůli minutě.
    return NextResponse.json({ live }, { headers: publicCache(20, 40) });
  } catch {
    return NextResponse.json({ live: [] });
  }
}
