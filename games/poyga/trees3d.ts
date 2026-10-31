import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { newGltfLoader, texUrl } from "@/engine/quality/assetUrl";
import type { QualityLevel } from "@/engine/types";
import { CURB_H, PITCH, plan, unwarp, warpX, warpZ } from "./city";
import { LOD, type Lod, effectiveLevel } from "./config";
import { type Precompile, disposeMaterial } from "./models";

/**
 * The city's trees from tools/blender/trees.py: the nearest ones as the real 3D models (trunk, branches, alpha leaf
 * cards), the rest as crossed billboards with the impostor rendered in Blender. One instanced mesh per variant and
 * part, so a thousand trees cost about a dozen draw calls. The lite level has no tree models at all (billboards only).
 */

type Species = "terak" | "chinor" | "kocha";
// poplars: tools/blender/trees.py; broad trees: Poly Haven's jacaranda_tree and tree_small_02 (CC0) via tools/blender/cc0_trees.py
const VARIANTS: Record<Species, string[]> = { terak: ["terak_0", "terak_1"], chinor: ["keng_0", "keng_1"], kocha: ["keng_1"] };
const ALL = ["terak_0", "terak_1", "keng_0", "keng_1"];

interface Variant {
  name: string;
  /** every mesh of the model (bark parts and the leaf cards) */
  parts: THREE.InstancedMesh[];
  imp: THREE.InstancedMesh;
  h: number;
  w: number;
}

interface TreeAt {
  x: number;
  z: number;
  v: number;
  rot: number;
  s: number;
  /** squared distance to the camera at the last sort */
  d: number;
}

export class TreeField {
  readonly group = new THREE.Group();
  private vars: Variant[] = [];
  /** the trees of every block gathered so far (a block is read from the plan once) */
  private blocks = new Map<string, TreeAt[]>();
  private trees: TreeAt[] = [];
  /** the block the list was made for (NaN: make it again) */
  private kx = NaN;
  private kz = NaN;
  private kr = 0;
  private timer = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private o = new THREE.Object3D();
  private owned: { dispose(): void }[] = [];
  private materials: THREE.Material[] = [];
  private alive = true;
  /** what was allocated (the build level) and what is used now (live) */
  private nearAlloc: number;
  private farAlloc: number;
  private lod: Lod;

  constructor(
    private gl: THREE.WebGLRenderer,
    private level: QualityLevel,
    private shadows: boolean,
    private precompile: Precompile,
  ) {
    this.lod = LOD[level];
    this.nearAlloc = this.lod.treeNear;
    this.farAlloc = this.lod.treeFar;
    for (const name of ALL) this.vars.push({ name, parts: [], imp: this.impostor(name), h: 15, w: 8 });
    if (this.nearAlloc > 0) void this.load();
  }

  /** The level to follow now (never above the build level): radius, caps, distance (from the next update). */
  setLevel(current: QualityLevel): void {
    const lod = LOD[effectiveLevel(this.level, current)];
    if (lod === this.lod) return;
    this.lod = lod;
    this.kx = NaN;
    this.lastX = NaN;
  }

