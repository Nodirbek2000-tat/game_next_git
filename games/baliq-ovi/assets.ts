// Resolves visual / audio assets through assets.json. A missing file (present: false, or a failed load) is NOT an error:
// the caller builds procedural geometry or synthesised sound instead.

import type * as THREE from "three";
import { newGltfLoader } from "@/engine/quality/assetUrl";
import manifestJson from "./assets.json";

interface Entry {
  path: string;
  present: boolean;
}
export interface Manifest {
  root: string;
  models: Record<string, Entry>;
  textures: Record<string, Entry>;
  sounds: Record<string, Entry>;
}

export const MANIFEST = manifestJson as unknown as Manifest;

export type AssetKind = "models" | "textures" | "sounds";

/** Public URL of an asset, or null when it is not delivered yet. */
export function assetUrl(kind: AssetKind, key: string, m: Manifest = MANIFEST): string | null {
  const e = m[kind][key];
  if (!e || !e.present) return null;
  return e.path.startsWith("/") ? e.path : (kind === "sounds" ? "" : m.root) + e.path;
}

export class AssetLib {
  private cache = new Map<string, Promise<THREE.Object3D | null>>();
  private disposed = false;
  constructor(private m: Manifest = MANIFEST) {}

  /** The GLB scene for `key`, or null (missing file, load error, disposed). Never throws. */
  model(key: string): Promise<THREE.Object3D | null> {
    const url = assetUrl("models", key, this.m);
    if (!url) return Promise.resolve(null);
    let p = this.cache.get(key);
    if (!p) {
      p = (async () => {
        try {
          const gltf = await (await newGltfLoader()).loadAsync(url);
          return this.disposed ? null : gltf.scene;
        } catch {
          return null;
        }
      })();
      this.cache.set(key, p);
    }
    return p;
  }

  /** An audio file decoded with the given context, or null. */
  async sound(ctx: BaseAudioContext, key: string): Promise<AudioBuffer | null> {
    const url = assetUrl("sounds", key, this.m);
    if (!url) return null;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await ctx.decodeAudioData(await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }
}
