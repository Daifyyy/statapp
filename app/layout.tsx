import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Predictapp — porovnání fotbalových týmů",
  description:
    "Statistické porovnání klubů a reprezentací: vážený průměr formy, doma/venku, insights.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
