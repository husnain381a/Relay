"use strict";

// Deliberately cache only public, account-independent assets.
// Never store navigations, API/Auth requests, messages, signed URLs or uploads.
const CACHE = "relay-public-v1";
const OFFLINE = "/offline.html";
const PUBLIC_ASSETS = [
  OFFLINE,
  "/icons/relay.svg",
  "/icons/relay-192.png",
  "/icons/relay-512.png",
  "/icons/relay-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          PUBLIC_ASSETS.map(
            (path) =>
              new Request(path, { cache: "reload", credentials: "omit" }),
          ),
        ),
      ),
  );
  // Updates wait for consent or for all app windows to close.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("relay-public-") && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (
    event.data?.type === "SKIP_WAITING" &&
    event.source?.url &&
    new URL(event.source.url).origin === self.location.origin
  )
    self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/auth" ||
    url.pathname.startsWith("/auth/")
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await (await caches.open(CACHE)).match(OFFLINE);
        return (
          fallback ??
          new Response("Relay is offline. Reconnect and try again.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
    return;
  }
  if (!url.search && PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(url.pathname)) ?? fetch(request);
      })(),
    );
  }
});
