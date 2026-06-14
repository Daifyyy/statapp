"use client";

import { signIn } from "next-auth/react";
import type { SessionUser } from "./sessionUser";

const PRO_FEATURES = [
  { icon: "📊", text: "Predikce výsledku (V/R/P, skóre, BTTS, Over 2.5)" },
  { icon: "🔍", text: "Klíčové signály a insights z dat" },
  { icon: "🏥", text: "Přehled zranění obou týmů" },
  { icon: "⭐", text: "Ukládání do oblíbených a historie" },
];

/**
 * Zámek PRO obsahu (zobrazí se místo predikce/insights, když je výsledek `locked`).
 * CTA podle stavu: anonym → přihlásit; FREE s dostupným trialem → vyzkoušet 1×;
 * FREE po trialu → upgrade.
 */
export function ProLock({
  user,
  trialAvailable,
  onUnlockTrial,
  unlocking,
}: {
  user: SessionUser | null;
  trialAvailable: boolean;
  onUnlockTrial: () => void;
  unlocking: boolean;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 text-center shadow-sm">
      <span className="inline-flex items-center gap-1 rounded-full bg-positive/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-positive">
        🔒 PRO
      </span>
      <h3 className="mt-2 text-base font-semibold text-foreground">
        Odemkni plnou analýzu zápasu
      </h3>

      <ul className="mx-auto mt-3 max-w-sm space-y-1.5 text-left">
        {PRO_FEATURES.map((f) => (
          <li key={f.text} className="flex items-start gap-2 text-sm text-muted">
            <span aria-hidden>{f.icon}</span>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {!user ? (
          <>
            <button
              type="button"
              onClick={() => void signIn("google")}
              className="rounded-full bg-positive px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Přihlas se a vyzkoušej PRO zdarma (1×)
            </button>
            <p className="mt-2 text-xs text-muted">
              Po přihlášení odemkneš jedno porovnání s plnou analýzou.
            </p>
          </>
        ) : trialAvailable ? (
          <>
            <button
              type="button"
              onClick={onUnlockTrial}
              disabled={unlocking}
              className="rounded-full bg-positive px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {unlocking ? "Odemykám…" : "Vyzkoušet PRO zdarma (1×)"}
            </button>
            <p className="mt-2 text-xs text-muted">
              Máš jedno PRO porovnání zdarma. Vyzkoušej ho na tomto zápase.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                alert("Placená PRO verze bude brzy. Díky za zájem!")
              }
              className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90"
            >
              Upgradovat na PRO
            </button>
            <p className="mt-2 text-xs text-muted">
              Trial jsi už využil. Plná PRO verze dorazí brzy.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
