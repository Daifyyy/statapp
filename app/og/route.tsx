import { ImageResponse } from "next/og";

// Dynamický OG obrázek pro sdílení porovnání. Čte názvy týmů z query (`h`/`a`),
// které dodá `generateMetadata` na stránce porovnání → žádný server lookup zde
// (a tedy žádné API volání při scrapování odkazu). Bez query = obecná karta.
export const contentType = "image/png";

const SIZE = { width: 1200, height: 630 };
const HOME = "#3b82f6";
const AWAY = "#fb923c";
const BG = "#0b0e13";
const FG = "#e8eaed";
const MUTED = "#9aa3b0";

function clean(v: string | null): string {
  return (v ?? "").slice(0, 40).trim();
}

export function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const home = clean(sp.get("h"));
  const away = clean(sp.get("a"));
  const hasMatch = home !== "" && away !== "";

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
            marginBottom: 48,
          }}
        >
          Predictapp
        </div>

        {hasMatch ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 40,
              maxWidth: 1040,
            }}
          >
            <div style={{ display: "flex", color: HOME, fontSize: 72, fontWeight: 700, textAlign: "center" }}>
              {home}
            </div>
            <div style={{ display: "flex", color: MUTED, fontSize: 48 }}>vs</div>
            <div style={{ display: "flex", color: AWAY, fontSize: 72, fontWeight: 700, textAlign: "center" }}>
              {away}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, textAlign: "center" }}>
            Porovnani fotbalovych tymu
          </div>
        )}

        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: MUTED,
            marginTop: 56,
          }}
        >
          Statistiky • forma • predikce zapasu
        </div>
      </div>
    ),
    SIZE
  );
}
