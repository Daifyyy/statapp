import type { MatchResult, MatchProbs } from "./types";

/**
 * **Očekávané body (xB) — zavření smyčky, kterou má Hra v popisu.**
 *
 * Manažer ukazuje před každým zápasem predikci modelu (1X2) a pak ji zahodí. Přitom celá
 * aplikace vedle stojí na porovnání predikce se skutečností (`computeTrackRecord`,
 * `computeReliability`, a hlavně `lib/stats/formQuality.ts`, které pro reálné týmy počítá
 * „sedí výsledky s výkony?"). Tohle je totéž pro tvoji sezónu.
 *
 * Odpovídá na otázku, na kterou samotná tabulka odpovědět neumí: **byla ta sezóna
 * zasloužená?** 52 bodů při očekávaných 44 znamená šťastlivce, ne génia; 38 při 47
 * znamená sezónu, kterou sebrala smůla, ne špatné vedení.
 *
 * **xB se počítá z λ, která se SKUTEČNĚ odehrála** – tedy včetně plánu, counteru,
 * instrukce, morálky, kondice i eventových modifikátorů (`resolveYourAdjust` v `playRound`),
 * ne z neutrálního náhledu (`yourNextMatch` jede záměrně `"balanced"`/`"none"` kvůli
 * anti-exploitu). Je to zásadní rozdíl: kdyby xB šlo z náhledu, „nadvýkon" by z poloviny
 * měřil, že ti zabrala taktika — tedy pravý opak toho, co má ukázat. Se skutečnou λ je
 * rozdíl **čistá náhoda**, a to je ta zajímavá věc.
 *
 * Čisté funkce, žádná nová data, 0 volání API.
 */

/** Očekávané body z jednoho zápasu pro danou stranu: `3·V + R`. */
export function expectedPointsOf(probs: MatchProbs, isHome: boolean): number {
  const win = isHome ? probs.homeWin : probs.awayWin;
  return 3 * win + probs.draw;
}

/** Skutečné body z odehraného zápasu pro danou stranu. */
export function actualPointsOf(result: MatchResult, isHome: boolean): number {
  const forG = isHome ? result.homeGoals : result.awayGoals;
  const agG = isHome ? result.awayGoals : result.homeGoals;
  return forG > agG ? 3 : forG === agG ? 1 : 0;
}

/**
 * Kolik zápasů s uloženým xB musí sezóna mít, než se z rozdílu vysloví verdikt.
 *
 * Rozdíl bodů a xB je na krátkém úseku z valné části šum: pět zápasů unese rozptyl
 * klidně ±4 body, aniž by to o čemkoli vypovídalo. Táž zásada jako `T.minXgSample`
 * ve `formQuality.ts` — jednotlivé zápasy se ukazují vždy, **verdikt** až od prahu.
 */
export const MIN_XP_SAMPLE = 8;

/**
 * Od jakého rozdílu (v bodech) se sezóna označí za nadstavenou/podhodnocenou.
 *
 * Pod tím je to „sedí". Práh je v ABSOLUTNÍCH bodech, ne v procentech: hráče zajímá
 * „přišel jsem o pět bodů", ne „o 11 %", a v tabulce se rozhoduje o body.
 */
export const XP_VERDICT_MARGIN = 4;

export type XpVerdict = "lucky" | "fair" | "unlucky" | "unknown";

export interface SeasonExpectedPoints {
  /** Kolik zápasů mělo uložené xB (starší uložené kariéry ho u dřívějších kol nemají). */
  matches: number;
  /** Součet skutečných bodů ZE ZÁPASŮ S xB – aby měl rozdíl stejný jmenovatel. */
  points: number;
  /** Součet očekávaných bodů. */
  expected: number;
  /** `points − expected`. Kladné = víc, než sis zasloužil. */
  delta: number;
  verdict: XpVerdict;
}

/**
 * Sečte body a xB **jen ze zápasů, které xB mají**.
 *
 * Stejný jmenovatel je tu podstatnější, než vypadá: rozehraná kariéra z dřívější verze
 * má prvních N kol bez xB, a kdyby se skutečné body braly ze všech zápasů a očekávané
 * jen z části, vyšel by obrovský „nadvýkon" čistě z toho, že se sečetlo víc zápasů
 * do jedné strany rozdílu.
 */
export function seasonExpectedPoints(
  results: MatchResult[],
  yourTeamId: number
): SeasonExpectedPoints {
  let points = 0;
  let expected = 0;
  let matches = 0;

  for (const r of results) {
    if (r.xp == null) continue;
    const isHome = r.homeId === yourTeamId;
    if (!isHome && r.awayId !== yourTeamId) continue;
    matches++;
    expected += r.xp;
    points += actualPointsOf(r, isHome);
  }

  const delta = points - expected;
  return {
    matches,
    points,
    expected: round1(expected),
    delta: round1(delta),
    verdict: verdictOf(matches, delta),
  };
}

function verdictOf(matches: number, delta: number): XpVerdict {
  if (matches < MIN_XP_SAMPLE) return "unknown";
  if (delta >= XP_VERDICT_MARGIN) return "lucky";
  if (delta <= -XP_VERDICT_MARGIN) return "unlucky";
  return "fair";
}

/** Krátký popis verdiktu pro UI (jedna věta, bez čísel – ta si UI doplní samo). */
export function xpVerdictLabel(verdict: XpVerdict): string {
  switch (verdict) {
    case "lucky":
      return "Výsledky ti vyšly líp, než jak jsi hrál";
    case "unlucky":
      return "Odehrál jsi víc, než ukazuje tabulka";
    case "fair":
      return "Body odpovídají tomu, jak jsi hrál";
    case "unknown":
      return "Zatím málo zápasů na hodnocení";
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
