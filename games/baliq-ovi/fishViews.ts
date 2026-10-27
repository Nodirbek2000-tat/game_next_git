// Pool of fish meshes (one dynamic geometry each, shared per-species materials) plus the junk items.

import * as THREE from "three";
import { FISH_VERTS, fishPositions, makeBootGeometry, makeBottleGeometry, makeFishGeometry, swimBend } from "./fishGeometry";
import { SPECIES, type SpeciesDef } from "./species";
import { makeFishSkin } from "./textures";
import { applyUnderwaterTint, L_UNDER, L_WORLD, type TintUniforms } from "./water";

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

  /** `count` fish meshes; `items` boot and bottle meshes each. */
  constructor(count: number, items: number, readonly group: THREE.Group, private tint: TintUniforms) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(makeFishGeometry(), new THREE.MeshStandardMaterial());
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
    }
    return idx;
  }

  /** Make mesh `i` a fish of the species (copies the rest pose, recomputes normals). */
  setSpecies(i: number, sp: SpeciesDef): void {
    const idx = this.ensure(sp);
    if (this.cur[i] === idx) return;
    this.cur[i] = idx;
    const m = this.meshes[i];
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
    swimBend(this.base[idx]!, pos.array as Float32Array, sp.len, phase, amp);
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
    for (const t of this.tex) t.dispose();
    for (const m of this.mats) m?.dispose();
    for (const m of this.itemMats) m.dispose();
    for (const g of this.itemGeos) g.dispose();
  }
}
