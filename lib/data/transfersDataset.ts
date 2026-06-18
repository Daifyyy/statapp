import { gunzipSync } from "node:zlib";
import { CURRENT_SEASON, transferWindowStart, teamLogoUrl } from "./catalog";
import { lookupTmClub, type CrosswalkEntry } from "./clubCrosswalk";
import { replaceTransfers, type TransferUpsert } from "./transferStore";

/**
 * Import přestupů z volného Transfermarkt datasetu (dcaribou/transfermarkt-datasets, CC0).
 * Dataset nese **reálné ceny** (`transfer_fee`), které API-Football nemá. Bereme jen aktuální
 * přestupové okno a jen přestupy zapojující naše top-5 kluby (přes `clubCrosswalk`).
 * Běží dávkově (lokální skript / cron), tabulku `Transfer` plně nahradí (TM = jediný zdroj).
 */

const TRANSFERS_URL =
  "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/transfers.csv.gz";

/** Minimální RFC4180 CSV parser (uvozovky, čárky a nové řádky uvnitř polí). Čistá funkce. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Naše zobrazení jedné strany přestupu: náš klub (logo z API-Football) nebo cizí (jen název). */
function resolveSide(tmId: number, tmName: string): {
  id: number | null;
  name: string;
  logo: string | null;
} {
  const x = lookupTmClub(tmId);
  if (x) return { id: x.apiId, name: tmName, logo: teamLogoUrl(x.apiId) };
  return { id: null, name: tmName, logo: null };
}

/** Sestaví řádky k uložení z jednoho CSV řádku (perspektiva každého zapojeného top-5 klubu). */
export function rowsFromCsv(
  cols: string[],
  idx: Record<string, number>
): TransferUpsert[] {
  const fromId = Number(cols[idx.from_club_id]);
  const toId = Number(cols[idx.to_club_id]);
  const fromX = lookupTmClub(fromId);
  const toX = lookupTmClub(toId);
  if (!fromX && !toX) return [];

  const fee = Number(cols[idx.transfer_fee]);
  const feeEur = Number.isFinite(fee) && fee > 0 ? fee : null;
  const mv = Number(cols[idx.market_value_in_eur]);
  const marketValueEur = Number.isFinite(mv) && mv > 0 ? mv : null;
  const fromName = cols[idx.from_club_name] || "—";
  const toName = cols[idx.to_club_name] || "—";
  const inSide = resolveSide(toId, toName);
  const outSide = resolveSide(fromId, fromName);
  const playerId = Number(cols[idx.player_id]);
  const playerName = cols[idx.player_name] || "?";
  const date = new Date(Date.parse(cols[idx.transfer_date])).toISOString();

  const base = {
    season: CURRENT_SEASON,
    playerId,
    playerName,
    date,
    // type jen kvůli dead-code kategorizaci: placené → permanent, jinak other
    type: feeEur ? "Transfer" : null,
    feeEur,
    marketValueEur,
    inTeamId: inSide.id,
    inTeamName: inSide.name,
    inTeamLogo: inSide.logo,
    outTeamId: outSide.id,
    outTeamName: outSide.name,
    outTeamLogo: outSide.logo,
  };

  const out: TransferUpsert[] = [];
  const add = (x: CrosswalkEntry) =>
    out.push({ ...base, clubId: x.apiId, clubLeagueId: x.leagueId });
  if (toX) add(toX); // náš klub kupuje (příchod)
  if (fromX) add(fromX); // náš klub prodává (odchod)
  return out;
}

/**
 * Stáhne dataset, vybere aktuální okno + naše kluby a nahradí obsah tabulky `Transfer`.
 * `now` injektovatelné kvůli testu. Vrací počty pro log.
 */
export async function importTransfersFromDataset(
  now: Date = new Date()
): Promise<{ scanned: number; matched: number; inserted: number; windowStart: string }> {
  const windowStartMs = transferWindowStart(now).getTime();
  const todayMs = now.getTime();

  const res = await fetch(TRANSFERS_URL);
  if (!res.ok) throw new Error(`transfers.csv.gz: HTTP ${res.status}`);
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const rows = parseCsv(text).filter((r) => r.length > 1);
  const header = rows[0];
  const idx: Record<string, number> = {};
  header.forEach((h, i) => (idx[h] = i));

  const iDate = idx.transfer_date;
  const upserts: TransferUpsert[] = [];
  for (const cols of rows.slice(1)) {
    const ts = Date.parse(cols[iDate]);
    // jen dokončené přestupy v aktuálním okně (vyřadí budoucí/junk data v datasetu)
    if (!Number.isFinite(ts) || ts < windowStartMs || ts > todayMs) continue;
    upserts.push(...rowsFromCsv(cols, idx));
  }
  const inserted = await replaceTransfers(upserts);
  return {
    scanned: rows.length - 1,
    matched: upserts.length,
    inserted,
    windowStart: new Date(windowStartMs).toISOString().slice(0, 10),
  };
}
