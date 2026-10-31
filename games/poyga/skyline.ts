import * as THREE from "three";
import { newGltfLoader, texUrl } from "@/engine/quality/assetUrl";
import type { QualityLevel } from "@/engine/types";
import { CURB_H, ihash, PITCH, blockKind, plan, type TowerModel, unwarp, WALK, warpX, warpZ } from "./city";
import { LOD } from "./config";
import { disposeMaterial, warmTriangle } from "./models";

/**
 * The skyline: Blender towers (tools/blender/buildings.py) placed where the city plan says, and the far city: every 3 x 3
 * blocks one merged mesh of plain facade-textured boxes (the blocks' buildings) so the city reaches the horizon instead of
 * ending at the edge of the detailed tiles. The lite level loads no tower models: the towers are plain boxes in the far
 * city. Everything is built from a queue a little per frame (`work`), nearest first.
 */

const SUPER = 3;
/** heights (m) of the tower models, for the plain-box stand-ins */
const TOWER_H: Record<TowerModel, number> = { deco: 440, burama: 560, pogona: 367, ochqich: 490, minora: 372, ofis_0: 155, ofis_1: 205, ofis_2: 137 };

interface Job {
  far: boolean;
  /** tower: block; far: chunk */
  i: number;
  j: number;
  /** blocks from the car */
  d: number;
  /** a far chunk being built block by block (kept when the job list is made again) */
  gen?: Generator<void, THREE.BufferGeometry>;
}

export class Skyline {
  readonly group = new THREE.Group();
  private models = new Map<TowerModel, Promise<THREE.Object3D | null>>();
  private placed = new Map<string, THREE.Group>();
  private far = new Map<string, THREE.Mesh>();
  private farMat: THREE.MeshStandardMaterial;
  private jobs: Job[] = [];
  private warmGeo = warmTriangle();
  /** the block the lists were made for (NaN: make them again) */
  private kx = NaN;
  private kz = NaN;
  private alive = true;
  private p: [number, number] = [0, 0];
  private farR: number;
  private towerR: number;

