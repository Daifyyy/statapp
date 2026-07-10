import { ImageResponse } from "next/og";

// Dynamický OG obrázek pro sdílení výsledku Manažera (sezóna/turnaj). Stejný vzor
// jako app/og/route.tsx: čte hodnoty z query, žádný server lookup (appka nemá
// veřejné API pro cizí save) → scraper odkazu nespustí žádné volání.
export const contentType = "image/png";

const SIZE = { width: 1200, height: 630 };
const BG = "#0b0e13";
const FG = "#e8eaed";
const MUTED = "#9aa3b0";
const ACCENT = "#22c55e";

function clean(v: string | null, max = 60): string {
  return (v ?? "").slice(0, max).trim();
}

export function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const club = clean(sp.get("club"), 40);
  const headline = clean(sp.get("headline"), 40) || "Sezóna dohraná";
  const context = clean(sp.get("context"), 60); // např. "Sezóna 4 · 1. liga" nebo "Mistrovství světa"
  const titles = clean(sp.get("titles"), 10);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          color: FG,
          fontFamily: "sans-serif",
          padding: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: MUTED,
            marginBottom: 40,
          }}
        >
          Predictapp · Manažer
        </div>

        {club && (
          <div style={{ display: "flex", fontSize: 44, color: MUTED, marginBottom: 8 }}>
            {club}
          </div>
        )}

        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 700,
            textAlign: "center",
            color: ACCENT,
            maxWidth: 1040,
          }}
        >
          {headline}
        </div>

        {context && (
          <div style={{ display: "flex", fontSize: 32, color: MUTED, marginTop: 32 }}>
            {context}
          </div>
        )}

        {titles && (
          <div style={{ display: "flex", fontSize: 26, color: MUTED, marginTop: 40 }}>
            🏆 {titles}× titul v kariéře
          </div>
        )}
      </div>
    ),
    SIZE
  );
}
