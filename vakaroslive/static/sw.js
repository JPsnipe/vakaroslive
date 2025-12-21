const CACHE = "vakaroslive-v23";
const ASSETS = ["./", "./app.js", "./styles.css", "./leaflet.css", "./leaflet.js", "./manifest.webmanifest", "./icon.svg", "./.nojekyll"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const request = event.request;

  async function networkFirst() {
    try {
      const res = await fetch(request);
      const cache = await caches.open(CACHE);
      cache.put(request, res.clone());
      return res;
    } catch {
      const cached = await caches.match(request);
      return cached || Response.error();
    }
  }

  async function cacheFirst() {
    const cached = await caches.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    const cache = await caches.open(CACHE);
    cache.put(request, res.clone());
    return res;
  }

  const path = url.pathname;
  const useNetworkFirst =
    request.mode === "navigate" ||
    path.endsWith("/app.js") ||
    path.endsWith("/styles.css") ||
    path.endsWith("/leaflet.css") ||
    path.endsWith("/leaflet.js") ||
    path.endsWith("/manifest.webmanifest");

  if (useNetworkFirst) {
    event.respondWith(networkFirst());
    return;
  }
  event.respondWith(cacheFirst());
});
