import * as THREE from "three";
import { newGltfLoader } from "@/engine/quality/assetUrl";
import { CURB_H, HW, PITCH, blockKind, distToPath, ihash, inPond, plan, unwarp, warpX, warpZ } from "./city";
import { type Precompile, disposeMaterial } from "./models";

/**
 * Street furniture from Poly Haven (CC0, prepared by tools/blender/props.py): benches, hydrants, manhole covers,
 * utility boxes, planters, shrubs, park lamps. Deterministic placements per block, instanced (one draw per mesh).
 */

type PropName = "painted_wooden_bench" | "fire_hydrant" | "water_manhole_cover" | "utility_box_01" | "planter_box_01" | "shrub_01" | "shrub_03" | "street_lamp_01" | "trashbag";
const CAPS: Record<PropName, number> = {
  painted_wooden_bench: 200, fire_hydrant: 110, water_manhole_cover: 120, utility_box_01: 100, planter_box_01: 110, shrub_01: 120, shrub_03: 140, street_lamp_01: 120, trashbag: 60,
};

interface Place {
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
}

/** placements of one block (and its south / west streets) */
export function propsOf(i: number, j: number): Record<PropName, Place[]> {
  const out = Object.fromEntries(Object.keys(CAPS).map((k) => [k, [] as Place[]])) as Record<PropName, Place[]>;
  const X0 = i * PITCH;
  const Z0 = j * PITCH;
  const kind = blockKind(i, j);
  const r = (n: number) => ihash(i, j, 2000 + n);
  const y = CURB_H;
  // the four sides of the block: start corner, direction, outward normal (towards the street)
  const sides: [number, number, number, number, number, number][] = [
    [X0 + HW, Z0 + HW, 1, 0, 0, -1],
    [X0 + PITCH - HW, Z0 + PITCH - HW, -1, 0, 0, 1],
    [X0 + HW, Z0 + PITCH - HW, 0, -1, -1, 0],
    [X0 + PITCH - HW, Z0 + HW, 0, 1, 1, 0],
  ];
  if (kind !== "dala") sides.forEach(([sx, sz, dx, dz, nx, nz], k) => {
    const at = (t: number, off: number) => [sx + dx * t - nx * off, sz + dz * t - nz * off];
    const face = Math.atan2(nx, nz);
    if (kind !== "mahalla") {
      for (const t of [33, 80]) {
        const [x, z] = at(t + (r(k * 10) - 0.5) * 4, 3.4);
        out.painted_wooden_bench.push({ x, y, z, rot: face, s: 1 });
      }
      const [px, pz] = at(56, 5.2);
      out.planter_box_01.push({ x: px, y, z: pz, rot: face + Math.PI / 2, s: 1.3 });
    }
    {
      const [x, z] = at(12 + r(k * 10 + 1) * 4, 0.9);
      out.fire_hydrant.push({ x, y, z, rot: face, s: 1 });
    }
    if (r(k * 10 + 2) < 0.7) {
      const [x, z] = at(64 + r(k * 10 + 3) * 10, 5.4);
      out.utility_box_01.push({ x, y, z, rot: face + Math.PI, s: 1 });
    }
    if (r(k * 10 + 4) < 0.35) {
      const [x, z] = at(70 + r(k * 10 + 5) * 6, 4.6);
      out.trashbag.push({ x, y, z, rot: r(k) * 6, s: 1 });
    }
  });
  // manholes in the lanes of the two streets this block owns
  if (kind !== "dala") out.water_manhole_cover.push({ x: X0 + 1.75, y: 0.004, z: Z0 + 30 + r(20) * 20, rot: r(21) * 6, s: 1 });
  if (kind !== "dala") out.water_manhole_cover.push({ x: X0 - 5.25, y: 0.004, z: Z0 + 70 + r(22) * 20, rot: r(23) * 6, s: 1 });
  if (kind !== "dala") out.water_manhole_cover.push({ x: X0 + 30 + r(24) * 20, y: 0.004, z: Z0 - 1.75, rot: r(25) * 6, s: 1 });
  // shrubs in yards / parks, park lamps along the paths
  const inner = [X0 + 13, Z0 + 13, X0 + PITCH - 13, Z0 + PITCH - 13];
  const nSh = kind === "bog" ? 40 : kind === "dala" ? 14 : kind === "markaz" ? 8 : 6;
  for (let q = 0; q < nSh; q++) {
    const x = inner[0] + 4 + r(40 + q) * (inner[2] - inner[0] - 8);
    const z = inner[1] + 4 + r(80 + q) * (inner[3] - inner[1] - 8);
    if (kind === "markaz" && (x < inner[0] + 19 || x > inner[2] - 19 || z < inner[1] + 19 || z > inner[3] - 19)) continue;
    (q % 2 ? out.shrub_01 : out.shrub_03).push({ x, y, z, rot: r(120 + q) * 6, s: 1.4 + r(160 + q) * 0.8 });
  }
  // nothing inside a building, on a park path or in a pond
  const pl0 = plan(i, j);
  const B = pl0.buildings;
  for (const k of Object.keys(out) as PropName[]) {
    if (k === "water_manhole_cover") continue;
    out[k] = out[k].filter(
      (p) =>
        !B.some((b) => p.x > b.x0 - 1 && p.x < b.x1 + 1 && p.z > b.z0 - 1 && p.z < b.z1 + 1) &&
        !pl0.paths.some((path) => distToPath(p.x, p.z, path) < 2.2) &&
        !pl0.ponds.some((pd) => inPond(p.x, p.z, pd)),
    );
  }
  if (kind === "bog") {
    // benches and lamps along the winding paths (from the plan)
    const pl = plan(i, j);
    for (const p of pl.posts) if (p.kind === "bench") out.painted_wooden_bench.push({ x: p.x, y, z: p.z, rot: p.rot ?? 0, s: 1 });
    pl.paths.forEach((path, k) => {
      for (let q = 4; q < path.length - 1; q += 5) {
        const [ax, az] = path[q];
        const [bx, bz] = path[q + 1];
        const d = Math.hypot(bx - ax, bz - az) || 1;
        out.street_lamp_01.push({ x: ax - ((bz - az) / d) * 2.2, y, z: az + ((bx - ax) / d) * 2.2, rot: 0, s: 1 });
      }
      void k;
    });
  }
  return out;
}

