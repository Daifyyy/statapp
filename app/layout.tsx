import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Predictapp — porovnání fotbalových týmů",
  description:
    "Statistické porovnání klubů a reprezentací: vážený průměr formy, doma/venku, insights.",
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
      </body>
    </html>
  );
}
