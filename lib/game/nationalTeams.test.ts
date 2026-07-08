import { describe, expect, it } from "vitest";
import { NATIONAL_TEAMS, nationalGameTeam, nationalsByConfed } from "./nationalTeams";
import { homeAdvantage } from "./simulate";
import { teamStrengthScore } from "./leagues";
import type { ConfedCode } from "./nationalTeams";

const CONFEDS: ConfedCode[] = ["UEFA", "CONMEBOL", "AFC", "CAF", "CONCACAF", "OFC"];

describe("snapshot reprezentací", () => {
  it("je neprázdný, bez duplicit a každá konfederace má týmy", () => {
    expect(NATIONAL_TEAMS.length).toBeGreaterThan(150);
    expect(new Set(NATIONAL_TEAMS.map((t) => t.id)).size).toBe(NATIONAL_TEAMS.length);
    for (const c of CONFEDS) expect(nationalsByConfed(c).length).toBeGreaterThan(0);
  });

  it("ratingy jsou v herních mezích a sample je nezáporný", () => {
    for (const t of NATIONAL_TEAMS) {
      expect(t.attack, t.name).toBeGreaterThanOrEqual(0.3);
      expect(t.attack, t.name).toBeLessThanOrEqual(3.2);
      expect(t.defense, t.name).toBeGreaterThanOrEqual(0.3);
      expect(t.defense, t.name).toBeLessThanOrEqual(3.2);
      expect(t.sample, t.name).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * Regrese na tichá fallback data: při rate-limitu vracel generátor `.catch(() => [])`,
   * takže celá konfederace dostala identický fallback (11 týmů OFC = 1.20/1.20) a z výstupu
   * to nešlo poznat. Snapshot se stejnými ratingy napříč celou konfederací je vždycky chyba.
   */
  it("žádná konfederace nemá všechny týmy s identickým ratingem", () => {
    for (const c of CONFEDS) {
      const teams = nationalsByConfed(c);
      if (teams.length < 2) continue;
      const distinct = new Set(teams.map((t) => `${t.attack}/${t.defense}`));
      expect(distinct.size, `${c}: ${teams.length} týmů, ${distinct.size} různých ratingů`).toBeGreaterThan(1);
    }
  });

  /**
   * Regrese na rating slepý vůči soupeři: syrový průměr gólů posílal Vietnam a Novou Kaledonii
   * do světové top 12 (dávají hodně gólů, ale slabým soupeřům). Po Poissonově fitu musí být
   * nahoře skutečná špička.
   */
  it("nejsilnější týmy jsou skutečná světová špička", () => {
    const top15 = [...NATIONAL_TEAMS]
      .sort((a, b) => teamStrengthScore(nationalGameTeam(b)) - teamStrengthScore(nationalGameTeam(a)))
      .slice(0, 15)
      .map((t) => t.name);
    const elite = ["Spain", "France", "Germany", "Brazil", "Argentina", "England", "Portugal"];
    const hits = elite.filter((n) => top15.includes(n));
    expect(hits.length, `top15 = ${top15.join(", ")}`).toBeGreaterThanOrEqual(5);
    // A naopak: outsideři, kteří v syrovém průměru vylezli nahoru, tam být nesmí.
    for (const weak of ["New Caledonia", "American Samoa", "San Marino"]) {
      expect(top15).not.toContain(weak);
    }
  });

  it("nationalGameTeam dá neutrální půdu a logo bez API volání", () => {
    const t = nationalGameTeam(NATIONAL_TEAMS[0]);
    expect(t.homeBoost).toBe(1);
    expect(homeAdvantage(t.homeBoost)).toEqual({ homeBonus: 0, awayPenalty: 0 });
    expect(t.logo).toMatch(/^https:\/\/media\.api-sports\.io\/football\/teams\/\d+\.png$/);
    expect(t.short).toHaveLength(3);
  });
});
