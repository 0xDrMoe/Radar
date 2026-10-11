// Minimal runtime-caching service worker — no build-time precache manifest, since vinext's
// static asset filenames are content-hashed per deploy and a stale hardcoded list would just
// serve 404s after the next release. Two strategies only: stale-while-revalidate for the app's
// own static assets (fast repeat visits, self-heals as soon as the network responds), and
// network-first for page navigations (always prefers a fresh page; falls back to a stored copy
// of a public page so an offline visitor doesn't just get the browser's dinosaur).
//
// Version 1 stored every page it navigated to, in one cache that was never cleared: signed-in
// dashboard, admin, affiliate and portal pages stayed on the device after sign-out, and an error
// page (a 5xx) could overwrite the good copy of a page and be replayed offline. Renaming
// both caches is what evicts everything version 1 stored: activation deletes every cache not named
// here.
const STATIC_CACHE = "radar-static-v2";
const PAGE_CACHE = "radar-pages-v2";
// Pages are kept for reading offline, not as an archive; the oldest go first.
const MAX_PAGES = 40;

// Never stored, whatever their headers say: every area that exists to show one person their own
// account, and the pages that sign people in. Both with and without a locale in front, since the
// operator areas live outside the locale tree and the consumer ones inside it.
const PRIVATE_PATH = /^\/(?:(?:en|fr|es)\/)?(?:admin|portal|portal-invite|affiliate|creator|dashboard|sign-in|sign-up)(?:\/|$)/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

// Sent by app/InstallPrompt.tsx on the first page a browser loads after its session cookie has
// gone, which is what signing out looks like from here. Nothing personal should be in the page
// cache (see storablePage), so this is the second lock on the same door, not the only one.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "radar:clear-pages") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  }
});

// The Cookie Store API, where the browser has one in a service worker (Chromium does). Elsewhere
// this answers "no session", and the server's Cache-Control is what keeps a signed-in page out:
// every page rendered for a request carrying __session is sent no-store (worker/index.ts).
async function hasSession() {
  try {
    return Boolean(self.cookieStore && (await self.cookieStore.get("__session")));
  } catch {
    return false;
  }
}

// Only a page that is the same for everyone: a complete 200 HTML document, on this origin, that the
// server did not mark no-store — the Worker marks every personal page no-store, and sends
// `private, no-cache` only for pages that are identical for every reader — outside the private
// areas, and fetched without a session. The affiliate portal's own hostname is all private.
async function storablePage(request, response) {
  if (!response || response.status !== 200 || response.type !== "basic" || response.redirected) return false;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return false;
  if (/no-store/i.test(response.headers.get("cache-control") || "")) return false;
  const url = new URL(request.url);
  if (url.hostname.startsWith("affiliate.") || PRIVATE_PATH.test(url.pathname)) return false;
  return !(await hasSession());
}

async function storePage(request, response) {
  const cache = await caches.open(PAGE_CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  // Cache Storage lists keys in insertion order, and put() on an existing key re-inserts it.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_PAGES)).map((key) => cache.delete(key)));
}

// Offline: this page if it was stored, then the same page without its query string, then the home
// page for its language, which is the page most likely to have been stored.
async function offlinePage(request) {
  const cache = await caches.open(PAGE_CACHE);
  const url = new URL(request.url);
  const locale = /^\/(en|fr|es)(?:\/|$)/.exec(url.pathname)?.[1] || "en";
  return (
    (await cache.match(request)) ||
    (await cache.match(request, { ignoreSearch: true })) ||
    (await cache.match(`/${locale}`)) ||
    Response.error()
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Decided and stored in the background, from a clone, so the visitor's page is never held
          // up by the check or the write.
          const copy = response.clone();
          event.waitUntil(
            storablePage(request, copy)
              .then((ok) => (ok ? storePage(request, copy) : copy.body?.cancel()))
              .catch(() => {}),
          );
          return response;
        })
        .catch(() => offlinePage(request)),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/og.png"
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || network;
        }),
      ),
    );
  }
});
