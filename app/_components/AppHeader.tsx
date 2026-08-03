"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { SectionNav } from "./nav";
import type { SessionUser } from "./sessionUser";
import { shareOrCopy } from "./share";

/**
 * Sdílená hlavička všech stránek: řádek s logem a účtem, pod ním pásek sekcí.
 *
 * **Seznam sekcí si hlídá `nav.tsx`, ne volající.** Dokud si ho každá stránka předávala
 * propem, lišil se obsahem i pořadím a dvě sekce byly prakticky neobjevitelné. Hlavička
 * proto žádný `nav` prop nemá – stačí ji vykreslit.
 */
export function AppHeader({
  user,
  share = false,
}: {
  user: SessionUser | null;
  share?: boolean;
}) {
  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/" aria-label="Predictapp – domů">
          <Image
            src="/logoapp.png"
            alt="Predictapp"
            width={40}
            height={40}
            priority
            className="rounded-xl"
          />
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {share && <ShareButton />}
          <ThemeToggle />
          <AccountMenu user={user} />
        </div>
      </div>
      <SectionNav />
    </header>
  );
}

function ShareButton() {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function share() {
    const outcome = await shareOrCopy(window.location.href, "Predictapp — porovnání týmů");
    if (outcome === "copied") {
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } else if (outcome === "error") {
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