  constructor(
    gl: THREE.WebGLRenderer,
    level: QualityLevel,
    private precompile: (o: THREE.Object3D) => Promise<void>,
  ) {
    const lod = LOD[level];
    this.farR = lod.farR;
    this.towerR = lod.towerR;
    const t = new THREE.TextureLoader().load(texUrl("/textures/poyga/facades/facade_flats", level), (tex) => {
      if (this.alive) gl.initTexture(tex);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), lod.aniso);
    this.farMat = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.8, envMapIntensity: 0.4 });
    // hidden, only so the engine's start-up shader precompile sees the far-city material
    const warm = new THREE.Mesh(this.warmGeo, this.farMat);
    warm.visible = false;
    this.group.add(warm);
  }

  get chunks(): number {
    return this.far.size;
  }

  /** towers (blocks) and far chunks around the car (from the next `update`); the box stand-ins follow `towerR === 0` */
  setLod(farR: number, towerR: number): void {
    if (farR === this.farR && towerR === this.towerR) return;
    if ((towerR === 0) !== (this.towerR === 0)) {
      // the far chunks differ (box towers or not): build them again
      this.clearFar();
      this.jobs.length = 0;
    }
    this.farR = farR;
    this.towerR = towerR;
    this.kx = NaN;
  }

  private model(m: TowerModel): Promise<THREE.Object3D | null> {
    let p = this.models.get(m);
    if (!p) {
      p = (async () => {
        try {
          const g = await (await newGltfLoader()).loadAsync(`/models/poyga/buildings/${m}.glb`);
          g.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mat = mesh.material as THREE.MeshStandardMaterial;
            // glass reflects the sky; stone / concrete stay matte
            if (mat.name === "glass") {
              mat.metalness = 0.92;
              mat.roughness = 0.05;
              mat.envMapIntensity = 1.3;
              mat.color.setRGB(0.32, 0.38, 0.44);
            } else if (mat.name === "metal") mat.envMapIntensity = 1.1;
          });
          // compile the shaders before the first tower is shown (a stall of its own otherwise)
          await this.precompile(g.scene);
          return this.alive ? g.scene : null;
        } catch {
          return null;
        }
      })();
      this.models.set(m, p);
    }
    return p;
  }

  /** the car's world position */
  update(wx: number, wz: number): void {
    const [x, z] = unwarp(wx, wz, this.p);
    const bi = Math.floor(x / PITCH);
    const bj = Math.floor(z / PITCH);
    if (bi === this.kx && bj === this.kz) return;
    this.kx = bi;
    this.kz = bj;
    const old = new Map(this.jobs.map((j) => [`${j.far}${j.i},${j.j}`, j]));
    this.jobs.length = 0;
    // ---- towers (only the blocks that can have one: the cheap block kind first)
    const R = this.towerR;
    const wantT = new Set<string>();
    for (let i = bi - R; i <= bi + R && R > 0; i++)
      for (let j = bj - R; j <= bj + R; j++) {
        if (blockKind(i, j) !== "yangi") continue;
        const k = `${i},${j}`;
        wantT.add(k);
        if (!this.placed.has(k)) this.jobs.push({ far: false, i, j, d: Math.hypot(i - bi, j - bj) });
      }
    for (const [k, h] of this.placed)
      if (!wantT.has(k)) {
        this.group.remove(h);
        this.placed.delete(k);
      }
    // ---- far city
    const si = Math.floor(bi / SUPER);
    const sj = Math.floor(bj / SUPER);
    const wantF = new Set<string>();
    for (let a = si - this.farR; a <= si + this.farR; a++)
      for (let b = sj - this.farR; b <= sj + this.farR; b++) {
        const k = `${a},${b}`;
        wantF.add(k);
        if (!this.far.has(k)) {
          const job = old.get(`true${a},${b}`) ?? { far: true, i: a, j: b, d: 0 };
          job.d = Math.hypot((a + 0.5) * SUPER - bi - 0.5, (b + 0.5) * SUPER - bj - 0.5);
          this.jobs.push(job);
        }
      }
    for (const [k, m] of this.far)
      if (!wantF.has(k)) {
        this.group.remove(m);
        m.geometry.dispose();
        this.far.delete(k);
      }
    this.jobs.sort((a, b) => a.d - b.d);
  }

  /** Build the queued towers / chunks, nearest first, until `until` (a performance.now() time); a chunk is built a block at a time. */
  work(until: number): void {
    while (this.jobs.length && performance.now() < until) {
      const job = this.jobs[0];
      if (job.far) {
        job.gen ??= this.farChunk(job.i, job.j);
        const r = job.gen.next();
        if (!r.done) continue;
        this.jobs.shift();
        this.addFar(job.i, job.j, r.value);
      } else {
        this.jobs.shift();
        this.addTowers(job.i, job.j);
      }
    }
  }

  private addFar(a: number, b: number, geo: THREE.BufferGeometry): void {
    const k = `${a},${b}`;
    if (this.far.has(k)) {
      geo.dispose();
      return;
    }
    const m = new THREE.Mesh(geo, this.farMat);
    m.matrixAutoUpdate = false;
    this.far.set(k, m);
    this.group.add(m);
  }

  private addTowers(i: number, j: number): void {
    const k = `${i},${j}`;
    if (this.placed.has(k)) return;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    this.placed.set(k, holder);
    this.group.add(holder);
    for (const b of plan(i, j).buildings) {
      if (!b.model) continue;
      void this.model(b.model).then((m) => {
        if (!m || !this.alive || this.placed.get(k) !== holder) return;
        const t = m.clone();
        t.position.set(warpX(b.mx ?? 0, b.mz ?? 0), CURB_H, warpZ(b.mx ?? 0, b.mz ?? 0));
        t.updateMatrix();
        // static: no matrix maths per frame
        t.traverse((o) => {
          o.matrixAutoUpdate = false;
        });
        holder.add(t);
      });
    }
  }

  private clearFar(): void {
    for (const m of this.far.values()) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.far.clear();
  }

  /** plain boxes (inset so the detailed tiles cover them where both exist) for 3 x 3 blocks; yields after every block (the plan of a block is the slow part) */
  private *farChunk(a: number, b: number): Generator<void, THREE.BufferGeometry> {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const boxTowers = this.towerR === 0;
    const quad = (p: number[][], u: number[][], cc: THREE.Color) => {
      const base = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        pos.push(warpX(p[k][0], p[k][2]), p[k][1], warpZ(p[k][0], p[k][2]));
        uv.push(u[k][0], u[k][1]);
        col.push(cc.r, cc.g, cc.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // a plain wall area of the facade tile (for roofs / ground, coloured by the vertex colour)
    const PLAIN = [[0.03, 0.47], [0.04, 0.47], [0.04, 0.48], [0.03, 0.48]];
    for (let i = a * SUPER; i < (a + 1) * SUPER; i++)
      for (let j = b * SUPER; j < (b + 1) * SUPER; j++) {
        const p = plan(i, j);
        const gx0 = i * PITCH + WALK;
        const gz0 = j * PITCH + WALK;
        const gx1 = (i + 1) * PITCH - WALK;
        const gz1 = (j + 1) * PITCH - WALK;
        c.set(p.kind === "bog" || p.kind === "dala" ? 0x4f7a2c : p.kind === "mahalla" ? 0x8a7d62 : 0x9a968c);
        quad([[gx0, 0.1, gz0], [gx0, 0.1, gz1], [gx1, 0.1, gz1], [gx1, 0.1, gz0]], PLAIN, c);
        for (const bd of p.buildings) {
          if ((bd.model && !boxTowers) || bd.style === "fence" || bd.style === "fountain" || bd.style === "water") continue;
          const ins = 0.35;
          const x0 = bd.x0 + ins;
          const z0 = bd.z0 + ins;
          const x1 = bd.x1 - ins;
          const z1 = bd.z1 - ins;
          if (x1 <= x0 || z1 <= z0) continue;
          const H = bd.model ? TOWER_H[bd.model] : bd.style === "flats" ? 4 + (bd.floors - 1) * 3 : bd.h;
          const tile = bd.style === "flats" || bd.style === "house";
          if (bd.model) c.set(0x5c7189);
          else c.setHSL(0.09 + ihash(bd.seed, 1) * 0.05, 0.18, 0.7 + ihash(bd.seed, 2) * 0.15);
          const walls = [
            [x1, z0, x0, z0],
            [x0, z0, x0, z1],
            [x0, z1, x1, z1],
            [x1, z1, x1, z0],
          ];
          for (const [ax, az, bx, bz] of walls) {
            const L = Math.hypot(bx - ax, bz - az);
            const n = Math.max(1, Math.round(L / 3.2));
            // pieces of <= 8 m: the walls bend with the warped world like the detailed tiles do
            const m = Math.max(1, Math.ceil(L / 8));
            for (let k = 0; k < m; k++) {
              const t0 = k / m;
              const t1 = (k + 1) / m;
              const px = ax + (bx - ax) * t0;
              const pz = az + (bz - az) * t0;
              const qx = ax + (bx - ax) * t1;
              const qz = az + (bz - az) * t1;
              const u = tile ? [[n * t0, 0], [n * t1, 0], [n * t1, H / 6], [n * t0, H / 6]] : PLAIN;
              quad([[px, 0, pz], [qx, 0, qz], [qx, H, qz], [px, H, pz]], u, c);
            }
          }
          quad([[x0, H, z0], [x0, H, z1], [x1, H, z1], [x1, H, z0]], PLAIN, c.clone().multiplyScalar(0.55));
        }
        yield;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  dispose(): void {
    this.alive = false;
    this.clearFar();
    this.placed.clear();
    this.jobs.length = 0;
    for (const p of this.models.values())
      void p.then((m) =>
        m?.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          disposeMaterial(mesh.material as THREE.Material);
        }),
      );
    this.models.clear();
    this.warmGeo.dispose();
    this.farMat.map?.dispose();
    this.farMat.dispose();
  }
}
