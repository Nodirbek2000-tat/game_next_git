import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { QualityLevel } from "../types";

/**
 * URL of a texture that scripts/optimize-assets.mjs wrote as `<stem>.webp` (full size) and `<stem>.lo.webp` (half size,
 * for the "low" quality level). `stem` is the public path without the extension: "/textures/poyga/pbr/road_color".
 * The level is read once when the texture is requested; a later quality change does not reload it.
 */
export function texUrl(stem: string, level: QualityLevel): string {
  return `${stem}${level === "low" ? ".lo" : ""}.webp`;
}

/**
 * A GLTFLoader that also reads the meshopt-compressed GLBs of the optimised assets. Loaded lazily (the loader and the
 * decoder are only needed once a game asks for a model).
 */
export async function newGltfLoader(): Promise<GLTFLoader> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
