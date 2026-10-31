// The shore's real vegetation: firs (Poly Haven fir_tree_01, CC0, via tools/blender/fir_trees.py) and grass patches
// (grass_medium_01 via tools/blender/baliq_props.py). The camera hardly moves, so every tree is decided once: the
// nearest ones are full 3D models (bark + needle cards), the rest are single billboards of an impostor rendered in
// Blender, turned to face the camera. One instanced mesh per variant and part (~12 draw calls for ~500 trees).
//
// Built detached (`group` is not in the scene): the rig compiles its shaders in the background and attaches it when
// `onReady` fires, so nothing stalls the first frames. The level can change at any time (`setLevel`): the models, the
// billboards and the grass are cut by instance count only, nothing is rebuilt.

import * as THREE from "three";
import { disposeTree } from "@/engine";
import { newGltfLoader, texUrl } from "@/engine/quality/assetUrl";
import type { QualityLevel } from "@/engine/types";
import { effectiveLevel, liveShare, LOD } from "./lod";
import { L_NOREFL } from "./water";
import type { Spot } from "./world";

const TREES = ["fir_0", "fir_1", "fir_2"];
// the big dense fir most often, the sparse young one rarely
const PICK = [0.5, 0.85, 1];

type Manifest = Record<string, { h: number; w: number; leaf?: string }>;

