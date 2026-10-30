import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CURB_H, PITCH, type Post, plan, unwarp, warpX, warpZ } from "./city";

/**
 * The city's trees from tools/blender/trees.py: the nearest ones as the real 3D models (trunk, branches, alpha leaf
 * cards), the rest as crossed billboards with the impostor rendered in Blender. One instanced mesh per variant and
 * part, so a thousand trees cost about a dozen draw calls.
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
}

export class TreeField {
  readonly group = new THREE.Group();
  private vars: Variant[] = [];
  private trees: TreeAt[] = [];
  private key = "";
  private timer = 0;
  private o = new THREE.Object3D();
  private owned: { dispose(): void }[] = [];
  private alive = true;

  constructor(
    private nearCap: number,
    private farCap: number,
    private nearDist: number,
    private shadows: boolean,
  ) {
    for (const name of ALL) {
      const v: Variant = { name, parts: [], imp: this.impostor(name), h: 15, w: 8 };
      this.vars.push(v);
      this.group.add(v.imp);
    }
    void this.load();
  }

  private impostor(name: string): THREE.InstancedMesh {
    // two crossed quads, base at y = 0, unit size (scaled per variant once the manifest is known)
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const g = mergeGeometries([a, b])!;
    a.dispose();
    b.dispose();
    const t = new THREE.TextureLoader().load(`/textures/poyga/trees/imp_${name}.png`);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, envMapIntensity: 0.4 });
    const im = new THREE.InstancedMesh(g, m, this.farCap);
    im.count = 0;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.owned.push(g, m, t);
    return im;
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
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      for (const v of this.vars) {
        const gltf = await loader.loadAsync(`/models/poyga/trees/${v.name}.glb`);
        if (!this.alive) return;
        gltf.scene.updateMatrixWorld(true);
        // the leaf cards need the alpha of the PNG (the GLB carries a JPEG)
        const leafPng = man[v.name]?.leaf;
        const leafTex = leafPng ? new THREE.TextureLoader().load(`/textures/poyga/trees/${leafPng}`) : null;
        if (leafTex) {
          leafTex.colorSpace = THREE.SRGBColorSpace;
          this.owned.push(leafTex);
        }
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
          const im = new THREE.InstancedMesh(geo, mat, this.nearCap);
          im.count = 0;
          im.frustumCulled = false;
          im.castShadow = this.shadows;
          im.receiveShadow = false;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.owned.push(geo, mat);
          v.parts.push(im);
          this.group.add(im);
        });
      }
      this.key = "";
    } catch {
      /* the impostors still show */
    }
  }

  /** collect the trees of the blocks around (x, z) (radius r blocks) */
  private gather(x: number, z: number, r: number): void {
    const bi = Math.floor(x / PITCH);
    const bj = Math.floor(z / PITCH);
    const key = `${bi},${bj}`;
    if (key === this.key) return;
    this.key = key;
    this.trees = [];
    for (let i = bi - r; i <= bi + r; i++)
      for (let j = bj - r; j <= bj + r; j++)
        for (const p of plan(i, j).posts as Post[]) {
          if (p.kind !== "tree") continue;
          const sp: Species = p.sp ?? "chinor";
          const list = VARIANTS[sp];
          const vi = ALL.indexOf(list[Math.abs(p.seed | 0) % list.length]);
          const k = Math.abs(Math.sin(p.seed * 12.9898) * 43758.5453) % 1;
          this.trees.push({ x: p.x, z: p.z, v: vi, rot: k * Math.PI * 2, s: 0.85 + 0.3 * ((k * 7.31) % 1) });
        }
  }

  /** camX / camZ: the camera in WORLD space */
  update(dt: number, camWX: number, camWZ: number, radius: number): void {
    const [camX, camZ] = unwarp(camWX, camWZ);
    this.gather(camX, camZ, radius);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const d2 = (t: TreeAt) => (t.x - camX) ** 2 + (t.z - camZ) ** 2;
    const sorted = this.trees.map((t) => [d2(t), t] as [number, TreeAt]).sort((a, b) => a[0] - b[0]);
    const nNear = new Array(this.vars.length).fill(0);
    const nFar = new Array(this.vars.length).fill(0);
    let near = 0;
    const o = this.o;
    for (const [dd, t] of sorted) {
      const v = this.vars[t.v];
      const full = v.parts.length > 0 && near < this.nearCap && dd < this.nearDist * this.nearDist;
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
        if (i >= this.farCap) continue;
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
  }
}
