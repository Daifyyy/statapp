"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * **Jediný zdroj pravdy o navigaci.** Dřív si každá stránka psala vlastní pole odkazů –
 * osm polí, osm různých obsahů i pořadí. Důsledky byly tři: `/digest` šel otevřít z jediné
 * stránky, `/transfers` chyběl v pěti nabídkách a táž pilulka měnila pozici při každém
 * prokliku. Nový odkaz se proto přidává **sem a nikam jinam**.
 */
export interface NavItem {
  href: string;
  label: string;
  emoji: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Zápasy", emoji: "📅" },
  { href: "/porovnani", label: "Porovnání", emoji: "⇄" },
  { href: "/tabulky", label: "Tabulky", emoji: "📊" },
  { href: "/predikce", label: "Predikce", emoji: "🎯" },
  { href: "/digest", label: "Vs. trh", emoji: "🔥" },
  { href: "/tipovacka", label: "Tipovačka", emoji: "🎲" },
  { href: "/transfers", label: "Přestupy", emoji: "🔄" },
  { href: "/hra", label: "Hra", emoji: "🎮" },
];

/**
 * Je `href` aktuální sekce? Kořen musí sedět přesně (jinak by svítil vždycky),
 * ostatní se berou prefixově, aby podstránka (`/hra/vysledek`) zvýraznila svou sekci.
 */
export function isActiveSection(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Vodorovný pásek sekcí. **Záměrně scrolluje místo aby se zalamoval:** osm položek by
 * na 360 px zabralo dva až tři řádky hlavičky a odsunulo obsah pod okraj. Stejný vzor
 * jako `LeaguePicker` v Tabulkách – schovaný scrollbar, `-mx-4 px-4` aby pásek sahal
 * až ke krajům displeje.
 *
 * Proti původním pilulkám v hlavičce je tu i **popisek na mobilu**. Dřív byl
 * `hidden sm:inline`, takže telefon (kde appka běží primárně) viděl jen emoji.
 */
export function SectionNav() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Aktivní sekce musí být vidět i když je v pásku až vpravo (přímý vstup, deep-link).
  // `block: "nearest"` – jinak by scroll skočil i svisle a utekl by obsah stránky.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav
      aria-label="Sekce"
      className="mt-3 -mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex gap-1.5 pb-1">
        {NAV_ITEMS.map((item) => {
          const active = isActiveSection(pathname, item.href);
          return (
            <Link
              key={item.href}
              ref={active ? activeRef : undefined}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? // Aktivní stav nesmí stát jen na barvě textu – vedle daltonismu je to
                    // i otázka kontrastu v obou tématech.
                    "border-foreground bg-foreground text-background"
                  : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              <span aria-hidden>{item.emoji}</span>
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
