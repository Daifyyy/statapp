import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PWARegister } from "./_components/PWARegister";
import { InstallPrompt } from "./_components/InstallPrompt";

export const metadata: Metadata = {
  title: "Predictapp — porovnání fotbalových týmů",
  description:
    "Statistické porovnání klubů a reprezentací: vážený průměr formy, doma/venku, insights.",
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
      </body>
    </html>
  );
}
