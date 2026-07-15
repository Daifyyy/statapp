import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Zpětná kompatibilita: starý sdílený odkaz na porovnání `/?home=&away=` přesměruj na
 * novou cestu `/porovnani?…` (zachová sdílení i OG kartu). Přesunuto z `app/page.tsx` do
 * middleware, aby domovská stránka nemusela číst `searchParams` a mohla být statická (ISR).
 * Zachovává všechny query parametry (mode/homeLeague/awayLeague/…) přes clone URL.
 */
export function middleware(req: NextRequest): NextResponse {
  const { searchParams } = req.nextUrl;
  if (searchParams.has("home") && searchParams.has("away")) {
    const url = req.nextUrl.clone();
    url.pathname = "/porovnani";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Jen domovská cesta – nikde jinde middleware neběží.
export const config = { matcher: "/" };