  private impostor(name: string): THREE.InstancedMesh {
    // two crossed quads, base at y = 0, unit size (scaled per variant once the manifest is known)
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const g = mergeGeometries([a, b])!;
    a.dispose();
    b.dispose();
    const t = new THREE.TextureLoader().load(texUrl(`/textures/poyga/trees/imp_${name}`, this.level), (tex) => {
      if (this.alive) this.gl.initTexture(tex);
    });
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(this.gl.capabilities.getMaxAnisotropy(), this.lod.aniso);
    const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, envMapIntensity: 0.4 });
    const im = new THREE.InstancedMesh(g, m, this.farAlloc);
    im.count = 0;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.owned.push(g);
    this.materials.push(m);
    // shown once its shader is compiled (a compile in the middle of a frame is a stall)
    void this.show(im);
    return im;
  }

  private async show(o: THREE.Object3D): Promise<void> {
    await this.precompile(o);
    if (this.alive) this.group.add(o);
  }

  private async load(): Promise<void> {
    try {
      const man = (await (await fetch("/models/poyga/trees/trees.json")).json()) as Record<string, { h: number; w: number; leaf?: string }>;
      for (const v of this.vars) {
        if (man[v.name]) {
          v.h = man[v.name].h * 1.04;
          v.w = man[v.name].w;
        }
      }
      const loader = await newGltfLoader();
      for (const v of this.vars) {
        const gltf = await loader.loadAsync(`/models/poyga/trees/${v.name}.glb`);
        if (!this.alive) return;
        gltf.scene.updateMatrixWorld(true);
        // the leaf cards need the alpha of the standalone WebP (the GLB's own copy is not the one drawn)
        const leafFile = man[v.name]?.leaf;
        const leafTex = leafFile
          ? new THREE.TextureLoader().load(texUrl(`/textures/poyga/trees/${leafFile.replace(/\.\w+$/, "")}`, this.level), (tex) => {
              if (this.alive) this.gl.initTexture(tex);
            })
          : null;
        if (leafTex) {
          leafTex.colorSpace = THREE.SRGBColorSpace;
          this.owned.push(leafTex);
        }
        const made: THREE.InstancedMesh[] = [];
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          const mat = mesh.material as THREE.MeshStandardMaterial;
          const leaves = mat.name === "leaves";
          if (leaves) {
            if (leafTex) mat.map = leafTex;
            mat.alphaTest = 0.32;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.side = THREE.DoubleSide;
            mat.roughness = 0.85;
            mat.metalness = 0;
            mat.envMapIntensity = 0.5;
          } else {
            mat.metalness = 0;
            mat.transparent = false;
            mat.depthWrite = true;
          }
          const im = new THREE.InstancedMesh(geo, mat, this.nearAlloc);
          im.count = 0;
          im.frustumCulled = false;
          im.castShadow = this.shadows;
          im.receiveShadow = false;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.owned.push(geo);
          this.materials.push(mat);
          made.push(im);
        });
        // compile before the model is shown, one model per load so the work is spread out
        await Promise.all(made.map((im) => this.precompile(im)));
        if (!this.alive) return;
        for (const im of made) {
          v.parts.push(im);
          this.group.add(im);
        }
        this.timer = 0;
      }
      this.kx = NaN;
    } catch {
      /* the impostors still show */
    }
  }

  /** the trees of one block (read from the plan once) */
  private blockTrees(i: number, j: number): TreeAt[] {
    const k = `${i},${j}`;
    let list = this.blocks.get(k);
    if (!list) {
      list = [];
      for (const p of plan(i, j).posts) {
        if (p.kind !== "tree") continue;
        const sp: Species = p.sp ?? "chinor";
        const names = VARIANTS[sp];
        const vi = ALL.indexOf(names[Math.abs(p.seed | 0) % names.length]);
        const r = Math.abs(Math.sin(p.seed * 12.9898) * 43758.5453) % 1;
        list.push({ x: p.x, z: p.z, v: vi, rot: r * Math.PI * 2, s: 0.85 + 0.3 * ((r * 7.31) % 1), d: 0 });
      }
      this.blocks.set(k, list);
    }
    return list;
  }

  /** collect the trees of the blocks around (x, z); blocks not read yet wait for a later call when the time `until` is over. True when complete. */
  private gather(x: number, z: number, r: number, until: number): boolean {
    const bi = Math.floor(x / PITCH);
    const bj = Math.floor(z / PITCH);
    if (bi === this.kx && bj === this.kz && r === this.kr) return true;
    this.trees.length = 0;
    let missing = false;
    let read = 0;
    for (let i = bi - r; i <= bi + r; i++)
      for (let j = bj - r; j <= bj + r; j++) {
        if (!this.blocks.has(`${i},${j}`)) {
          // (at least one block per call, or a busy frame would never get anywhere)
          if (read > 0 && performance.now() >= until) {
            missing = true;
            continue;
          }
          read++;
        }
        for (const t of this.blockTrees(i, j)) this.trees.push(t);
      }
    if (missing) return false;
    this.kx = bi;
    this.kz = bj;
    this.kr = r;
    this.timer = 0;
    for (const k of this.blocks.keys()) {
      const [i, j] = k.split(",").map(Number);
      if (Math.abs(i - bi) > r + 2 || Math.abs(j - bj) > r + 2) this.blocks.delete(k);
    }
    return true;
  }

  /** camWX / camWZ: the camera in WORLD space; `until`: performance.now() time to stop reading blocks at */
  update(dt: number, camWX: number, camWZ: number, until: number): void {
    const [camX, camZ] = unwarp(camWX, camWZ);
    const lod = this.lod;
    const done = this.gather(camX, camZ, lod.treeR, until);
    this.timer -= dt;
    // re-sorted four times a second, and only when the camera has moved or the list changed
    if (this.timer > 0 || (done && Math.abs(camX - this.lastX) + Math.abs(camZ - this.lastZ) < 3)) return;
    this.timer = 0.25;
    this.lastX = camX;
    this.lastZ = camZ;
    const nearCap = Math.min(this.nearAlloc, lod.treeNear);
    const farCap = Math.min(this.farAlloc, lod.treeFar);
    const trees = this.trees;
    for (const t of trees) t.d = (t.x - camX) ** 2 + (t.z - camZ) ** 2;
    // (the order matters only for the nearest real models)
    if (nearCap > 0 && this.vars.some((v) => v.parts.length > 0)) trees.sort((a, b) => a.d - b.d);
    const nNear = [0, 0, 0, 0];
    const nFar = [0, 0, 0, 0];
    let near = 0;
    const o = this.o;
    const nd2 = lod.treeNearDist * lod.treeNearDist;
    for (const t of trees) {
      const v = this.vars[t.v];
      const full = v.parts.length > 0 && near < nearCap && t.d < nd2;
      o.position.set(warpX(t.x, t.z), CURB_H, warpZ(t.x, t.z));
      o.rotation.set(0, t.rot, 0);
      if (full) {
        o.scale.setScalar(t.s);
        o.updateMatrix();
        const i = nNear[t.v]++;
        for (const m of v.parts) m.setMatrixAt(i, o.matrix);
        near++;
      } else {
        const i = nFar[t.v];
        if (i >= farCap) continue;
        nFar[t.v]++;
        o.scale.set(v.w * t.s, v.h * t.s, v.w * t.s);
        o.position.y = CURB_H - 0.02 * v.h * t.s;
        o.updateMatrix();
        v.imp.setMatrixAt(i, o.matrix);
      }
    }
    this.vars.forEach((v, k) => {
      for (const m of v.parts) {
        m.count = nNear[k];
        m.instanceMatrix.needsUpdate = true;
      }
      v.imp.count = nFar[k];
      v.imp.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    this.alive = false;
    for (const v of this.vars) {
      for (const m of v.parts) m.dispose();
      v.imp.dispose();
    }
    for (const x of this.owned) x.dispose();
    for (const m of this.materials) disposeMaterial(m);
  }
}

