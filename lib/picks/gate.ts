import type { ClvSummary } from "./clv";
import type { MarketBenchmark } from "./market";
import type { ReliabilityReport } from "./reliability";

/**
 * **Brána z `CLAUDE.md`, převedená na kód**: *„do stakingu, bankrollu ani Kelly
 * neinvestovat, dokud aspoň jeden trh nemá kladné CLV nebo ROI s intervalem spolehlivosti
 * mimo nulu."*
 *
 * Proč to existuje: záložka `/predikce` ukazovala pět nesouvisejících čísel (log-loss,
 * ECE, ⌀ posun v p. b., overround) **bez měřítka** – u žádného nebylo poznat, co je dobře
 * a od jakého vzorku mu věřit. Majitel se přitom ptá na **jednu** věc: „jsme někde blízko
 * tomu, že to má hranu?" Tenhle modul z těch čísel dělá odpověď.
 *
 * Kritéria jsou **řetěz, ne seznam** – dávají smysl jen v tomhle pořadí:
 *  1. **Říká model pravdu o sobě?** (kalibrace) Dokud „70 %" neznamená 70 %, nemá cenu
 *     nic dalšího měřit – všechny další úvahy stojí na tom, že pravděpodobnosti sedí.
 *  2. **Je přesnější než cena?** Rozhodčím je **trh**, ne jiný predikční web: cena je
 *     agregát všech informací a všech peněz.
 *  3. **Hne se linie naším směrem?** (CLV) Poslední a nejcitlivější test – zachytí hranu
 *     dřív, než ji potvrdí výsledky.
 *
 * Čistá funkce nad tím, co už vrací `/api/picks/stats` → **žádné nové volání, žádný
 * nový dotaz**. Prahy jsou konstanty s odůvodněním, ne čísla rozsypaná v JSX.
 */

/**
 * `insufficient` **není** `fail`. „Zatím nevíme" a „neumíme to" jsou dvě různá tvrzení
 * a splynout nesmí – u trhu, kde se teprve sbírají data, by z toho byl falešný verdikt.
 */
export type GateStatus = "pass" | "fail" | "insufficient";

export type GateKey = "calibration" | "vsMarket" | "clv";

export interface GateCriterion {
  key: GateKey;
  /** Otázka, na kterou kritérium odpovídá (nadpis sekce). */
  question: string;
  status: GateStatus;
  /** Odpověď v lidské řeči, včetně čísla. */
  summary: string;
  /** Co by se muselo stát, aby kritérium prošlo. U `pass` prázdné. */
  requirement: string;
  /** Varování k interpretaci (past, na kterou se dá naletět). */
  caveat?: string;
}

export interface EdgeGate {
  /** Celkový verdikt: `pass` jen když projdou VŠECHNA kritéria. */
  status: GateStatus;
  headline: string;
  criteria: GateCriterion[];
}

/**
 * Práh kalibrace. Pod 0.05 ECE znamená, že se deklarovaná pravděpodobnost od skutečné
 * liší v průměru o méně než 5 procentních bodů – to je na fotbal dost přesné.
 * Shodné s `calibrationVerdict` v UI (jeden práh, ne dva rozcházející se).
 */
export const CALIBRATION_MAX_ECE = 0.05;

/**
 * Kolik datových bodů musí kalibrační křivka mít, než z ní vyrobíme verdikt.
 * 1X2 je poolované one-vs-rest, takže jeden zápas = **3 body** → 100 bodů ≈ 35 zápasů.
 * Pod tím se ECE hýbe po desetinách podle jednoho výsledku.
 */
export const CALIBRATION_MIN_SAMPLE = 100;

/**
 * Kolik zápasů musí být ve společné podmnožině s kurzy, než porovnání s trhem něco
 * znamená. **Není to formalita:** rozptyl log-lossu na zápas je řádově 0.7, takže
 * směrodatná chyba průměru je `0.7/√n` — při n = 7 je to **±0.26**, tedy pětkrát víc než
 * rozdíl, který se měří (offline backtest na 9 271 zápasech dal trh 0.976 vs. my 1.024,
 * rozdíl 0.048). Malý živý vzorek proto umí ukázat i opačné znaménko, než jaké platí.
 *
 * 200 je spodní hranice, kdy má smysl se na to vůbec dívat — na *potvrzení* rozdílu
 * velikosti 0.05 je potřeba vysoké stovky až tisíce.
 */
export const MARKET_MIN_SAMPLE = 200;

