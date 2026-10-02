/* Whirl's service worker.
 *
 * It does two things and refuses to do a third:
 *
 *   1. Answers a navigation that the network couldn't with an offline page,
 *      so a tunnel or a dead connection gets Whirl's own face instead of the
 *      browser's dinosaur.
 *   2. Serves the fonts and icons from cache, because they never change
 *      within a build and they are what the first frame waits on.
 *
 * Everything else is passed straight through, untouched — no respondWith, no
 * cache entry, no opinion. Notably it never caches HTML or /_next chunks:
 * a worker holding one build's markup against another build's assets is how
 * a deploy turns into a white screen, and the win (a marginally faster warm
 * load) is not worth owning that failure mode. The HTTP cache already does
 * that job, and it knows about deploys.
 *
 * Bump CACHE when the precache list changes; stale ones are swept on
 * activate. The file itself updates on its own — the browser byte-compares
 * it on every navigation.
 */

const CACHE = "whirl-shell-v1";
const OFFLINE_URL = "/offline.html";

/* Small, and every one of them outlives a deploy: the font is content-stable
   and the icons are the installed app's own face. */
const PRECACHE = [
  OFFLINE_URL,
  "/fonts/InterVariable.woff2",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/* Requests that must always reach the network, even for a shape this worker
   would otherwise answer: anything user-specific, anything streamed. */
const NEVER_INTERCEPT = ["/api/", "/_next/data/", "/artifact-frame"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      /* One at a time and forgiving: a single 404 in addAll rejects the
         whole install, and an install that never completes leaves the
         previous worker in charge forever. */
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            // Missing or offline at install time; the fetch path still works.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("whirl-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isPrecachedAsset(url) {
  return url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (NEVER_INTERCEPT.some((prefix) => url.pathname.startsWith(prefix))) return;

  /* A navigation the network can't answer gets the offline page. Network
     first, always — the cached copy is a fallback, never a shortcut. */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match(OFFLINE_URL);
          return (
            cached ??
            new Response("Offline.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
    return;
  }

  if (!isPrecachedAsset(url)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      /* Only keep what actually arrived intact — an opaque or errored
         response cached here would outlive the outage that caused it. */
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
