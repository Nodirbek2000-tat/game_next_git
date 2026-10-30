import * as THREE from "three";
import { CURB_H, ihash, PITCH, plan, type TowerModel, unwarp, WALK, warpX, warpZ } from "./city";

/**
 * The skyline: Blender towers (tools/blender/buildings.py) placed where the city plan says, kept within ~1.3 km, and
 * the far city: every 3 x 3 blocks one merged mesh of plain facade-textured boxes (the blocks' buildings) so the city
 * reaches the horizon instead of ending at the edge of the detailed tiles.
 */

const TOWER_R = 11; // blocks
const FAR_R = 3; // superchunks (3 x 3 blocks each) around the car
const SUPER = 3;

export class Skyline {
  readonly group = new THREE.Group();
  private models = new Map<TowerModel, Promise<THREE.Object3D | null>>();
  private placed = new Map<string, THREE.Object3D>();
  private far = new Map<string, THREE.Mesh>();
  private farMat: THREE.MeshStandardMaterial;
  private key = "";
  private alive = true;

  constructor(aniso: number) {
    const t = new THREE.TextureLoader().load("/textures/poyga/facades/facade_flats.png");
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    this.farMat = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.8, envMapIntensity: 0.4 });
  }

  private model(m: TowerModel): Promise<THREE.Object3D | null> {
    let p = this.models.get(m);
    if (!p) {
      p = (async () => {
        try {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          const g = await new GLTFLoader().loadAsync(`/models/poyga/buildings/${m}.glb`);
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
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          });
          return g.scene;
        } catch {
          return null;
        }
      })();
      this.models.set(m, p);
    }
    return p;
  }

  update(wx: number, wz: number): void {
    const [x, z] = unwarp(wx, wz);
    const bi = Math.floor(x / PITCH);
    const bj = Math.floor(z / PITCH);
    const key = `${bi},${bj}`;
    if (key === this.key) return;
    this.key = key;
    // ---- towers
    const want = new Set<string>();
    for (let i = bi - TOWER_R; i <= bi + TOWER_R; i++)
      for (let j = bj - TOWER_R; j <= bj + TOWER_R; j++) {
        const p = plan(i, j);
        if (p.kind !== "yangi") continue;
        p.buildings.forEach((b, n) => {
          if (!b.model) return;
          const k = `${i},${j},${n}`;
          want.add(k);
          if (this.placed.has(k)) return;
          const holder = new THREE.Group();
          holder.position.set(warpX(b.mx ?? 0, b.mz ?? 0), CURB_H, warpZ(b.mx ?? 0, b.mz ?? 0));
          this.placed.set(k, holder);
          this.group.add(holder);
          void this.model(b.model).then((m) => {
            if (m && this.alive && this.placed.get(k) === holder) holder.add(m.clone());
          });
        });
      }
    for (const [k, h] of this.placed)
      if (!want.has(k)) {
        this.group.remove(h);
        this.placed.delete(k);
      }
    // ---- far city
    const si = Math.floor(bi / SUPER);
    const sj = Math.floor(bj / SUPER);
    const wantF = new Set<string>();
    for (let a = si - FAR_R; a <= si + FAR_R; a++)
      for (let b = sj - FAR_R; b <= sj + FAR_R; b++) {
        const k = `${a},${b}`;
        wantF.add(k);
        if (!this.far.has(k)) {
          const m = new THREE.Mesh(this.farChunk(a, b), this.farMat);
          this.far.set(k, m);
          this.group.add(m);
        }
      }
    for (const [k, m] of this.far)
      if (!wantF.has(k)) {
        this.group.remove(m);
        m.geometry.dispose();
        this.far.delete(k);
      }
  }

  /** plain boxes (inset so the detailed tiles cover them where both exist) for 3 x 3 blocks */
  private farChunk(a: number, b: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
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
          if (bd.model || bd.style === "fence" || bd.style === "fountain" || bd.style === "water") continue;
          const ins = 0.35;
          const x0 = bd.x0 + ins;
          const z0 = bd.z0 + ins;
          const x1 = bd.x1 - ins;
          const z1 = bd.z1 - ins;
          if (x1 <= x0 || z1 <= z0) continue;
          const H = bd.style === "flats" ? 4 + (bd.floors - 1) * 3 : bd.h;
          const tile = bd.style === "flats" || bd.style === "house";
          c.setHSL(0.09 + ihash(bd.seed, 1) * 0.05, 0.18, 0.7 + ihash(bd.seed, 2) * 0.15);
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
    for (const m of this.far.values()) m.geometry.dispose();
    this.far.clear();
    this.placed.clear();
    this.farMat.map?.dispose();
    this.farMat.dispose();
  }
}
