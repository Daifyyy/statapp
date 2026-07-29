import { describe, expect, it, vi, afterEach } from "vitest";
import { cronJson } from "./cronResult";

// `logError` píše na console.error – v testu ho umlčíme, ať výstup zůstane čitelný.
const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => quiet.mockClear());

describe("cronJson", () => {
  it("čistý běh → 200 a ok:true", async () => {
    const res = cronJson("test", { predicted: 12 }, 0, 12);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, predicted: 12 });
  });

  it("DÍLČÍ výpadek zůstane ZELENÝ, ale počet je v odpovědi", async () => {
    // Při 18 soutěžích a distribuovaném rate-limitu je občasný výpadek normální provoz.
    // Kdyby cron červenal pokaždé, přestane se na něj koukat – a to je horší než mlčení.
    const res = cronJson("test", { predicted: 40, errors: 2 }, 2, 40);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, errors: 2 });
  });

  it("běh, který NIC nezvládl, jde ven jako 502", async () => {
    // Tohle je ten stav, kvůli kterému helper existuje: `200 {predicted:0, errors:24}`
    // byl v GitHub Actions zelený, takže vypršelý API klíč nikdo nezaznamenal.
    const res = cronJson("test", { predicted: 0, errors: 24 }, 24, 0);
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ ok: false, degraded: true });
  });

  it("nula práce BEZ chyb je v pořádku (mimo sezónu není co predikovat)", async () => {
    // Rozdíl proti předchozímu případu je jediný: `errors`. Prázdný běh v červenci
    // je legitimní a nesmí budit poplach.
    const res = cronJson("test", { predicted: 0 }, 0, 0);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("degradovaný běh se zaloguje, čistý ne", () => {
    cronJson("test", { predicted: 5 }, 0, 5);
    expect(quiet).not.toHaveBeenCalled();
    cronJson("test", { predicted: 0 }, 3, 0);
    expect(quiet).toHaveBeenCalledOnce();
  });
});

describe("logError – řídicí tok Next.js", () => {
  it("výjimku s `digest` (redirect/notFound/bailout) NEloguje", async () => {
    // Next signalizuje řídicí tok vyhozením výjimky s řetězcovým `digest`. Kdyby se
    // logovala, každý dynamický render nasype do logu stack a skutečná chyba v něm
    // zanikne – přesně to build ukázal u `authUser.getCurrentUser`.
    const { logError, isFrameworkSignal } = await import("./logError");
    const signal = Object.assign(new Error("Dynamic server usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    expect(isFrameworkSignal(signal)).toBe(true);
    logError("test", signal);
    expect(quiet).not.toHaveBeenCalled();
  });

  it("běžnou chybu loguje dál", async () => {
    const { logError, isFrameworkSignal } = await import("./logError");
    expect(isFrameworkSignal(new Error("upstream 502"))).toBe(false);
    logError("test", new Error("upstream 502"));
    expect(quiet).toHaveBeenCalledOnce();
  });
});
