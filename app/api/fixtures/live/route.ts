import { NextResponse } from "next/server";
import { getLiveFixtures } from "@/lib/data/repository";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";

/**
 * Živé skóre našich lig (FREE). Klient (`useLiveScores` v Zápasech) sem pollí ~90 s.
 * Upstream volání stropuje sdílená `fixlive` cache (`LIVE_TTL`), takže náklad nezávisí
 * na počtu uživatelů. Chyba → `{ live: [] }` (200), aby UI jen schovalo živý stav.
 */
export async function GET(req: Request) {
  if (!allowRequest(`fixlive:${clientKey(req)}`, 60, 60_000)) return tooMany();
  try {
    const live = await getLiveFixtures();
    return NextResponse.json({ live });
  } catch {
    return NextResponse.json({ live: [] });
  }
}
