// Pool of fish meshes (one dynamic geometry each, shared per-species materials) plus the junk items.

import * as THREE from "three";
import { FISH_VERTS, fishPositions, makeBootGeometry, makeBottleGeometry, makeFishGeometry, swimBend } from "./fishGeometry";
import { SPECIES, type SpeciesDef } from "./species";
import { makeFishSkin } from "./textures";
import { applyUnderwaterTint, L_UNDER, L_WORLD, type TintUniforms } from "./water";

interface FishModel {
  base: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array | Uint32Array;
  mat: THREE.MeshStandardMaterial;
}

let gltfLoader: Promise<InstanceType<typeof import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader>> | null = null;

export class FishViews {
  readonly meshes: THREE.Mesh[] = [];
  readonly boots: THREE.Mesh[] = [];
  readonly bottles: THREE.Mesh[] = [];
  private base: (Float32Array | null)[] = [];
  private mats: (THREE.MeshStandardMaterial | null)[] = [];
  private cur: number[] = [];
  private tex: THREE.Texture[] = [];
  private itemMats: THREE.Material[] = [];
  private itemGeos: THREE.BufferGeometry[] = [];
  /** Blender models (tools/blender/baliq_fish.py) per species index, once loaded */
  private models: (FishModel | null)[] = [];
  private loading = new Set<number>();
  /** the procedural geometry of each pooled mesh (kept while a model geometry is shown) */
  private procGeo: THREE.BufferGeometry[] = [];
  private alive = true;

  /** `count` fish meshes; `items` boot and bottle meshes each. */
  constructor(count: number, items: number, readonly group: THREE.Group, private tint: TintUniforms) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(makeFishGeometry(), new THREE.MeshStandardMaterial());
      this.procGeo.push(m.geometry);
      m.frustumCulled = false;
      m.visible = false;
      m.layers.set(L_UNDER);
      this.meshes.push(m);
      this.cur.push(-1);
      group.add(m);
    }
    const itemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    const bottleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    applyUnderwaterTint(itemMat, tint);
    applyUnderwaterTint(bottleMat, tint);
    this.itemMats.push(itemMat, bottleMat);
    const bootGeo = makeBootGeometry();
    const bottleGeo = makeBottleGeometry();
    this.itemGeos.push(bootGeo, bottleGeo);
    for (let i = 0; i < items; i++) {
      const b = new THREE.Mesh(bootGeo, itemMat);
      const g = new THREE.Mesh(bottleGeo, bottleMat);
      for (const o of [b, g]) {
        o.visible = false;
        o.layers.set(L_UNDER);
        o.frustumCulled = false;
        group.add(o);
      }
      this.boots.push(b);
      this.bottles.push(g);
    }
    // the shared item geometries / materials are disposed by us, not by the engine's disposeTree
    bootGeo.userData.keep = true;
    bottleGeo.userData.keep = true;
    itemMat.userData.keep = true;
    bottleMat.userData.keep = true;
  }

  private ensure(sp: SpeciesDef): number {
    const idx = SPECIES.indexOf(sp);
    if (!this.base[idx]) {
      const b = new Float32Array(FISH_VERTS * 3);
      fishPositions(sp, b);
      this.base[idx] = b;
      const tex = makeFishSkin(sp);
      this.tex.push(tex);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.1, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.4 });
      applyUnderwaterTint(mat, this.tint);
      mat.userData.keep = true;
      tex.userData.keep = true;
      this.mats[idx] = mat;
      void this.loadModel(sp, idx);
    }
    return idx;
  }

  private async loadModel(sp: SpeciesDef, idx: number): Promise<void> {
    if (sp.junk || this.loading.has(idx)) return;
    this.loading.add(idx);
    try {
      gltfLoader ??= import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) => new GLTFLoader());
      const g = await (await gltfLoader).loadAsync(`/models/baliq-ovi/fish/${sp.id}.glb`);
      if (!this.alive) return;
      let mesh: THREE.Mesh | null = null;
      g.scene.traverse((o) => {
        if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
      });
      if (!mesh) return;
      const src = mesh as THREE.Mesh;
      const geo = src.geometry;
      const mat = src.material as THREE.MeshStandardMaterial;
      // one material: skin, fins (alpha: ragged translucent edges) and eyes in one atlas
      mat.alphaTest = 0.35;
      // exported as a blended material: make it an alpha-tested opaque one (it must write depth)
      mat.transparent = false;
      mat.depthWrite = true;
      mat.blending = THREE.NormalBlending;
      mat.side = THREE.DoubleSide;
      mat.roughness = 0.34;
      mat.metalness = 0.12;
      mat.envMapIntensity = 0.9;
      applyUnderwaterTint(mat, this.tint);
      mat.userData.keep = true;
      this.models[idx] = {
        base: new Float32Array(geo.getAttribute("position").array),
        normal: new Float32Array(geo.getAttribute("normal").array),
        uv: new Float32Array(geo.getAttribute("uv").array),
        index: geo.index!.array as Uint16Array,
        mat,
      };
      // fish already showing this species switch to the model
      this.meshes.forEach((m, i) => {
        if (this.cur[i] === idx) {
          this.cur[i] = -1;
          this.setSpecies(i, sp);
        }
      });
    } catch {
      /* the procedural fish stays */
    }
  }

  /** Make mesh `i` a fish of the species (copies the rest pose, recomputes normals). */
  setSpecies(i: number, sp: SpeciesDef): void {
    const idx = this.ensure(sp);
    if (this.cur[i] === idx) return;
    this.cur[i] = idx;
    const m = this.meshes[i];
    const model = this.models[idx];
    if (m.geometry !== this.procGeo[i]) m.geometry.dispose();
    if (model) {
      // its own copy: the swim bend writes into the positions
      const g = new THREE.BufferGeometry();
      const p = new THREE.BufferAttribute(model.base.slice(), 3);
      p.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("position", p);
      g.setAttribute("normal", new THREE.BufferAttribute(model.normal.slice(), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(model.uv.slice(), 2));
      g.setIndex(new THREE.BufferAttribute(model.index.slice(), 1));
      m.geometry = g;
      m.material = model.mat;
      return;
    }
    m.geometry = this.procGeo[i];
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    (pos.array as Float32Array).set(this.base[idx]!);
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.material = this.mats[idx]!;
  }

  /** Bend the body: phase from the swim clock, amp 0..1. */
  animate(i: number, sp: SpeciesDef, phase: number, amp: number): void {
    const idx = this.cur[i];
    if (idx < 0) return;
    const m = this.meshes[i];
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    swimBend(this.models[idx]?.base ?? this.base[idx]!, pos.array as Float32Array, sp.len, phase, amp);
    pos.needsUpdate = true;
  }

  /** Build every species material now so shaders compile before the countdown. */
  prepareAll(list: SpeciesDef[]): void {
    for (const s of list) if (!s.junk) this.ensure(s);
  }

  /** Make a mesh draw in the main pass (above water) or in the underwater layer. */
  static setAbove(m: THREE.Mesh, above: boolean): void {
    m.layers.set(above ? L_WORLD : L_UNDER);
    if (above) m.layers.enable(3);
  }

  dispose(): void {
    this.alive = false;
    for (const md of this.models) {
      md?.mat.map?.dispose();
      md?.mat.normalMap?.dispose();
      md?.mat.dispose();
    }
    for (const t of this.tex) t.dispose();
    for (const m of this.mats) m?.dispose();
    for (const m of this.itemMats) m.dispose();
    for (const g of this.itemGeos) g.dispose();
  }
}
