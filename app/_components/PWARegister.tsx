"use client";

import { useEffect, useState } from "react";

/** Zaregistruje service worker (jen v produkci) a nabídne obnovu při aktualizaci. */
export function PWARegister() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | undefined;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((r) => {
          reg = r;
          // Nově nalezený worker → sleduj, až bude nainstalovaný. Pokud už nějaký
          // controller existuje, jde o AKTUALIZACI (ne první instalaci) → nabídni obnovu.
          r.addEventListener("updatefound", () => {
            const sw = r.installing;
            if (!sw) return;
            sw.addEventListener("statechange", () => {
              if (sw.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateReady(true);
              }
            });
          });
        })
        .catch(() => {});
    };
    window.addEventListener("load", onLoad);
    return () => {
      window.removeEventListener("load", onLoad);
      void reg;
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg">
      <span className="text-foreground">Je dostupná nová verze.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition hover:opacity-90"
      >
        Obnovit
      </button>
    </div>
  );
}