interface Variant {
  /** distance from the eye of the shore trees that have a model, nearest first (the model meshes hold them in this order) */
  dist: number[];
  models: THREE.InstancedMesh[];
  /** every shore tree as a billboard, farthest first: the nearest `n` are dropped while their model is shown */
  shore: THREE.InstancedMesh | null;
  shoreN: number;
  /** the forest behind the far shore, random order (live: a prefix) */
  hill: THREE.InstancedMesh | null;
  hillN: number;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class Scenery {
  readonly group = new THREE.Group();
  private alive = true;
  private variants: Variant[] = [];
  private grassMesh: THREE.InstancedMesh | null = null;
  private cur: QualityLevel;
  /** called once everything is built (the group is still detached) */
  onReady: (() => void) | null = null;
  /** the manifest or the billboards could not be loaded (the procedural cones should show) */
  onFail: (() => void) | null = null;

  constructor(
    private trees: Spot[],
    private grass: Spot[],
    private cam: THREE.Vector3,
    private sway: (m: THREE.Material, amp: number) => void,
    private built: QualityLevel,
  ) {
    this.group.name = "scenery";
    this.cur = built;
  }

  private variant(k: number): number {
    return PICK.findIndex((p) => k <= p);
  }

  /** Load and build (async, in small steps). */
  start(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const radius = LOD[this.built].modelRadius;
    let man: Manifest;
    try {
      man = (await (await fetch("/models/baliq-ovi/trees/trees.json")).json()) as Manifest;
    } catch {
      if (this.alive) this.onFail?.();
      return;
    }
    const o = new THREE.Object3D();
    const texL = new THREE.TextureLoader();
    // spots per variant: shore trees nearest first, hill trees as they come
    const shore: Spot[][] = TREES.map(() => []);
    const hill: Spot[][] = TREES.map(() => []);
    const dOf = new Map<Spot, number>();
    for (const t of this.trees) {
      const v = this.variant(t.k);
      if (t.hill) hill[v].push(t);
      else {
        dOf.set(t, Math.hypot(t.x - this.cam.x, t.z - this.cam.z));
        shore[v].push(t);
      }
    }
    for (const list of shore) list.sort((a, b) => dOf.get(a)! - dOf.get(b)!);
    let loader: Awaited<ReturnType<typeof newGltfLoader>> | null = null;
    try {
      if (radius > 0) loader = await newGltfLoader();
    } catch {
      /* billboards only */
    }
    for (let v = 0; v < TREES.length; v++) {
      if (!this.alive) return;
      await tick();
      const name = TREES[v];
      const m = man[name];
      const rec: Variant = { dist: [], models: [], shore: null, shoreN: shore[v].length, hill: null, hillN: hill[v].length };
      this.variants.push(rec);
      if (!m) continue;
      // ---- billboards: one camera-facing quad per tree; its normal points up so the light on it is the light on a crown
      if (shore[v].length || hill[v].length) {
        const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
        const n = g.getAttribute("normal");
        for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
        const tex = texL.load(texUrl(`/textures/baliq-ovi/trees/imp_${name}`, this.built));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(4, LOD[this.built].aniso);
        // Lambert: no specular sheen of the (bright, low) sky on the flat quad
        const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xf2f2ea, alphaTest: 0.42, side: THREE.DoubleSide });
        const place = (list: Spot[], reverse: boolean): THREE.InstancedMesh => {
          const im = new THREE.InstancedMesh(g, mat, list.length);
          for (let i = 0; i < list.length; i++) {
            const t = list[reverse ? list.length - 1 - i : i];
            o.position.set(t.x, t.y - 0.02 * m.h * t.s, t.z);
            o.rotation.set(0, Math.atan2(this.cam.x - t.x, this.cam.z - t.z), 0);
            o.scale.set(m.w * t.s, m.h * t.s, 1);
            o.updateMatrix();
            im.setMatrixAt(i, o.matrix);
          }
          im.frustumCulled = false;
          this.group.add(im);
          return im;
        };
        if (shore[v].length) rec.shore = place(shore[v], true);
        if (hill[v].length) rec.hill = place(hill[v], false);
      }
      // ---- near: the model, only for the trees within the built level's radius
      const near = shore[v].filter((t) => dOf.get(t)! < radius);
      if (!loader || !near.length) continue;
      try {
        const gltf = await loader.loadAsync(`/models/baliq-ovi/trees/${name}.glb`);
        if (!this.alive) return;
        gltf.scene.updateMatrixWorld(true);
        const leafTex = m.leaf ? texL.load(texUrl(`/textures/baliq-ovi/trees/${m.leaf.replace(/\.\w+$/, "")}`, this.built)) : null;
        if (leafTex) leafTex.colorSpace = THREE.SRGBColorSpace;
        gltf.scene.traverse((ob) => {
          const mesh = ob as THREE.Mesh;
          if (!mesh.isMesh) return;
          const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mat.metalness = 0;
          mat.transparent = false;
          mat.depthWrite = true;
          if (mat.name === "leaves") {
            if (leafTex) {
              mat.map?.dispose();
              mat.map = leafTex;
            }
            mat.alphaTest = 0.38;
            mat.side = THREE.DoubleSide;
            mat.roughness = 0.9;
            mat.envMapIntensity = 0.5;
          }
          const im = new THREE.InstancedMesh(geo, mat, near.length);
          near.forEach((t, i) => {
            o.position.set(t.x, t.y, t.z);
            o.rotation.set(0, t.rot, 0);
            o.scale.setScalar(t.s);
            o.updateMatrix();
            im.setMatrixAt(i, o.matrix);
          });
          im.frustumCulled = false;
          // not mirrored in the water: the reflection is a blur of the far shore, and the models are the costly part
          im.layers.set(L_NOREFL);
          rec.models.push(im);
          this.group.add(im);
        });
        rec.dist = near.map((t) => dOf.get(t)!);
      } catch {
        /* this variant keeps its billboards for every tree */
      }
    }
    if (this.grass.length) {
      await tick();
      await this.loadGrass();
    }
    if (!this.alive) return;
    if (!this.variants.some((v) => v.shore || v.hill)) {
      this.onFail?.();
      return;
    }
    this.setLevel(this.cur);
    this.onReady?.();
  }

  private async loadGrass(): Promise<void> {
    try {
      const gltf = await (await newGltfLoader()).loadAsync("/models/baliq-ovi/grass.glb");
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
      // the GLB's image has no alpha: the RGBA version (diff + Poly Haven's alpha map) is next to it
      const tex = new THREE.TextureLoader().load(texUrl("/textures/baliq-ovi/grass_rgba", this.built));
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map?.dispose();
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
      im.layers.set(L_NOREFL);
      this.grassMesh = im;
      this.group.add(im);
    } catch {
      /* no grass */
    }
  }

  /** The level changed (also called once after the build): cut or restore the instance counts. */
  setLevel(now: QualityLevel): void {
    this.cur = now;
    const eff = effectiveLevel(this.built, now);
    const radius = LOD[eff].modelRadius;
    for (const v of this.variants) {
      let n = 0;
      while (n < v.dist.length && v.dist[n] < radius) n++;
      for (const m of v.models) {
        m.count = n;
        m.visible = n > 0;
      }
      if (v.shore) v.shore.count = v.shoreN - n;
      if (v.hill) {
        v.hill.count = Math.ceil(v.hillN * liveShare("hillTrees", this.built, eff));
        v.hill.visible = v.hill.count > 0;
      }
    }
    if (this.grassMesh) {
      this.grassMesh.count = Math.ceil(this.grass.length * liveShare("grass", this.built, eff));
      this.grassMesh.visible = this.grassMesh.count > 0;
    }
  }

  dispose(): void {
    this.alive = false;
    // detached or not, free the textures / geometries / materials of everything built
    disposeTree(this.group);
    this.group.clear();
  }
}
