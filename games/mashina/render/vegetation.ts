import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { newGltfLoader, texUrl } from "@/engine/quality/assetUrl";
import type { QualityLevel } from "@/engine/types";
import { disposeMaterial, type Precompile } from "@/games/poyga/models";
import type { PropKind, PropPlace, TreePlace } from "../world/tileBuilder";
import { LOD, effectiveLevel, type Lod } from "./lod";

/**
 * Trees and street furniture of the loaded tiles, drawn as instanced models. The model files are the ones of Shahar
 * simulyatori (/models/poyga/trees, /props; the same URLs, so the browser cache is shared); nothing new is shipped.
 *  - trees: the nearest ones as the real 3D models (trunk, branches, alpha leaf cards), the rest as crossed billboards with the
 *    impostor picture; one instanced mesh per variant and part, so a few hundred trees cost about a dozen draw calls. The lite
 *    level fetches no tree model at all (billboards only: ~200 kB).
 *  - props: benches, hydrants, utility boxes, planters, shrubs (medium and high only), laid out once per change of the tile set.
 * Models arrive one per step and their shaders are compiled before they are shown (no stall in a frame).
 */

/** What the layer reads from a loaded tile. */
export interface TileSource {
  trees: readonly TreePlace[];
  props: readonly PropPlace[];
  /** 0 = near (detail drawn), 1 = far */
  lod: 0 | 1;
}

const TREE_NAMES = ["terak_0", "terak_1", "keng_0", "keng_1"] as const;
/** which variant a tree place (v 0..1) gets: poplars for a third of them, broad trees for the rest */
const variantOf = (v: number): number => (v < 0.3 ? (v < 0.15 ? 0 : 1) : v < 0.65 ? 2 : 3);

interface Variant {
  name: string;
  parts: THREE.InstancedMesh[];
  imp: THREE.InstancedMesh;
  h: number;
  w: number;
}

interface TreeRec {
  x: number;
  z: number;
  v: number;
  rot: number;
  s: number;
  /** squared distance to the camera at the last sort */
  d: number;
}

/** the leaf pictures are dark greens: a little extra albedo keeps them green under the district's lights */
const LEAF_LIGHT = new THREE.Color(1.35, 1.35, 1.35);

