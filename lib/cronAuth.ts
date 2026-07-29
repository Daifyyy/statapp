import { NextResponse } from "next/server";

/**
 * Sdílené ověření cron/warm endpointů (centralizace dřívějšího `if (secret) {…}` bloku,
 * dřív duplikovaného v 6 handlerech).
 *
 * **FAIL-CLOSED (od 29. 7. 2026).** Dřív se bez `CRON_SECRET` v env pouštělo dál, aby se
 * nezablokoval provoz. To ale znamenalo, že jediná chybějící proměnná tiše otevřela
 * `/api/warm?league=ID` – jeden request = **stovky volání API-Football** – komukoli na
 * internetu, a vyčerpání denní kvóty 7 500 by se projevilo až tím, že appka přestane mít
 * data. Secret je na Vercelu nastavený, takže fail-closed nic nerozbíjí a odstraňuje
 * celou třídu „zapomněl jsem env po migraci projektu".
 *
 * Vrací `NextResponse` k odmítnutí (handler ji rovnou vrátí), nebo `null` = pokračuj.
 *
 * **Lokální spouštění** těchto endpointů proto vyžaduje `CRON_SECRET` i v `.env`
 * (a hlavičku `Authorization: Bearer <secret>`); běžný vývoj appky se jich netýká.
 * Chybí-li secret, vrací se **503** – to je stav serveru (chybí konfigurace), ne
 * odmítnutí volajícího, a v logu Actions se to nesplete s otočeným secretem (401).
 */
export function requireCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET není nakonfigurován – endpoint je uzamčen" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Neautorizováno" }, { status: 401 });
  }
  return null;
}
