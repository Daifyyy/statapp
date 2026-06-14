"use client";

import { requestInstall } from "./installBus";

/** Nenápadný odkaz „Nainstalovat appku" do patičky (vyvolá InstallPrompt). */
export function InstallLink() {
  return (
    <button
      type="button"
      onClick={requestInstall}
      className="underline underline-offset-2 transition hover:text-foreground"
    >
      📲 Nainstalovat jako appku
    </button>
  );
}
