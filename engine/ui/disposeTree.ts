import type * as THREE from "three";

/** Dispose geometries, materials and textures below `root` (skips anything flagged `userData.keep`). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData?.keep) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (mat.userData?.keep) continue;
      for (const key of Object.keys(mat)) {
        const v = (mat as unknown as Record<string, unknown>)[key];
        // a texture (duck typed: no runtime import of three.js here, the 2D games load this file too)
        const t = v as THREE.Texture | null;
        if (t && typeof t === "object" && t.isTexture && !t.userData?.keep) t.dispose();
      }
      mat.dispose();
    }
  });
}
