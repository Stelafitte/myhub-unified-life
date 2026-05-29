/* MyHub Pro – Service Worker
 * Strategy:
 *   - Navigations (HTML): NetworkFirst, fallback to cached '/'
 *   - Same-origin static assets: StaleWhileRevalidate
 *   - Supabase REST/Storage: NetworkFirst (short timeout) with cache fallback
 * Data offline = served by IndexedDB caches in the app (emails, tasks, contacts, events).
 */
const VERSION = "myhub-pro-v2";
const APP_SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const API = `${VERSION}-api`;

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL);
      try {
        await cache.add(new Request("/", { cache: "reload" }));
      } catch {}
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(req, cacheName, timeoutMs = 3000) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Bypass dev/HMR
  if (
    url.pathname.startsWith("/@") ||
    url.pathname.includes("__vite") ||
    url.pathname.includes("hot-update")
  )
    return;

  // OAuth callbacks must always hit the network so auth tokens are never served from cache.
  if (url.pathname.startsWith("/~oauth")) return;

  // Navigations
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, APP_SHELL, 2500));
    return;
  }

  // Supabase API
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in")) {
    event.respondWith(networkFirst(req, API, 4000));
    return;
  }

  // Same-origin static assets
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, ASSETS));
    return;
  }
});

// Allow the app to ask the SW to skip waiting (after update)
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
