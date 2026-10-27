import * as THREE from "three";
import type { PhysWorld } from "../physics/world";
import type { Mats } from "../render/materials";
import type { SignAtlas } from "../render/textures";
import type { Layout } from "./layout";
import { TileManager, radiiFor, type Lod, type PlanItem, type TilePlan } from "./tiles";
import { buildTile, type TileBuild } from "./tileBuilder";

interface Loaded {
  id: string;
  group: THREE.Group;
  detail: THREE.Group;
  geos: THREE.BufferGeometry[];
  build: Pick<TileBuild, "boxes" | "meshes" | "ground">;
  physics: boolean;
  lod: Lod;
}

/**
 * Streams the tiles around the car: builds the merged meshes of a tile (one per frame at most, nearest first),
 * adds the colliders to Rapier, switches level of detail (props/signs/lamps off for far tiles) and releases
 * what is out of range. Geometry is disposed on release; materials are shared and live as long as the scene.
 */
export class WorldStreamer {
  readonly group = new THREE.Group();
  readonly tm: TileManager;
  private tiles = new Map<string, Loaded>();
  private plan: TilePlan = { load: [], unload: [], lod: [] };
  private queue: PlanItem[] = [];
  private acc = 99;
  /** tiles built since the start (stats for the e2e test) */
  built = 0;
  released = 0;
  private lastBuildMs = 0;

  constructor(
    private L: Layout,
    private mats: Mats,
    private atlas: SignAtlas,
    private phys: () => PhysWorld | null,
  ) {
    this.tm = new TileManager(L);
    this.group.name = "tiles";
  }

  get loadedCount(): number {
    return this.tiles.size;
  }
  get pending(): number {
    return this.queue.length;
  }
  get lastBuild(): number {
    return this.lastBuildMs;
  }
  has(id: string): boolean {
    return this.tiles.has(id);
  }
  ids(): string[] {
    return [...this.tiles.keys()];
  }

  /** Build the tile now (used for the very first tiles so the shaders see real meshes before the countdown). */
  private buildNow(item: PlanItem): void {
    const t0 = performance.now();
    const spec = item.spec;
    if (this.tiles.has(spec.id)) return;
    const b = buildTile(spec, this.L, this.atlas);
    const group = new THREE.Group();
    group.name = `tile ${spec.id}`;
    const detail = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry | null, mat: THREE.Material, parent: THREE.Object3D, recv = false): void => {
      if (!g) return;
      geos.push(g);
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      m.receiveShadow = recv;
      parent.add(m);
    };
    add(b.base, this.mats.flat, group, true);
    add(b.bldg, this.mats.bldg, group, true);
    add(b.water, this.mats.water, group);
    add(b.detail, this.mats.flatDetail, detail, true);
    add(b.signs, this.mats.signs, detail);
    add(b.glow, this.mats.glow, detail);
    group.add(detail);
    detail.visible = item.lod === 0;
    this.group.add(group);
    const rec: Loaded = { id: spec.id, group, detail, geos, build: { boxes: b.boxes, meshes: b.meshes, ground: b.ground }, physics: false, lod: item.lod };
    this.tiles.set(spec.id, rec);
    this.tm.markLoaded(spec.id, item.lod);
    this.attachPhysics(rec);
    this.built++;
    this.lastBuildMs = performance.now() - t0;
  }

  private attachPhysics(t: Loaded): void {
    const p = this.phys();
    if (!p || t.physics) return;
    p.addTile(t.id, t.build.boxes, t.build.meshes, t.build.ground);
    t.physics = true;
  }

  /** Call every frame with the car position; the planning itself runs ~4x per second. */
  update(px: number, pz: number, viewDistance: number, dt: number, maxBuilds = 1): void {
    this.acc += dt;
    if (this.acc >= 0.25) {
      this.acc = 0;
      const plan = this.tm.plan(px, pz, viewDistance, this.plan);
      this.queue = plan.load.slice();
      for (const id of plan.unload) this.release(id);
      for (const l of plan.lod) {
        const t = this.tiles.get(l.id);
        if (t) {
          t.lod = l.lod;
          t.detail.visible = l.lod === 0;
          this.tm.markLoaded(l.id, l.lod);
        }
      }
    }
    let n = 0;
    while (this.queue.length && n < maxBuilds) {
      const it = this.queue.shift()!;
      this.buildNow(it);
      n++;
    }
    const phys = this.phys();
    if (phys) for (const t of this.tiles.values()) if (!t.physics) this.attachPhysics(t);
  }

  /** Synchronous: plan and build everything in range (mount time / respawn far away). */
  loadAll(px: number, pz: number, viewDistance: number, maxTiles = 99): void {
    const plan = this.tm.plan(px, pz, viewDistance, this.plan);
    for (const id of plan.unload) this.release(id);
    let n = 0;
    for (const it of plan.load) {
      if (n++ >= maxTiles) break;
      this.buildNow(it);
    }
    this.queue = this.tm.plan(px, pz, viewDistance, { load: [], unload: [], lod: [] }).load;
    this.acc = 0;
  }

  /** Is the tile under (x, z) ready (graphics + physics)? Used so the car is not dropped onto a missing floor. */
  groundReady(x: number, z: number): boolean {
    const t = this.tiles.get(this.L.specAt(Math.floor(x / 120), Math.floor(z / 120)).id);
    return !!t && t.physics;
  }

  private release(id: string): void {
    const t = this.tiles.get(id);
    if (!t) return;
    this.phys()?.removeTile(id);
    this.group.remove(t.group);
    for (const g of t.geos) g.dispose();
    this.tiles.delete(id);
    this.tm.markUnloaded(id);
    this.released++;
  }

  radii(viewDistance: number): { load: number; unload: number; far: number } {
    return radiiFor(viewDistance);
  }

  dispose(): void {
    for (const id of [...this.tiles.keys()]) this.release(id);
    this.queue.length = 0;
  }
}
