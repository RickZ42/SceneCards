const CACHE_NAME = "scenecards-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./data/cards.json",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

// Cache the scripts referenced by this exact HTML before making it the offline shell.
async function cachePage(cache, response) {
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((match) => new URL(match[1], scopeUrl("./index.html")))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => url.href);
  await cache.addAll([...new Set(assets)]);
  await cache.put(scopeUrl("./index.html"), response.clone());
}

async function offlinePage(cache) {
  return await cache.match(scopeUrl("./index.html")) || new Response(
    '<!doctype html><meta name="viewport" content="width=device-width"><p>SceneCards is offline. Connect to the internet and reopen this page.</p>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL.filter((path) => path !== "./" && path !== "./index.html").map(scopeUrl));

    const indexResponse = await fetch(scopeUrl("./index.html"), { cache: "no-store" });
    if (!indexResponse.ok) throw new Error("SceneCards shell is unavailable");
    await cachePage(cache, indexResponse);

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("scenecards-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (!response.ok) return offlinePage(cache);
        await cachePage(cache, response);
        return response;
      } catch {
        return offlinePage(cache);
      }
    })());
    return;
  }

  if (url.pathname.endsWith("/data/cards.json")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return caches.match(request);
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