export class PropField {
  readonly group = new THREE.Group();
  private meshes = new Map<PropName, THREE.InstancedMesh[]>();
  /** the placements of every block read so far (a block is generated once) */
  private blocks = new Map<string, Record<PropName, Place[]>>();
  private bi = 0;
  private bj = 0;
  private radius = 0;
  private dirty = true;
  private o = new THREE.Object3D();
  private alive = true;
  private owned: { dispose(): void }[] = [];
  private materials: THREE.Material[] = [];

  /** `precompile`: shaders are compiled before a prop is shown. With `load` false no model is fetched (the field stays empty). */
  constructor(
    private shadows: boolean,
    private precompile: Precompile,
    load = true,
  ) {
    if (load) void this.load();
  }

  private async load(): Promise<void> {
    const loader = await newGltfLoader();
    for (const name of Object.keys(CAPS) as PropName[]) {
      try {
        const g = await loader.loadAsync(`/models/poyga/props/${name}.glb`);
        if (!this.alive) return;
        g.scene.updateMatrixWorld(true);
        const list: THREE.InstancedMesh[] = [];
        g.scene.traverse((ob) => {
          const mesh = ob as THREE.Mesh;
          if (!mesh.isMesh) return;
          const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (name.startsWith("shrub")) {
            mat.alphaTest = 0.5;
            mat.transparent = false;
            mat.side = THREE.DoubleSide;
          }
          const im = new THREE.InstancedMesh(geo, mat, CAPS[name]);
          im.count = 0;
          im.castShadow = this.shadows && name !== "water_manhole_cover";
          im.receiveShadow = true;
          im.frustumCulled = false;
          this.owned.push(geo);
          this.materials.push(mat);
          list.push(im);
        });
        // compile before the prop is shown: one model per load, so the compiles are spread out too
        await Promise.all(list.map((im) => this.precompile(im)));
        if (!this.alive) return;
        for (const im of list) this.group.add(im);
        this.meshes.set(name, list);
        this.dirty = true;
      } catch {
        /* a missing prop is skipped */
      }
    }
  }

  /** the placements of one block (generated once) */
  private block(i: number, j: number): Record<PropName, Place[]> {
    const k = `${i},${j}`;
    let b = this.blocks.get(k);
    if (!b) {
      b = propsOf(i, j);
      this.blocks.set(k, b);
    }
    return b;
  }

  /** The car's world position and how many blocks around it get props (0 = none: the field is hidden). */
  update(wx: number, wz: number, radius: number): void {
    const [x, z] = unwarp(wx, wz);
    const bi = Math.floor(x / PITCH);
    const bj = Math.floor(z / PITCH);
    if (bi !== this.bi || bj !== this.bj || radius !== this.radius) {
      this.bi = bi;
      this.bj = bj;
      this.radius = radius;
      this.dirty = true;
    }
    this.group.visible = radius > 0;
  }

  /** Read the missing blocks (until `until`, a performance.now() time; at least one) and, once all are there, lay out the instances. */
  work(until: number): void {
    if (!this.dirty || this.radius <= 0 || this.meshes.size === 0) return;
    const { bi, bj, radius } = this;
    let read = 0;
    for (let i = bi - radius; i <= bi + radius; i++)
      for (let j = bj - radius; j <= bj + radius; j++) {
        if (this.blocks.has(`${i},${j}`)) continue;
        if (read > 0 && performance.now() >= until) return;
        read++;
        this.block(i, j);
      }
    const n = new Map<PropName, number>();
    for (let i = bi - radius; i <= bi + radius; i++)
      for (let j = bj - radius; j <= bj + radius; j++) {
        const pl = this.block(i, j);
        for (const name of Object.keys(pl) as PropName[]) {
          const list = this.meshes.get(name);
          if (!list) continue;
          for (const p of pl[name]) {
            const k = n.get(name) ?? 0;
            if (k >= CAPS[name]) break;
            this.o.position.set(warpX(p.x, p.z), p.y, warpZ(p.x, p.z));
            this.o.rotation.set(0, p.rot, 0);
            this.o.scale.setScalar(p.s);
            this.o.updateMatrix();
            for (const im of list) im.setMatrixAt(k, this.o.matrix);
            n.set(name, k + 1);
          }
        }
      }
    for (const [name, list] of this.meshes)
      for (const im of list) {
        im.count = n.get(name) ?? 0;
        im.instanceMatrix.needsUpdate = true;
      }
    for (const k of this.blocks.keys()) {
      const [i, j] = k.split(",").map(Number);
      if (Math.abs(i - bi) > radius + 2 || Math.abs(j - bj) > radius + 2) this.blocks.delete(k);
    }
    this.dirty = false;
  }

  dispose(): void {
    this.alive = false;
    for (const list of this.meshes.values()) for (const im of list) im.dispose();
    for (const x of this.owned) x.dispose();
    for (const m of this.materials) disposeMaterial(m);
  }
}
