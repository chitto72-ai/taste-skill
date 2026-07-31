/* Service worker Glufree: cache-first per gli asset, network-first per pagine e API. */
const CACHE = "glufree-v2";
const PRECACHE = ["/", "/mappa", "/registra-locale", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Le tile della mappa e le API restano sempre fresche (network-first)
  const networkFirst =
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("cartocdn") ||
    request.mode === "navigate";

  if (networkFirst) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/")))
    );
    return;
  }

  // Asset statici: cache-first
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return res;
        })
    )
  );
});
