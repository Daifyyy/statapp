import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { PWARegister } from "./_components/PWARegister";
import { InstallPrompt } from "./_components/InstallPrompt";

const TITLE = "Predictapp — porovnání fotbalových týmů";
const DESCRIPTION =
  "Statistické porovnání klubů a reprezentací: vážený průměr formy, doma/venku, insights.";

export const metadata: Metadata = {
  // Základ pro absolutní URL OG/twitter obrázků (prod doména, fallback z AUTH_URL).
  metadataBase: new URL(
    process.env.AUTH_URL ?? "https://statapp-uvol.vercel.app"
  ),
  title: TITLE,
  description: DESCRIPTION,
  // iOS: chování instalované PWA (fullscreen, název na ploše, status bar).
  appleWebApp: {
    capable: true,
    title: "Predictapp",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  // Náhled při sdílení odkazu (Messenger, Discord, X…). Statický – dynamický
  // titulek „Tým A vs Tým B" by vyžadoval serverový lookup názvů (backlog).
  openGraph: {
    type: "website",
    siteName: "Predictapp",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "Predictapp" }],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/icon-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e13" },
  ],
};

// Aplikuje téma ještě před vykreslením (žádný záblesk světlého v tmavém režimu).
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
        <PWARegister />
        <InstallPrompt />
        <Analytics />
      </body>
    </html>
  );
}