const hash = (x: number, z: number): number => {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

export class TreeLayer {
  readonly group = new THREE.Group();
  private vars: Variant[] = [];
  private recs: TreeRec[] = [];
  private nRecs = 0;
  private timer = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private lastVersion = -1;
  private o = new THREE.Object3D();
  private owned: { dispose(): void }[] = [];
  private materials: THREE.Material[] = [];
  private alive = true;
  private lod: Lod;
  private readonly nearAlloc: number;
  private readonly farAlloc: number;
  private nNear = [0, 0, 0, 0];
  private nFar = [0, 0, 0, 0];
  /** billboards are drawn out to this distance (m): the haze end, set by the game */
  reach = 400;

  constructor(
    private gl: THREE.WebGLRenderer,
    private level: QualityLevel,
    private precompile: Precompile,
  ) {
    this.lod = LOD[level];
    this.nearAlloc = this.lod.treeNear;
    this.farAlloc = this.lod.treeFar;
    for (const name of TREE_NAMES) this.vars.push({ name, parts: [], imp: this.impostor(name), h: 15, w: 8 });
    if (this.nearAlloc > 0) void this.load();
  }

  /** The level to follow now (never above the build level): caps and distances, from the next update. */
  setLevel(current: QualityLevel): void {
    const lod = LOD[effectiveLevel(this.level, current)];
    if (lod === this.lod) return;
    this.lod = lod;
    this.lastVersion = -1;
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
    const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: LEAF_LIGHT });
    const im = new THREE.InstancedMesh(g, m, this.farAlloc);
    im.count = 0;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.owned.push(g, t);
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
          if (mat.name === "leaves") {
            if (leafTex) mat.map = leafTex;
            mat.alphaTest = 0.32;
            mat.transparent = false;
            mat.depthWrite = true;
            mat.side = THREE.DoubleSide;
            mat.roughness = 0.85;
            mat.metalness = 0;
            mat.color.copy(LEAF_LIGHT);
          } else {
            mat.metalness = 0;
            mat.transparent = false;
            mat.depthWrite = true;
          }
          const im = new THREE.InstancedMesh(geo, mat, this.nearAlloc);
          im.count = 0;
          im.frustumCulled = false;
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
        this.lastVersion = -1;
      }
    } catch {
      /* the impostors still show */
    }
  }

  /** collect the trees of the loaded tiles into the (reused) record pool */
  private collect(tiles: ReadonlyMap<string, TileSource>): void {
    let n = 0;
    for (const t of tiles.values()) {
      for (const p of t.trees) {
        let r = this.recs[n];
        if (!r) r = this.recs[n] = { x: 0, z: 0, v: 0, rot: 0, s: 1, d: 0 };
        const h = hash(p.x, p.z);
        r.x = p.x;
        r.z = p.z;
        r.v = variantOf(p.v);
        r.rot = h * Math.PI * 2;
        r.s = p.s * (0.85 + 0.3 * ((h * 7.31) % 1));
        n++;
      }
    }
    this.recs.length = n;
    this.nRecs = n;
  }

  /** `version` changes whenever the set of loaded tiles does; the list is re-sorted four times a second at most, and only when the camera moved. */
  update(dt: number, camX: number, camZ: number, tiles: ReadonlyMap<string, TileSource>, version: number): void {
    const changed = version !== this.lastVersion;
    this.timer -= dt;
    if (!changed && (this.timer > 0 || Math.abs(camX - this.lastX) + Math.abs(camZ - this.lastZ) < 3)) return;
    this.timer = 0.25;
    this.lastX = camX;
    this.lastZ = camZ;
    if (changed) {
      this.lastVersion = version;
      this.collect(tiles);
    }
    const lod = this.lod;
    const nearCap = Math.min(this.nearAlloc, lod.treeNear);
    const farCap = Math.min(this.farAlloc, lod.treeFar);
    const recs = this.recs;
    const n = this.nRecs;
    for (let i = 0; i < n; i++) {
      const t = recs[i];
      t.d = (t.x - camX) ** 2 + (t.z - camZ) ** 2;
    }
    const haveNear = nearCap > 0 && this.vars.some((v) => v.parts.length > 0);
    // (the order matters only for the nearest real models)
    if (haveNear) recs.sort((a, b) => a.d - b.d);
    this.nNear.fill(0);
    this.nFar.fill(0);
    let near = 0;
    const o = this.o;
    const nd2 = lod.treeNearDist * lod.treeNearDist;
    const far2 = this.reach * this.reach;
    for (let i = 0; i < n; i++) {
      const t = recs[i];
      const v = this.vars[t.v];
      const full = haveNear && v.parts.length > 0 && near < nearCap && t.d < nd2;
      o.position.set(t.x, 0, t.z);
      o.rotation.set(0, t.rot, 0);
      if (full) {
        o.scale.setScalar(t.s);
        o.updateMatrix();
        const k = this.nNear[t.v]++;
        for (const m of v.parts) m.setMatrixAt(k, o.matrix);
        near++;
      } else {
        if (t.d > far2) continue;
        const k = this.nFar[t.v];
        if (k >= farCap) continue;
        this.nFar[t.v]++;
        o.scale.set(v.w * t.s, v.h * t.s, v.w * t.s);
        o.position.y = -0.02 * v.h * t.s;
        o.updateMatrix();
        v.imp.setMatrixAt(k, o.matrix);
      }
    }
    this.vars.forEach((v, k) => {
      for (const m of v.parts) {
        m.count = this.nNear[k];
        m.instanceMatrix.needsUpdate = true;
      }
      v.imp.count = this.nFar[k];
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

// ---------------------------------------------------------------------------------------------------- street furniture

const PROP_FILE: Record<PropKind, string> = {
  bench: "painted_wooden_bench",
  hydrant: "fire_hydrant",
  box: "utility_box_01",
  planter: "planter_box_01",
  shrub: "shrub_01",
};
const PROP_CAP: Record<PropKind, number> = { bench: 60, hydrant: 50, box: 50, planter: 12, shrub: 80 };
const PROP_KINDS = Object.keys(PROP_FILE) as PropKind[];

export class PropLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<PropKind, THREE.InstancedMesh[]>();
  private owned: { dispose(): void }[] = [];
  private materials: THREE.Material[] = [];
  private alive = true;
  private lastVersion = -1;
  private o = new THREE.Object3D();
  private counts: Record<PropKind, number> = { bench: 0, hydrant: 0, box: 0, planter: 0, shrub: 0 };
  private on = true;

  constructor(private precompile: Precompile) {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const loader = await newGltfLoader();
      for (const kind of PROP_KINDS) {
        const g = await loader.loadAsync(`/models/poyga/props/${PROP_FILE[kind]}.glb`);
        if (!this.alive) return;
        g.scene.updateMatrixWorld(true);
        const list: THREE.InstancedMesh[] = [];
        g.scene.traverse((ob) => {
          const mesh = ob as THREE.Mesh;
          if (!mesh.isMesh) return;
          const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (kind === "shrub") {
            mat.alphaTest = 0.5;
            mat.transparent = false;
            mat.side = THREE.DoubleSide;
          }
          const im = new THREE.InstancedMesh(geo, mat, PROP_CAP[kind]);
          im.count = 0;
          im.frustumCulled = false;
          this.owned.push(geo);
          this.materials.push(mat);
          list.push(im);
        });
        // compile before the prop is shown: one model per load, so the compiles are spread out too
        await Promise.all(list.map((im) => this.precompile(im)));
        if (!this.alive) return;
        for (const im of list) this.group.add(im);
        this.meshes.set(kind, list);
        this.lastVersion = -1;
      }
    } catch {
      /* a missing prop is skipped */
    }
  }

  /** the furniture follows the near tiles; `on` false (the level has none) hides the layer */
  update(tiles: ReadonlyMap<string, TileSource>, version: number, on: boolean): void {
    this.group.visible = on;
    if (on !== this.on) {
      this.on = on;
      this.lastVersion = -1;
    }
    if (!on || version === this.lastVersion || this.meshes.size === 0) return;
    this.lastVersion = version;
    this.counts.bench = this.counts.hydrant = this.counts.box = this.counts.planter = this.counts.shrub = 0;
    const o = this.o;
    for (const t of tiles.values()) {
      if (t.lod !== 0) continue;
      for (const p of t.props) {
        const list = this.meshes.get(p.kind);
        const k = this.counts[p.kind];
        if (!list || k >= PROP_CAP[p.kind]) continue;
        this.counts[p.kind] = k + 1;
        o.position.set(p.x, 0, p.z);
        o.rotation.set(0, p.rot, 0);
        o.scale.setScalar(p.s);
        o.updateMatrix();
        for (const im of list) im.setMatrixAt(k, o.matrix);
      }
    }
    for (const [kind, list] of this.meshes)
      for (const im of list) {
        im.count = this.counts[kind];
        im.instanceMatrix.needsUpdate = true;
      }
  }

  dispose(): void {
    this.alive = false;
    for (const list of this.meshes.values()) for (const im of list) im.dispose();
    for (const x of this.owned) x.dispose();
    for (const m of this.materials) disposeMaterial(m);
  }
}
