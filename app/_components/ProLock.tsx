"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { track } from "@vercel/analytics";
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
 *
 * **Dostupnost trialu si komponenta zjistí sama z `user`.** Dokud se předávala propem,
 * tři ze čtyř stránek posílaly natvrdo `false` a uživateli s NEVYUŽITÝM trialem tvrdily
 * „Trial jsi využil" – tedy lež přímo na konverzní cestě. `trialAvailable` proto zůstává
 * jen jako **override** pro Porovnání, které si po spotřebování trialu drží vlastní stav.
 *
 * `onUnlockTrial` chybí na stránkách, které trial neumí spotřebovat (trial odemyká jedno
 * *porovnání*). Tam se místo tlačítka ukáže odkaz tam, kde se dá uplatnit.
 */
export function ProLock({
  user,
  trialAvailable,
  onUnlockTrial,
  unlocking = false,
}: {
  user: SessionUser | null;
  trialAvailable?: boolean;
  onUnlockTrial?: () => void;
  unlocking?: boolean;
}) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const hasTrial =
    trialAvailable ?? (user?.tier === "FREE" && !user.proTrialUsed);

  async function startCheckout() {
    track("upgrade_click");
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (data?.url) {
        window.location.href = data.url;
        return; // přesměrování na Stripe
      }
    } catch {
      /* spadne do hlášky níže */
    }
    setCheckoutLoading(false);
    window.alert("Platbu se teď nepodařilo zahájit. Zkus to prosím později.");
  }

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
              onClick={() => {
                track("signin_from_prolock");
                void signIn("google");
              }}
              className="rounded-full bg-positive px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Přihlas se a vyzkoušej PRO zdarma (1×)
            </button>
            <p className="mt-2 text-xs text-muted">
              Po přihlášení odemkneš jedno porovnání s plnou analýzou.
            </p>
          </>
        ) : hasTrial && onUnlockTrial ? (
          <>
            <button
              type="button"
              onClick={() => {
                track("trial_unlock");
                onUnlockTrial();
              }}
              disabled={unlocking}
              className="rounded-full bg-positive px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {unlocking ? "Odemykám…" : "Vyzkoušet PRO zdarma (1×)"}
            </button>
            <p className="mt-2 text-xs text-muted">
              Máš jedno PRO porovnání zdarma. Vyzkoušej ho na tomto zápase.
            </p>
          </>
        ) : hasTrial ? (
          // Trial odemyká jedno *porovnání*, takže se tady spotřebovat nedá – ale mlčet
          // o něm (nebo tvrdit, že je pryč) je horší než poslat člověka tam, kde platí.
          <>
            <Link
              href="/porovnani"
              className="inline-block rounded-full bg-positive px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Vyzkoušet PRO zdarma (1×)
            </Link>
            <p className="mt-2 text-xs text-muted">
              Máš ještě jedno PRO porovnání zdarma – uplatníš ho v Porovnání.{" "}
              <button
                type="button"
                onClick={startCheckout}
                disabled={checkoutLoading}
                className="underline decoration-dotted underline-offset-2 transition hover:text-foreground disabled:opacity-60"
              >
                {checkoutLoading ? "Přesměrovávám…" : "Nebo rovnou předplatné"}
              </button>
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={startCheckout}
              disabled={checkoutLoading}
              className="rounded-full bg-positive px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {checkoutLoading ? "Přesměrovávám…" : "Upgradovat na PRO"}
            </button>
            <p className="mt-2 text-xs text-muted">
              Trial jsi využil. Odemkni všechny PRO funkce předplatným.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