/**
 * **Kolik tipů je potřeba, než CLV něco znamená.**
 *
 * Podíl „tipů před trhem" má směrodatnou chybu zhruba `50/√n` procentních bodů:
 * při n = 100 je to ±5 p. b., takže beat rate 55 % je **jedna** směrodatná chyba, tedy
 * nic. ⌀ posun je z těch dvou ukazatelů efektivnější (nese i velikost pohybu, ne jen
 * znaménko), ale ani ten se pod nižšími stovkami neustálí. 200 je spodní hranice, kdy
 * má smysl se na to vůbec dívat.
 */
export const CLV_MIN_SAMPLE = 200;

/**
 * **Kolik musí CLV dělat, aby z toho byl zisk.** Kladné CLV je *nutná*, ne postačující
 * podmínka: posun musí překonat **marži, kterou jsi zaplatil**. Na 1X2 je overround
 * 3–4 %, což je zhruba 1–1,5 p. b. na stranu; na rozích a kartách je marže 5–9 %, tedy
 * 2,5–4,5 p. b. Práh je nastavený na 1X2 (tam se dnes měří).
 *
 * Bez tohohle prahu by „+0,3 p. b." vypadalo jako úspěch, ačkoli je to ekonomicky nula.
 */
export const CLV_MIN_EDGE_PB = 1.5;

const pct1 = (x: number) => x.toFixed(1);

/** Kalibrace: když řekneme „X %", padne to v ~X %? */
function calibrationOf(reliability: ReliabilityReport | null): GateCriterion {
  const base = {
    key: "calibration" as const,
    question: "Říká model pravdu sám o sobě?",
  };
  const curve = reliability?.outcome;
  if (!curve || curve.n < CALIBRATION_MIN_SAMPLE || curve.ece == null) {
    const n = curve?.n ?? 0;
    return {
      ...base,
      status: "insufficient",
      summary:
        n === 0
          ? "Zatím nemáme odehrané predikce, ze kterých by to šlo spočítat."
          : `Zatím se to nedá rozhodnout: ${Math.round(n / 3)} odehraných zápasů (ECE ${curve!.ece?.toFixed(3) ?? "—"}).`,
      requirement: `Aspoň ${Math.round(CALIBRATION_MIN_SAMPLE / 3)} odehraných zápasů na aktuální verzi modelu. Pod tím se ECE hýbe po desetinách podle jednoho výsledku.`,
    };
  }
  const ok = curve.ece < CALIBRATION_MAX_ECE;
  const offPb = Math.round(curve.ece * 100);
  return {
    ...base,
    status: ok ? "pass" : "fail",
    summary: ok
      ? `Ano. Deklarovaná pravděpodobnost se od skutečnosti liší v průměru o ${offPb} p. b. (ECE ${curve.ece.toFixed(3)}).`
      : `Zatím ne. Deklarovaná pravděpodobnost se od skutečnosti liší v průměru o ${offPb} p. b. (ECE ${curve.ece.toFixed(3)}).`,
    requirement: ok
      ? ""
      : `Dostat ECE pod ${CALIBRATION_MAX_ECE.toFixed(2)} – tedy aby „70 %" opravdu znamenalo zhruba 70 %.`,
  };
}

/** Trh je rozhodčí: jsme přesnější než cena na týchž zápasech? */
function vsMarketOf(market: MarketBenchmark | null): GateCriterion {
  const base = {
    key: "vsMarket" as const,
    question: "Jsme přesnější než cena sázkovky?",
  };
  if (!market || !market.our || !market.market || market.n < MARKET_MIN_SAMPLE) {
    const n = market?.n ?? 0;
    return {
      ...base,
      status: "insufficient",
      summary:
        n === 0
          ? "Zatím nemáme odehrané zápasy, u kterých bychom měli i kurzy."
          : `Zatím se to nedá rozhodnout: ${n} ${n === 1 ? "zápas" : n < 5 ? "zápasy" : "zápasů"} s kurzy.`,
      requirement:
        `Aspoň ${MARKET_MIN_SAMPLE} odehraných klubových zápasů s kurzy. Při menším vzorku ` +
        `umí náhoda ukázat i opačné znaménko: směrodatná chyba log-lossu je při ${n || 7} ` +
        `zápasech řádově ±0.26, kdežto rozdíl, o který jde, je 0.05. Offline backtest na ` +
        `9 271 zápasech dal trh 0.976 vs. my 1.024.`,
    };
  }
  const ours = market.our.logloss;
  const theirs = market.market.logloss;
  const ok = ours < theirs;
  const diff = Math.abs(theirs - ours).toFixed(3);
  return {
    ...base,
    status: ok ? "pass" : "fail",
    summary: ok
      ? `Ano, o ${diff} log-lossu (my ${ours.toFixed(3)}, trh ${theirs.toFixed(3)} – nižší je lepší).`
      : `Ne. Trh je lepší o ${diff} (my ${ours.toFixed(3)}, trh ${theirs.toFixed(3)} – nižší je lepší).`,
    requirement: ok
      ? ""
      : "Předstihnout odmaržovanou zavírací linii na společné podmnožině zápasů. Na gólových trzích se to zatím nepodařilo a je to změřené na tisících zápasů — další informace musí přijít zvenčí (sestavy, shot-level xG), ne z přeskládání téhož.",
  };
}

