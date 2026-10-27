import type * as THREE from "three";
import manifest from "../assets.json";

export interface AssetEntry {
  glb: string;
  available: boolean;
  scale: number;
  yaw: number;
}

type Group = Record<string, AssetEntry>;
const groups = manifest as unknown as { cars: Group; traffic: Group; people: Group; landmarks: Group };

/** The manifest entry of an object, or null when its GLB does not exist (yet): the caller then builds the procedural fallback. */
export function resolveAsset(group: "cars" | "traffic" | "people" | "landmarks", key: string): AssetEntry | null {
  const e = groups[group]?.[key];
  return e && e.available ? e : null;
}

/** Load a GLB (only called for entries with `available: true`). Returns null on any failure so the fallback is used. */
export async function loadModel(e: AssetEntry): Promise<THREE.Object3D | null> {
  try {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().loadAsync(e.glb);
    const root = gltf.scene;
    root.scale.setScalar(e.scale);
    root.rotation.y = e.yaw;
    return root;
  } catch {
    return null;
  }
}
