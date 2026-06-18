import { NextResponse } from "next/server";
import { getTransfers, getTransferBalances } from "@/lib/data/repository";
import { TRANSFER_LEAGUES } from "@/lib/data/transfers";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

// Záložka Přestupy (klubocentrická). Čte PŘEDPOČÍTANÁ data z DB (cron je plní).
// Přehled klubů (počty) je FREE; detail přestupů klubu (konkrétní hráči) je PRO.

function parseLeagues(raw: string | null): number[] {
  if (!raw) return TRANSFER_LEAGUES;
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => TRANSFER_LEAGUES.includes(n));
  return ids.length ? ids : TRANSFER_LEAGUES;
}

export async function GET(req: Request) {
  if (!allowRequest(`transfers:${clientKey(req)}`, 60, 60_000)) return tooMany();

  const leagueIds = parseLeagues(new URL(req.url).searchParams.get("leagues"));
  const user = await getCurrentUser();
  const ent = getEntitlement(
    user ? { tier: user.tier, proTrialUsed: user.proTrialUsed } : null
  );

  try {
    const balances = await getTransferBalances(leagueIds); // přehled klubů = FREE
    if (!ent.pro) {
      return NextResponse.json({ balances, detailLocked: true });
    }
    // PRO: i detail přestupů (konkrétní hráči pro proklik klubu); vyšší limit = úplný detail.
    const transfers = await getTransfers(leagueIds, 3000);
    return NextResponse.json({ balances, transfers });
  } catch (e) {
    logError("api/transfers", e, { leagueIds });
    return NextResponse.json({ error: "Chyba přestupů" }, { status: 502 });
  }
}
