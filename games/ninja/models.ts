import * as THREE from "three";
import manifestDefault from "./assets.json";

// Optional GLB models. `assets.json` lists a model per fruit (and the bomb); every entry that is not null replaces the
// procedural art once the file has loaded. Any failure (404, bad file) keeps the procedural fallback - the game never waits for it.

export interface ModelEntry {
  whole: string | null;
  half: string | null;
  scale: number;
}
export interface Manifest {
  fruits: Record<string, ModelEntry>;
  bomb: ModelEntry;
}

const url = (v: unknown): string | null => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null);

function entry(raw: unknown): ModelEntry {
  const o = (raw ?? {}) as Record<string, unknown>;
  const s = typeof o.scale === "number" && o.scale > 0.05 && o.scale < 20 ? o.scale : 1;
  return { whole: url(o.whole), half: url(o.half), scale: s };
}

/** Tolerant parser: unknown / malformed parts become "no model". Only same-origin paths ("/models/...") are accepted. */
export function parseManifest(raw: unknown): Manifest {
  const o = (raw ?? {}) as { fruits?: Record<string, unknown>; bomb?: unknown };
  const fruits: Record<string, ModelEntry> = {};
  for (const [k, v] of Object.entries(o.fruits ?? {})) fruits[k] = entry(v);
  return { fruits, bomb: entry(o.bomb) };
}

export function hasModels(m: Manifest): boolean {
  return Object.values(m.fruits).some((e) => e.whole || e.half) || !!(m.bomb.whole || m.bomb.half);
}

/** The bundled manifest, or (for tests / staging) `?assets=/path/to/manifest.json` served by our own origin. */
export async function loadManifest(query: URLSearchParams): Promise<Manifest> {
  const override = url(query.get("assets"));
  if (override) {
    try {
      const r = await fetch(override);
      if (r.ok) return parseManifest(await r.json());
    } catch {
      /* fall through to the bundled manifest */
    }
  }
  return parseManifest(manifestDefault);
}

/** Loads a GLB and normalises it: centred, bounding sphere radius 1 (times scale). Resolves null on any failure. */
export async function loadGlb(path: string, scale: number): Promise<THREE.Group | null> {
  try {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(path);
    const root = new THREE.Group();
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const k = sphere.radius > 1e-6 ? scale / sphere.radius : scale;
    model.position.copy(sphere.center).multiplyScalar(-k);
    model.scale.setScalar(k);
    root.add(model);
    return root;
  } catch (e) {
    console.warn("Meva Ninja: model yuklanmadi, protsedura ishlatiladi:", path, e);
    return null;
  }
}

export function disposeObject(o: THREE.Object3D): void {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
      x.dispose();
    }
  });
}
