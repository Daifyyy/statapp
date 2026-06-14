// Minimální service worker pro PWA: app-shell cache + offline fallback.
// Záměrně konzervativní – necachuje API ani HTML porovnání (vždy z čerstva přes síť);
// jen statické assety a kořenovou stránku jako offline shell.

const CACHE = "predictapp-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/logoapp.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cizí (logoCDN, API-Football) neřeš
  if (url.pathname.startsWith("/api/")) return; // dynamická data vždy ze sítě

  // Navigace: síť napřed, při výpadku offline shell (kořen z cache).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/").then((r) => r || Response.error()))
    );
    return;
  }

  // Statické assety: cache napřed, jinak síť (a doplň do cache).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
    )
  );
});
