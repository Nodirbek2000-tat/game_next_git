// The big engine files on the device: registers public/sw.js (the cache itself) and warms it ahead of time.
//
// What a game needs before it can start (assetPlan): the MediaPipe wasm engine + pose model for the main games, the MoveNet model
// for the Bog'cha games. Warming = downloading those files into the service worker's cache while nothing else needs the network:
//   - on the site pages (the menu), a few seconds after the page settled, only on an unmetered / fast enough connection;
//   - on the play page right away, in parallel with the camera permission and the game module (the start no longer waits for it).
// Every download goes through the service worker, which shares one download between the page and the detector worker, so a file is
// never fetched twice. Without a service worker (old browser, private mode) nothing is warmed and the game loads as before.

import { resolvePoseModel } from "../quality/gpu";
import { snapshotSettings } from "../settings/store";

/** must match CACHE in public/sw.js */
export const ASSET_CACHE = "harakat-assets-v1";

export type EngineKind = "mediapipe" | "movenet";

/** MediaPipe's own SIMD probe (vision_bundle.js): the engine picks the SIMD or the no-SIMD wasm with exactly this test */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

async function simd(): Promise<boolean> {
  try {
    await WebAssembly.instantiate(SIMD_PROBE);
    return true;
  } catch {
    return false;
  }
}

const MOVENET_JSON = "/models/movenet-multipose/model.json";

/** The files the detector of `kind` downloads before a game can start, the biggest first. */
export async function assetPlan(kind: EngineKind): Promise<string[]> {
  if (kind === "movenet") {
    try {
      const res = await fetch(MOVENET_JSON);
      const m = (await res.json()) as { weightsManifest?: { paths: string[] }[] };
      const shards = (m.weightsManifest ?? []).flatMap((g) => g.paths).map((p) => `/models/movenet-multipose/${p}`);
      return [MOVENET_JSON, ...shards];
    } catch {
      return [MOVENET_JSON];
    }
  }
  const w = (await simd()) ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
  const pose = resolvePoseModel(snapshotSettings().poseModel);
  return [`/mediapipe/${w}.wasm`, `/models/pose_landmarker_${pose}.task`, `/mediapipe/${w}.js`, "/mediapipe/vision_bundle.js"];
}

let registering: Promise<ServiceWorkerContainer | null> | null = null;

/** Registers the service worker once (production builds only; dev servers change files all the time). */
export function registerAssetCache(): Promise<ServiceWorkerContainer | null> {
  if (registering) return registering;
  registering = (async () => {
    if (process.env.NODE_ENV !== "production" || typeof navigator === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return null;
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      return navigator.serviceWorker;
    } catch {
      return null;
    }
  })();
  return registering;
}

/**
 * Resolves true once this page's requests go through the service worker (it claims open pages when it activates: the very first
 * visit gets there within a moment), false when there is none or it takes longer than `ms`.
 */
export async function assetCacheReady(ms = 2000): Promise<boolean> {
  const sw = await registerAssetCache();
  if (!sw) return false;
  if (sw.controller) return true;
  return new Promise<boolean>((resolve) => {
    const t = setTimeout(() => {
      sw.removeEventListener("controllerchange", on);
      resolve(!!sw.controller);
    }, ms);
    const on = (): void => {
      clearTimeout(t);
      resolve(true);
    };
    sw.addEventListener("controllerchange", on, { once: true });
  });
}

type NetInfo = { saveData?: boolean; effectiveType?: string; type?: string };

/** May the menu download ~10-20 MB the user did not ask for yet? Not with data saver, on 2G or on mobile data. */
export function idleWarmAllowed(): boolean {
  const c = (navigator as Navigator & { connection?: NetInfo }).connection;
  if (!c) return true;
  if (c.saveData) return false;
  if (c.effectiveType === "slow-2g" || c.effectiveType === "2g") return false;
  if (c.type === "cellular") return false;
  return true;
}

/** Is `url` already on the device? */
async function cached(url: string): Promise<boolean> {
  try {
    const c = await caches.open(ASSET_CACHE);
    return !!(await c.match(new URL(url, location.href).href));
  } catch {
    return false;
  }
}

/**
 * Downloads `urls` into the service worker cache one after the other (low priority, aborted by `signal`). Files already on the
 * device are skipped. Needs a controlling service worker: without one it does nothing (a second, unshared download of the same
 * file would only slow the game down).
 */
export async function warmAssets(urls: readonly string[], signal?: AbortSignal): Promise<void> {
  if (typeof caches === "undefined" || !navigator.serviceWorker?.controller) return;
  for (const url of urls) {
    if (signal?.aborted) return;
    if (await cached(url)) continue;
    try {
      const res = await fetch(url, { signal, priority: "low" } as RequestInit);
      // read to the end and drop it: the service worker stores its own copy
      const reader = res.body?.getReader();
      if (reader) for (;;) if ((await reader.read()).done) break;
    } catch {
      return; // aborted / offline: the game downloads what it needs itself
    }
  }
}

/** Warms the engine of `kind` once the page is idle; returns a function that stops it. */
export function warmWhenIdle(kind: EngineKind, delayMs = 4000): () => void {
  const ac = new AbortController();
  const t = setTimeout(async () => {
    if (!idleWarmAllowed() || !(await assetCacheReady(3000)) || ac.signal.aborted) return;
    await warmAssets(await assetPlan(kind), ac.signal);
  }, delayMs);
  return () => {
    clearTimeout(t);
    ac.abort();
  };
}
