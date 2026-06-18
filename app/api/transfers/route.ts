import { NextResponse } from "next/server";
import { getTransfers, getTransferBalances } from "@/lib/data/repository";
import { TRANSFER_LEAGUES } from "@/lib/data/transfers";
import { getCurrentUser } from "@/lib/authUser";
import { getEntitlement } from "@/lib/entitlements";
import { allowRequest, clientKey, tooMany } from "@/lib/rateLimit";
import { logError } from "@/lib/logError";

// Záložka Přestupy. Čte PŘEDPOČÍTANÁ data z DB (cron je plní) → levné a rychlé.
// Seznam přestupů je FREE; interaktivní bilance klubů je PRO (FREE → balancesLocked).

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
    const transfers = await getTransfers(leagueIds);
    if (!ent.pro) {
      return NextResponse.json({ transfers, balancesLocked: true });
    }
    const balances = await getTransferBalances(leagueIds);
    return NextResponse.json({ transfers, balances });
  } catch (e) {
    logError("api/transfers", e, { leagueIds });
    return NextResponse.json({ error: "Chyba přestupů" }, { status: 502 });
  }
}