/** CLV: pohnula se linie po našem tipu naším směrem – a dost na to, aby to platilo marži? */
function clvOf(clv: ClvSummary | null): GateCriterion {
  const base = {
    key: "clv" as const,
    question: "Hne se linie po našem tipu naším směrem?",
    caveat:
      "CLV se měří nad jedním pravidlem. Pravidlo, které pořád bere stejný typ strany " +
      "(třeba domácí favority), může vykázat kladné CLV z mikrostruktury trhu — pozdní " +
      "peníze na favority — a ne ze skillu modelu. Kontrola: pustit totéž pravidlo na " +
      "opačnou stranu. Vyjde-li kladné CLV i tam, neměříme skill.",
  };
  const tooFew = {
    ...base,
    status: "insufficient" as const,
    requirement: `Aspoň ${CLV_MIN_SAMPLE} tipů s oběma snímky kurzu. Při menším vzorku je i „55 % tipů před trhem" jedna směrodatná chyba, tedy šum.`,
  };
  if (!clv || clv.n === 0) {
    return {
      ...tooFew,
      summary: "Zatím žádný tip nemá oba snímky kurzu, ze kterých se CLV počítá.",
    };
  }
  if (clv.n < CLV_MIN_SAMPLE) {
    const word = clv.n === 1 ? "tip" : clv.n < 5 ? "tipy" : "tipů";
    return {
      ...tooFew,
      summary: `Zatím se to nedá rozhodnout: ${clv.n} ${word} (⌀ posun ${pct1(clv.avgClv * 100)} p. b.).`,
    };
  }
  const pb = clv.avgClv * 100;
  // Obojí najednou schválně: samotný ⌀ posun umí vytáhnout pár extrémů, samotný beat
  // rate zase nerozliší velký a mikroskopický pohyb.
  const ok = pb >= CLV_MIN_EDGE_PB && clv.beatRate > 0.5;
  return {
    ...base,
    status: ok ? "pass" : "fail",
    summary: ok
      ? `Ano. ⌀ posun ${pct1(pb)} p. b. u ${clv.n} tipů, ${Math.round(clv.beatRate * 100)} % z nich předběhlo trh.`
      : `Zatím ne. ⌀ posun ${pct1(pb)} p. b. u ${clv.n} tipů, ${Math.round(clv.beatRate * 100)} % předběhlo trh.`,
    requirement: ok
      ? ""
      : `⌀ posun aspoň ${pct1(CLV_MIN_EDGE_PB)} p. b. a víc než polovina tipů před trhem. Ten práh není nula, ale zaplacená marže: na 1X2 sežere 3–4% overround zhruba 1–1,5 p. b., takže „+0,3 p. b." je matematicky kladné a ekonomicky nula.`,
  };
}

const HEADLINES: Record<GateStatus, string> = {
  pass: "Zatím to vypadá, že hranu má.",
  fail: "Zatím ne — a víme, kde to vázne.",
  insufficient: "Zatím nemáme z čeho to rozhodnout.",
};

/**
 * Sestaví bránu ze tří kritérií. Celkový verdikt je **`pass` jen když projdou všechna** –
 * brána je konjunkce, ne skóre: model, který je skvěle kalibrovaný, ale horší než cena,
 * hranu nemá. Stačí jedno `fail` a verdikt je `fail`; jinak rozhoduje `insufficient`.
 */
export function evaluateEdgeGate(input: {
  reliability: ReliabilityReport | null;
  market: MarketBenchmark | null;
  clv: ClvSummary | null;
}): EdgeGate {
  const criteria = [
    calibrationOf(input.reliability),
    vsMarketOf(input.market),
    clvOf(input.clv),
  ];
  const status: GateStatus = criteria.some((c) => c.status === "fail")
    ? "fail"
    : criteria.some((c) => c.status === "insufficient")
      ? "insufficient"
      : "pass";
  return { status, headline: HEADLINES[status], criteria };
}
