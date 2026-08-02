import { describe, expect, it } from "vitest";
import type { ClvSummary } from "./clv";
import type { MarketBenchmark } from "./market";
import type { ReliabilityCurve, ReliabilityReport } from "./reliability";
import {
  CLV_MIN_EDGE_PB,
  CLV_MIN_SAMPLE,
  evaluateEdgeGate,
  type GateKey,
  type GateStatus,
} from "./gate";

function curve(over: Partial<ReliabilityCurve> = {}): ReliabilityCurve {
  return { market: "1x2", n: 300, bins: [], ece: 0.031, ...over };
}

const reliability = (over: Partial<ReliabilityCurve> = {}): ReliabilityReport => ({
  outcome: curve(over),
  over25: curve({ market: "over25" }),
  btts: curve({ market: "btts" }),
});

function market(ourLogloss: number, marketLogloss: number): MarketBenchmark {
  const score = (logloss: number) => ({ n: 500, accuracy: 0.5, brier: 0.2, logloss });
  return {
    n: 500,
    our: score(ourLogloss),
    market: score(marketLogloss),
    avgOverround: 1.04,
  };
}

const clv = (over: Partial<ClvSummary> = {}): ClvSummary => ({
  n: 300,
  avgClv: 0.02,
  beatRate: 0.58,
  sharpShare: 1,
  ...over,
});

/** Stav jednoho kritéria z výsledku brány. */
const statusOf = (
  g: ReturnType<typeof evaluateEdgeGate>,
  key: GateKey
): GateStatus => g.criteria.find((c) => c.key === key)!.status;

describe("evaluateEdgeGate – malý vzorek nesmí vydat verdikt", () => {
  // Přesně stav produkce po zapnutí filtru verze modelu: 7 odehraných zápasů, na nich
  // náš log-loss 0.910 vs. trh 1.031 → vypadá to, že trh porážíme. Je to šum: SE
  // log-lossu je při n=7 řádově ±0.26, kdežto skutečný rozdíl je 0.048 v OPAČNÉM směru
  // (změřeno na 9 271 zápasech). Brána tu nesmí ukázat ✓.
  it("„porážíme trh“ na 7 zápasech je `insufficient`, ne `pass`", () => {
    const g = evaluateEdgeGate({
      reliability: null,
      market: { ...market(0.91, 1.031), n: 7 },
      clv: null,
    });
    expect(statusOf(g, "vsMarket")).toBe("insufficient");
    expect(g.status).not.toBe("pass");
  });

  it("kalibrace z 21 bodů (7 zápasů) je taky `insufficient`", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ n: 21, ece: 0.141 }),
      market: null,
      clv: null,
    });
    expect(statusOf(g, "calibration")).toBe("insufficient");
  });
});

describe("evaluateEdgeGate – kalibrace", () => {
  it("ECE pod prahem projde", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ ece: 0.031 }),
      market: null,
      clv: null,
    });
    expect(statusOf(g, "calibration")).toBe("pass");
  });

  it("ECE nad prahem neprojde a řekne, co by se muselo stát", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ ece: 0.12 }),
      market: null,
      clv: null,
    });
    const c = g.criteria.find((x) => x.key === "calibration")!;
    expect(c.status).toBe("fail");
    expect(c.requirement).not.toBe("");
  });

  it("bez odehraných predikcí je to `insufficient`, ne `fail`", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ n: 0, ece: null }),
      market: null,
      clv: null,
    });
    expect(statusOf(g, "calibration")).toBe("insufficient");
  });

  it("ECE nad prahem při DOST velkém vzorku už `fail` je", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ n: 300, ece: 0.141 }),
      market: null,
      clv: null,
    });
    expect(statusOf(g, "calibration")).toBe("fail");
  });
});

