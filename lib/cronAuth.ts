import { NextResponse } from "next/server";

/**
 * Sdílené ověření cron/warm endpointů (centralizace dřívějšího `if (secret) {…}` bloku,
 * dřív duplikovaného v 6 handlerech).
 *
 * **Graceful (zachovává dosavadní chování):** bez `CRON_SECRET` v env necháme projít,
 * aby se běžný provoz nezablokoval. Jakmile `CRON_SECRET` ve Vercelu nastavíš, endpoint
 * se **sám uzamkne** (vyžaduje `Authorization: Bearer <secret>`, který Vercel Cron
 * posílá automaticky) – bez další úpravy kódu.
 *
 * Pozn. k zabezpečení: drahá upstream volání (`/api/warm?league=ID` = stovky volání
 * API-Football za request) jsou bez nastaveného secretu spustitelná veřejně = riziko
 * vyčerpání denní kvóty. Pro ostrý/placený provoz proto `CRON_SECRET` nastav; přitvrzení
 * na fail-closed (odmítnout i bez secretu) je pak změna jediné podmínky níže.
 *
 * Vrací `NextResponse` k odmítnutí (handler ji rovnou vrátí), nebo `null` = pokračuj.
 */
export function requireCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Neautorizováno" }, { status: 401 });
  }
  return null;
}
