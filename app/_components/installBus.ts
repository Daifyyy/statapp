// Drobná window-event sběrnice: umožní z menu/patičky ručně vyvolat instalační
// pomůcku (InstallPrompt ji poslouchá). Žádná závislost, jen DOM event.

const INSTALL_EVENT = "predictapp:install";

export function requestInstall(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INSTALL_EVENT));
  }
}

export function onInstallRequest(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(INSTALL_EVENT, cb);
  return () => window.removeEventListener(INSTALL_EVENT, cb);
}
