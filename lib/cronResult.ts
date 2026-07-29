import { NextResponse } from "next/server";
import { logError } from "./logError";

/**
 * Jednotné vyhodnocení výsledku cron běhu → HTTP status.
 *
 * **Proč to musí být status, ne jen pole v těle:** crony spouští GitHub Actions přes
 * `curl --fail-with-body`, který zčervená jen na 4xx/5xx. Běh, který vrátí
 * `200 {predicted: 0, errors: 24}`, je dnes v Actions **zelený** – tedy přesně ten
 * neviditelný stav, kvůli kterému se rok nevšimlo, že se neukládají kurzy.
 *
 * **Proč ne „jakákoli chyba = červená":** při 18 soutěžích a distribuovaném rate-limitu
 * je občasný výpadek jedné položky normální provoz. Kdyby cron červenal pořád, přestane
 * se na něj koukat – a to je horší než mlčení, protože to vypadá jako monitoring.
 *
 * **Práh je proto „nic se nepodařilo, ačkoli se to zkoušelo":** dílčí výpadek zůstane
 * zelený (počet je v těle i v logu), úplné selhání jde ven jako 502.
 */
export function cronJson(
  scope: string,
  // `object`, ne `Record<string, unknown>`: výsledky běhů jsou pojmenované `interface`,
  // a ty nemají index signaturu → do Recordu se nepřiřadí.
  stats: object,
  /** Kolik položek selhalo. */
  errors: number,
  /** Kolik položek se povedlo. Nula + nenulové `errors` = běh nic nezvládl. */
  succeeded: number
): NextResponse {
  const degraded = errors > 0 && succeeded === 0;
  if (degraded) {
    logError(scope, new Error("cron běh nic nezvládl"), { ...stats, errors });
    return NextResponse.json(
      { ok: false, degraded: true, ...stats },
      { status: 502 }
    );
  }
  // Dílčí výpadky: zelená, ale číslo je vidět v odpovědi i v logu Actions.
  return NextResponse.json({ ok: true, ...stats });
}
