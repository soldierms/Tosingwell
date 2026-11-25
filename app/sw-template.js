// Tosingwell offline helper (service worker). vite.config.ts fills in VERSION, FILES and SOUNDS when the
// website is built, and publishes this as sw.js next to index.html.
//
// - On first visit it saves the whole app and the piano sounds on the device.
// - Opening the app: newest version from the internet when there is a connection (so updates arrive),
//   the saved copy when there is none (or the connection is too slow).
// - App files (their names change with every version) and piano sounds: the saved copy first.
// - Everything else (photo reading with Gemini/Claude) goes straight to the internet.

const VERSION = '__VERSION__';
const FILES = __FILES__; // relative to this file
const SOUNDS = __SOUNDS__; // full URLs
const APP_CACHE = `tosingwell-app-${VERSION}`;
const SOUND_CACHE = 'tosingwell-sounds-v1';
const SLOW_MS = 4000; // a page that takes longer than this to arrive is served from the saved copy

const scope = new URL(self.registration.scope);
const appUrls = new Set(FILES.map((f) => new URL(f, scope).href));
const soundUrls = new Set(SOUNDS);
const indexUrl = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const app = await caches.open(APP_CACHE);
      await app.addAll([...appUrls].map((u) => new Request(u, { cache: 'reload' })));
      // Piano sounds: kept between versions; fetch only the missing ones. Not fatal if some fail.
      const sounds = await caches.open(SOUND_CACHE);
      await Promise.all(
        SOUNDS.map(async (u) => {
          if (await sounds.match(u)) return;
          try {
            const res = await fetch(u, { mode: 'cors' });
            if (res.ok) await sounds.put(u, res);
          } catch {
            /* fetched later, the first time the piano plays */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('tosingwell-app-') && name !== APP_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** The saved copy of a request, from any of our caches. */
// ignoreVary: servers mark files "Vary: Origin", and the app's scripts are requested with an Origin header the
// saved copies were not — without it, nothing matches offline and the page stays blank.
const saved = (req) => caches.match(req, { ignoreSearch: req.mode === 'navigate', ignoreVary: true });

async function openPage(req) {
  const fromNet = fetch(req).then(async (res) => {
    if (res.ok) (await caches.open(APP_CACHE)).put(indexUrl, res.clone());
    return res;
  });
  fromNet.catch(() => {});
  const timeout = new Promise((r) => setTimeout(() => r(undefined), SLOW_MS));
  try {
    const first = await Promise.race([fromNet, timeout]);
    if (first) return first;
  } catch {
    /* offline */
  }
  const copy = (await caches.match(indexUrl, { ignoreVary: true })) ?? (await saved(req));
  return copy ?? fromNet; // nothing saved yet: wait for the network after all
}

async function savedFirst(req, cacheName) {
  const copy = await saved(req);
  if (copy) return copy;
  const res = await fetch(req);
  if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (soundUrls.has(url.href)) return event.respondWith(savedFirst(req, SOUND_CACHE));
  if (!url.href.startsWith(scope.href)) return; // other websites (photo reading): straight to the internet
  if (req.mode === 'navigate') return event.respondWith(openPage(req));
  if (appUrls.has(url.origin + url.pathname)) return event.respondWith(savedFirst(req, APP_CACHE));
  // Anything else on our site (rare): the internet first, a saved copy when offline.
  return event.respondWith(
    fetch(req).then(
      async (res) => {
        if (res.ok) (await caches.open(APP_CACHE)).put(req, res.clone());
        return res;
      },
      async () => (await saved(req)) ?? Response.error(),
    ),
  );
});
