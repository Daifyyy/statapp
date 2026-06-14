"use client";

import { useEffect, useState } from "react";
import { onInstallRequest } from "./installBus";

// Interaktivní pomůcka pro instalaci PWA. Většina lidí PWA neumí nainstalovat →
// vedeme je za ruku. Android/Chromium má nativní prompt (beforeinstallprompt);
// iOS Safari nikoli → ukážeme vizuální návod Sdílet → Přidat na plochu.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pa_install_dismissed_at";
const DISMISS_DAYS = 7;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return isIOS() && /safari/i.test(ua) && !/crios|fxios|edgios|chrome/i.test(ua);
}
function recentlyDismissed(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY));
    if (!ts) return false;
    return Date.now() - ts < DISMISS_DAYS * 864e5;
  } catch {
    return false;
  }
}

type Kind = "android" | "ios" | "ios-other" | "unsupported";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("unsupported");

  useEffect(() => {
    if (isStandalone()) return; // už nainstalováno → nikdy nezobrazuj

    function onBIP(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setKind("android");
      if (!recentlyDismissed()) setOpen(true);
    }
    function onInstalled() {
      setOpen(false);
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {
        /* noop */
      }
    }
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari nemá beforeinstallprompt → po chvíli nabídni návod.
    // setState až v timer callbacku (ne synchronně v těle efektu).
    let t: ReturnType<typeof setTimeout> | undefined;
    if (isIOSSafari() && !recentlyDismissed()) {
      t = setTimeout(() => {
        setKind("ios");
        setOpen(true);
      }, 2500);
    }

    // Ruční vyvolání z menu/patičky (ignoruje „odloženo").
    const off = onInstallRequest(() => {
      if (isStandalone()) return;
      if (deferred) setKind("android");
      else if (isIOSSafari()) setKind("ios");
      else if (isIOS()) setKind("ios-other");
      else setKind(deferred ? "android" : "unsupported");
      setOpen(true);
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
      off();
    };
    // deferred záměrně mimo deps – přečte se aktuální přes closure v handlerech
    // znovu připojených při změně; pro jistotu ho přidáme.
  }, [deferred]);

  function dismiss() {
    setOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* noop */
    }
  }

  async function androidInstall() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 sm:p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            📲 Nainstaluj Predictapp jako appku
          </h3>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Zavřít"
            className="-mr-1 -mt-1 rounded-full px-2 py-0.5 text-muted transition hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-2 text-sm text-muted">
          {kind === "android" && (
            <p>Přidej si Predictapp na plochu pro rychlý přístup a režim na celou obrazovku.</p>
          )}
          {kind === "ios" && (
            <ol className="space-y-2">
              <Step n={1}>
                Klepni dole na <Pill>Sdílet</Pill> <span aria-hidden>⬆️</span>
              </Step>
              <Step n={2}>
                Vyber <Pill>Přidat na plochu</Pill> <span aria-hidden>➕</span>
              </Step>
              <Step n={3}>
                Potvrď vpravo nahoře <Pill>Přidat</Pill>
              </Step>
            </ol>
          )}
          {kind === "ios-other" && (
            <p>
              Na iPhonu jde instalace jen v prohlížeči <strong>Safari</strong>. Otevři
              tuto stránku v Safari a pak Sdílet → Přidat na plochu.
            </p>
          )}
          {kind === "unsupported" && (
            <p>
              Tvůj prohlížeč instalaci nenabízí. Zkus to v Chrome (Android/desktop)
              nebo Safari (iPhone) přes nabídku prohlížeče &bdquo;Přidat na plochu&ldquo;.
            </p>
          )}
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-muted transition hover:text-foreground"
          >
            Teď ne
          </button>
          {kind === "android" && (
            <button
              type="button"
              onClick={androidInstall}
              className="rounded-full bg-positive px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Nainstalovat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive/15 text-[11px] font-bold text-positive">
        {n}
      </span>
      <span className="leading-snug text-foreground">{children}</span>
    </li>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-background px-1.5 py-0.5 text-xs font-semibold text-foreground">
      {children}
    </span>
  );
}
