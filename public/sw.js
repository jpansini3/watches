const CACHE_NAME = "watches-static-v1";

const STATIC_PREFIXES = ["/_next/static/", "/icons/"];
const STATIC_FILES = new Set([
  "/favicon.svg",
  "/favicon.png",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
]);

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (STATIC_FILES.has(url.pathname)) return true;
  return STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") return;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (!isStaticAsset(url)) return;

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}
