/* Harakat o'yinlari — service worker: keeps the big engine files on the device (engine/net/assetCache.ts registers it).
 *
 * Only the large, rarely changing files are handled: /models/ (MediaPipe + MoveNet), /mediapipe/ (wasm engine), /textures/, /audio/,
 * /detect-gpu/. Pages, scripts and API calls never go through this cache (a deploy shows up at once).
 *
 * - cache first: a file that was downloaded once opens from the device, also on a bad connection;
 * - one download per file: when the page warms a file and a worker asks for the same one at the same time, both get the same download;
 * - at most once a day a file is re-checked in the background with its ETag (a cheap 304 when nothing changed); a changed file is stored
 *   and used from the next visit on;
 * - Range requests (audio streaming) and anything that is not a plain same-origin GET pass straight through.
 * Camera pictures never pass here: they never leave the device.
 */
/* eslint-disable no-restricted-globals */

const CACHE = "harakat-assets-v1";
const META = "harakat-assets-meta-v1";
const PREFIXES = ["/models/", "/mediapipe/", "/textures/", "/audio/", "/detect-gpu/"];
const RECHECK_MS = 24 * 3600 * 1000;

/** downloads in progress: url -> Promise<Response> (the untouched original; every user gets a clone) */
const inflight = new Map();
/** background re-checks in progress */
const checking = new Set();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("harakat-assets") && k !== CACHE && k !== META) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

function handled(req) {
  if (req.method !== "GET" || req.headers.has("range")) return false;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || u.search) return false;
  return PREFIXES.some((p) => u.pathname.startsWith(p));
}

/** The copy that is stored: same body and type; length / encoding headers dropped when the network copy was compressed. */
function storable(res) {
  const h = new Headers(res.headers);
  if (h.has("content-encoding")) {
    h.delete("content-encoding");
    h.delete("content-length");
  }
  return new Response(res.body, { status: 200, statusText: "OK", headers: h });
}

async function remember(url, res) {
  const meta = await caches.open(META);
  await meta.put(url, new Response(JSON.stringify({ at: Date.now(), etag: res.headers.get("etag") || "" }), { headers: { "content-type": "application/json" } }));
}

/** Network download shared by everyone who asks for `url` meanwhile; stored when complete. */
function download(url, waitUntil) {
  let p = inflight.get(url);
  if (!p) {
    p = fetch(url, { credentials: "same-origin" });
    inflight.set(url, p);
    const done = p
      .then(async (res) => {
        if (res.status !== 200) return;
        const c = await caches.open(CACHE);
        await c.put(url, storable(res.clone()));
        await remember(url, res);
      })
      .catch(() => undefined) // full disk / quota / aborted: the page still got its file
      .finally(() => inflight.delete(url));
    waitUntil(done);
  }
  return p.then((res) => res.clone());
}

async function recheck(url) {
  if (checking.has(url)) return;
  checking.add(url);
  try {
    const meta = await caches.open(META);
    const m = await meta.match(url);
    const info = m ? await m.json() : { at: 0, etag: "" };
    if (Date.now() - info.at < RECHECK_MS) return;
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: info.etag ? { "if-none-match": info.etag } : {} });
    if (res.status === 304) {
      await remember(url, new Response(null, { headers: { etag: info.etag } }));
    } else if (res.status === 200) {
      const etag = res.headers.get("etag") || "";
      if (etag && etag === info.etag) {
        await res.body?.cancel();
        await remember(url, res);
      } else {
        const c = await caches.open(CACHE);
        await c.put(url, storable(res.clone()));
        await remember(url, res);
      }
    }
  } catch {
    /* offline: try again next time */
  } finally {
    checking.delete(url);
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (!handled(req)) return;
  const url = new URL(req.url).href;
  e.respondWith(
    (async () => {
      try {
        const c = await caches.open(CACHE);
        const hit = await c.match(url);
        if (hit) {
          e.waitUntil(recheck(url));
          return hit;
        }
      } catch {
        /* storage unavailable: network */
      }
      return download(url, (p) => e.waitUntil(p));
    })(),
  );
});
