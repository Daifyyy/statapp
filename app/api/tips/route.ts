import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/authUser";
import { allowRequest, tooMany } from "@/lib/rateLimit";
import { isRealDataConfigured } from "@/lib/db";
import { logError } from "@/lib/logError";
import {
  getUserTips,
  upsertTip,
  countOpenTips,
  getModelPickMap,
  type TipInput,
} from "@/lib/data/tipStore";
import { computeTipStats } from "@/lib/tips/stats";
import { pickOddsForTip } from "@/lib/tips/odds";
import { fetchOdds, PINNACLE_FIRST_BOOKMAKERS } from "@/lib/data/apiFootball";
import type { TipMarket, TipSelection } from "@/lib/tips/types";

// Osobní tipovačka (tréninkový deník). Přihlášení povinné (anonym → 401), jinak
// FREE pro všechny přihlášené – žádné PRO gating. Kurz se snapshotuje na pozadí
// (uživatel ho při tipování nevidí) a odhalí se až u vyhodnocení → z něj ROI.

/** Strop otevřených tipů na uživatele (anti-spam). */
const MAX_OPEN_TIPS = 300;

/** Povolené strany pro každý trh (validace konzistence market×selection). */
const SELECTION_BY_MARKET: Record<TipMarket, TipSelection[]> = {
  win: ["home", "draw", "away"],
  over25: ["over", "under"],
  btts: ["yes", "no"],
};

const placeSchema = z
  .object({
    fixtureId: z.number().int().positive(),
    leagueId: z.number().int(),
    leagueName: z.string().max(120),
    // API-Football vrací datum s offsetem (…+02:00) → `datetime()` bez `offset:true` by
    // ho odmítlo. Tolerantně: cokoli, co jde naparsovat na Date (offset i „Z").
    kickoff: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Neplatné datum"),
    homeTeamId: z.number().int(),
    awayTeamId: z.number().int(),
    homeName: z.string().max(120),
    awayName: z.string().max(120),
    homeLogo: z.string().max(400).nullable().optional(),
    awayLogo: z.string().max(400).nullable().optional(),
    national: z.boolean().default(false),
    market: z.enum(["win", "over25", "btts"]),
    selection: z.enum(["home", "draw", "away", "over", "under", "yes", "no"]),
    line: z.number().optional(),
    note: z.string().max(280).nullable().optional(),
  })
  .refine((d) => SELECTION_BY_MARKET[d.market].includes(d.selection), {
    message: "Strana neodpovídá trhu",
    path: ["selection"],
  });

/** GET – tipy přihlášeného uživatele + spočítaná bilance (úspěšnost, ROI, vs model). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (!allowRequest(`tips:${user.id}`, 60, 60_000)) return tooMany();

  try {
    const tips = await getUserTips(user.id);
    // Modelové 1X2 tipy jen pro vyhodnocené „win" tipy (srovnání ty vs model).
    const winFixtures = tips
      .filter((t) => t.market === "win" && t.homeGoals != null)
      .map((t) => t.fixtureId);
    const modelPick = await getModelPickMap(winFixtures);
    const stats = computeTipStats(tips, { modelPick });
    return NextResponse.json({ tips, stats });
  } catch (e) {
    logError("api/tips GET", e);
    return NextResponse.json({ error: "Chyba tipů" }, { status: 502 });
  }
}

/** POST – vloží/přepíše tip (upsert na trh+zápas). Kurz snapshotuje na pozadí. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášeno" }, { status: 401 });
  if (!allowRequest(`tips:${user.id}`, 60, 60_000)) return tooMany();

  const parsed = placeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Neplatná data tipu" }, { status: 400 });
  const d = parsed.data;

  // Nelze tipovat zápas, který už začal.
  if (new Date(d.kickoff).getTime() <= Date.now())
    return NextResponse.json({ error: "Zápas už začal" }, { status: 400 });

  if ((await countOpenTips(user.id)) >= MAX_OPEN_TIPS)
    return NextResponse.json({ error: "Příliš mnoho otevřených tipů" }, { status: 409 });

  const line = d.market === "over25" ? (d.line ?? 2.5) : null;

  // Snapshot kurzu na pozadí (best-effort, jen reálná data + klubové zápasy – reprezentace
  // kurzy zpravidla nemají). Pinnacle první. Výpadek/null → tip bez kurzu (jen úspěšnost).
  let odds: number | null = null;
  let oddsBook: string | null = null;
  if (isRealDataConfigured() && !d.national) {
    try {
      const mo = await fetchOdds(d.fixtureId, PINNACLE_FIRST_BOOKMAKERS);
      const picked = pickOddsForTip(mo, d.market, d.selection);
      if (picked != null) {
        odds = picked;
        oddsBook = mo!.bookmaker;
      }
    } catch (e) {
      logError("api/tips odds", e); // kurz je best-effort, tip se uloží i bez něj
    }
  }

  const input: TipInput = {
    fixtureId: d.fixtureId,
    leagueId: d.leagueId,
    leagueName: d.leagueName,
    kickoff: d.kickoff,
    homeTeamId: d.homeTeamId,
    awayTeamId: d.awayTeamId,
    homeName: d.homeName,
    awayName: d.awayName,
    homeLogo: d.homeLogo ?? null,
    awayLogo: d.awayLogo ?? null,
    national: d.national,
    market: d.market,
    selection: d.selection,
    line,
    note: d.note ?? null,
    odds,
    oddsBook,
  };

  try {
    const tip = await upsertTip(user.id, input);
    return NextResponse.json({ ok: true, tip });
  } catch (e) {
    logError("api/tips POST", e);
    return NextResponse.json({ error: "Tip se nepodařilo uložit" }, { status: 502 });
  }
}
