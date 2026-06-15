"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import type { SessionUser } from "./sessionUser";

/**
 * Sdílená hlavička obou stránek. Akční prvky jsou na mobilu jen ikony
 * (textový popisek `hidden sm:inline`), kontejner `flex-wrap` jako pojistka,
 * aby se nic nepřetékalo na úzkém displeji.
 */
export function AppHeader({
  user,
  nav,
  share = false,
}: {
  user: SessionUser | null;
  nav: { href: string; label: string; emoji: string };
  share?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <Image
        src="/logoapp.png"
        alt="Predictapp"
        width={40}
        height={40}
        priority
        className="rounded-xl"
      />
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Link
          href={nav.href}
          aria-label={nav.label}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted transition hover:text-foreground"
        >
          <span aria-hidden>{nav.emoji}</span>
          <span className="hidden sm:inline"> {nav.label}</span>
        </Link>
        {share && <ShareButton />}
        <ThemeToggle />
        <AccountMenu user={user} />
      </div>
    </header>
  );
}

function ShareButton() {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function share() {
    const url = window.location.href;
    // Mobil: nativní share sheet (jen v secure kontextu). Zrušení uživatelem
    // (AbortError) bereme jako tichý konec; jinou chybu řeší fallback na schránku.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Predictapp — porovnání týmů", url });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }
  // Emoji nese stav i na mobilu (kde je popisek skrytý).
  const emoji = state === "copied" ? "✓" : state === "error" ? "⚠" : "🔗";
  const label =
    state === "copied"
      ? "Zkopírováno"
      : state === "error"
        ? "Nešlo zkopírovat"
        : "Sdílet";
  return (
    <button
      type="button"
      onClick={share}
      title="Sdílet odkaz na toto porovnání"
      aria-label="Sdílet"
      className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted transition hover:text-foreground"
    >
      <span aria-hidden>{emoji}</span>
      <span className="hidden sm:inline"> {label}</span>
    </button>
  );
}
