// The shore's real vegetation: firs (Poly Haven fir_tree_01, CC0, via tools/blender/fir_trees.py) and grass patches
// (grass_medium_01 via tools/blender/baliq_props.py). The camera hardly moves, so every tree is decided once: the
// nearest ones are full 3D models (bark + needle cards), the rest are single billboards of an impostor rendered in
// Blender, turned to face the camera. One instanced mesh per variant and part (~12 draw calls for ~500 trees).

import * as THREE from "three";
import type { Spot } from "./world";

const TREES = ["fir_0", "fir_1", "fir_2"];
// the big dense fir most often, the sparse young one rarely
const PICK = [0.5, 0.85, 1];

type Manifest = Record<string, { h: number; w: number; leaf?: string }>;

export class Scenery {
  readonly group = new THREE.Group();
  private owned: { dispose(): void }[] = [];
  private alive = true;
  /** called once the trees are in (the procedural cones can go) */
  onTrees: (() => void) | null = null;

  constructor(
    private trees: Spot[],
    private grass: Spot[],
    private cam: THREE.Vector3,
    private nearDist: number,
    private sway: (m: THREE.Material, amp: number) => void,
  ) {
    this.group.name = "scenery";
    void this.loadTrees();
    if (grass.length) void this.loadGrass();
  }

  private variant(k: number): number {
    return PICK.findIndex((p) => k <= p);
  }

  private async loadTrees(): Promise<void> {
    try {
      const man = (await (await fetch("/models/baliq-ovi/trees/trees.json")).json()) as Manifest;
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      const texL = new THREE.TextureLoader();
      const o = new THREE.Object3D();
      // spots per variant, near / far
      const near: Spot[][] = TREES.map(() => []);
      const far: Spot[][] = TREES.map(() => []);
      for (const t of this.trees) {
        const v = this.variant(t.k);
        const d = Math.hypot(t.x - this.cam.x, t.z - this.cam.z);
        (d < this.nearDist ? near : far)[v].push(t);
      }
      for (let v = 0; v < TREES.length; v++) {
        const name = TREES[v];
        const m = man[name];
        if (!m) continue;
        // ---- far: one camera-facing quad; its normal points up so the light on it is the light on a crown
        if (far[v].length) {
          const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
          const n = g.getAttribute("normal");
          for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
          const tex = texL.load(`/textures/baliq-ovi/trees/imp_${name}.png`);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          // Lambert: no specular sheen of the (bright, low) sky on the flat quad
          const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xf2f2ea, alphaTest: 0.42, side: THREE.DoubleSide });
          const im = new THREE.InstancedMesh(g, mat, far[v].length);
          far[v].forEach((t, i) => {
            o.position.set(t.x, t.y - 0.02 * m.h * t.s, t.z);
            o.rotation.set(0, Math.atan2(this.cam.x - t.x, this.cam.z - t.z), 0);
            o.scale.set(m.w * t.s, m.h * t.s, 1);
            o.updateMatrix();
            im.setMatrixAt(i, o.matrix);
          });
          im.frustumCulled = false;
          this.owned.push(g, mat, tex);
          this.group.add(im);
        }
        // ---- near: the model
        if (near[v].length) {
          const gltf = await loader.loadAsync(`/models/baliq-ovi/trees/${name}.glb`);
          if (!this.alive) return;
          gltf.scene.updateMatrixWorld(true);
          const leafTex = m.leaf ? texL.load(`/textures/baliq-ovi/trees/${m.leaf}`) : null;
          if (leafTex) {
            leafTex.colorSpace = THREE.SRGBColorSpace;
            this.owned.push(leafTex);
          }
          gltf.scene.traverse((ob) => {
            const mesh = ob as THREE.Mesh;
            if (!mesh.isMesh) return;
            const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.metalness = 0;
            mat.transparent = false;
            mat.depthWrite = true;
            if (mat.name === "leaves") {
              if (leafTex) mat.map = leafTex;
              mat.alphaTest = 0.38;
              mat.side = THREE.DoubleSide;
              mat.roughness = 0.9;
              mat.envMapIntensity = 0.5;
            }
            const im = new THREE.InstancedMesh(geo, mat, near[v].length);
            near[v].forEach((t, i) => {
              o.position.set(t.x, t.y, t.z);
              o.rotation.set(0, t.rot, 0);
              o.scale.setScalar(t.s);
              o.updateMatrix();
              im.setMatrixAt(i, o.matrix);
            });
            im.frustumCulled = false;
            this.owned.push(geo, mat);
            this.group.add(im);
          });
        }
      }
      if (this.alive) this.onTrees?.();
    } catch {
      /* the procedural trees stay */
    }
  }

  private async loadGrass(): Promise<void> {
    try {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync("/models/baliq-ovi/grass.glb");
      if (!this.alive) return;
      gltf.scene.updateMatrixWorld(true);
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse((ob) => {
        if ((ob as THREE.Mesh).isMesh && !mesh) mesh = ob as THREE.Mesh;
      });
      if (!mesh) return;
      const src = mesh as THREE.Mesh;
      const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
      const mat = src.material as THREE.MeshStandardMaterial;
      // the GLB's JPEG has no alpha: the RGBA version (diff + Poly Haven's alpha map) is next to it
      const tex = new THREE.TextureLoader().load("/textures/baliq-ovi/grass_rgba.png");
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.alphaTest = 0.45;
      mat.transparent = false;
      mat.depthWrite = true;
      mat.side = THREE.DoubleSide;
      mat.metalness = 0;
      mat.roughness = 0.9;
      mat.envMapIntensity = 0.5;
      this.sway(mat, 0.25);
      const im = new THREE.InstancedMesh(geo, mat, this.grass.length);
      const o = new THREE.Object3D();
      this.grass.forEach((t, i) => {
        o.position.set(t.x, t.y, t.z);
        o.rotation.set(0, t.rot, 0);
        o.scale.setScalar(t.s);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.frustumCulled = false;
      this.owned.push(geo, mat, tex);
      this.group.add(im);
    } catch {
      /* no grass */
    }
  }

  dispose(): void {
    this.alive = false;
    for (const x of this.owned) x.dispose();
    this.owned = [];
  }
}