describe("evaluateEdgeGate – vs. trh", () => {
  it("nižší log-loss než trh projde", () => {
    const g = evaluateEdgeGate({
      reliability: null,
      market: market(0.95, 0.976),
      clv: null,
    });
    expect(statusOf(g, "vsMarket")).toBe("pass");
  });

  it("horší než trh neprojde (dnešní realita: 1.024 vs 0.976)", () => {
    const g = evaluateEdgeGate({
      reliability: null,
      market: market(1.024, 0.976),
      clv: null,
    });
    const c = g.criteria.find((x) => x.key === "vsMarket")!;
    expect(c.status).toBe("fail");
    expect(c.summary).toContain("0.048");
  });

  it("bez kurzů je to `insufficient`", () => {
    const g = evaluateEdgeGate({
      reliability: null,
      market: { n: 0, our: null, market: null, avgOverround: null },
      clv: null,
    });
    expect(statusOf(g, "vsMarket")).toBe("insufficient");
  });
});

describe("evaluateEdgeGate – CLV", () => {
  it("malý vzorek je `insufficient`, NE `fail` – „nevíme“ ≠ „neumíme“", () => {
    // Dnešní stav produkce: 5 tipů s oběma snímky.
    const g = evaluateEdgeGate({
      reliability: null,
      market: null,
      clv: clv({ n: 5, avgClv: 0.004, beatRate: 0.6 }),
    });
    expect(statusOf(g, "clv")).toBe("insufficient");
  });

  it("velký vzorek s posunem POD marží neprojde, i když je kladný", () => {
    // +0.3 p. b. je matematicky kladné a ekonomicky nula (overround 3–4 % na 1X2).
    const g = evaluateEdgeGate({
      reliability: null,
      market: null,
      clv: clv({ n: 400, avgClv: 0.003, beatRate: 0.55 }),
    });
    expect(statusOf(g, "clv")).toBe("fail");
  });

  it("posun nad marží a víc než polovina tipů před trhem projde", () => {
    const g = evaluateEdgeGate({
      reliability: null,
      market: null,
      clv: clv({ n: CLV_MIN_SAMPLE, avgClv: CLV_MIN_EDGE_PB / 100, beatRate: 0.56 }),
    });
    expect(statusOf(g, "clv")).toBe("pass");
  });

  it("velký posun, ale beat rate pod polovinou neprojde (pár extrémů to vytáhlo)", () => {
    const g = evaluateEdgeGate({
      reliability: null,
      market: null,
      clv: clv({ n: 400, avgClv: 0.04, beatRate: 0.42 }),
    });
    expect(statusOf(g, "clv")).toBe("fail");
  });

  it("nese varování o mikrostruktuře trhu (kladné CLV nemusí být skill)", () => {
    const g = evaluateEdgeGate({ reliability: null, market: null, clv: clv() });
    expect(g.criteria.find((c) => c.key === "clv")!.caveat).toContain("opačnou stranu");
  });
});

describe("evaluateEdgeGate – celkový verdikt", () => {
  it("je konjunkce: jedno `fail` shodí celou bránu", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ ece: 0.02 }), // pass
      market: market(1.024, 0.976), // fail
      clv: clv(), // pass
    });
    expect(g.status).toBe("fail");
  });

  it("`insufficient` nepřebije `fail` (víme, kde to vázne)", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ n: 0, ece: null }), // insufficient
      market: market(1.024, 0.976), // fail
      clv: null, // insufficient
    });
    expect(g.status).toBe("fail");
  });

  it("samé `insufficient` → `insufficient`, ne `fail`", () => {
    const g = evaluateEdgeGate({ reliability: null, market: null, clv: null });
    expect(g.status).toBe("insufficient");
    expect(g.criteria).toHaveLength(3);
  });

  it("`pass` jen když projdou všechna tři kritéria", () => {
    const g = evaluateEdgeGate({
      reliability: reliability({ ece: 0.02 }),
      market: market(0.95, 0.976),
      clv: clv({ n: 400, avgClv: 0.02, beatRate: 0.57 }),
    });
    expect(g.status).toBe("pass");
    expect(g.criteria.every((c) => c.requirement === "")).toBe(true);
  });
});
