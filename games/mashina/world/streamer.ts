import * as THREE from "three";
import type { PhysWorld } from "../physics/world";
import type { Mats } from "../render/materials";
import type { SignAtlas } from "../render/textures";
import type { TileSource } from "../render/vegetation";
import type { Layout } from "./layout";
import { TileManager, radiiFor, type Lod, type PlanItem, type TilePlan } from "./tiles";
import { buildTile, buildTileSteps, type PropPlace, type TileBuild, type TreePlace } from "./tileBuilder";

interface Loaded extends TileSource {
  id: string;
  group: THREE.Group;
  detail: THREE.Group;
  geos: THREE.BufferGeometry[];
  build: Pick<TileBuild, "boxes" | "meshes" | "ground">;
  physics: boolean;
  lod: Lod;
  trees: TreePlace[];
  props: PropPlace[];
}

interface Job {
  item: PlanItem;
  steps: Generator<void, TileBuild>;
}

/**
 * Streams the tiles around the car: builds the merged meshes of a tile in steps (a few milliseconds per frame, nearest first),
 * adds the colliders to Rapier, switches level of detail (props/signs/lamps off for far tiles) and releases what is out of
 * range. Geometry is disposed on release; materials are shared and live as long as the scene.
 */
export class WorldStreamer {
  readonly group = new THREE.Group();
  readonly tm: TileManager;
  private tiles = new Map<string, Loaded>();
  private plan: TilePlan = { load: [], unload: [], lod: [] };
  private queue: PlanItem[] = [];
  private job: Job | null = null;
  private acc = 99;
  /** bumped whenever the set of loaded tiles (or a tile's level of detail) changes: the vegetation layers re-read the tiles then */
  version = 0;
  /** tiles built since the start (stats for the e2e test) */
  built = 0;
  released = 0;
  private lastBuildMs = 0;
  private buildMs = 0;

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
  /** tiles waiting to be built (the one being built counts) */
  get pending(): number {
    return this.queue.length + (this.job ? 1 : 0);
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
  /** what the vegetation layers draw from */
  get sources(): ReadonlyMap<string, TileSource> {
    return this.tiles;
  }

  /** Turn a finished build into meshes + colliders. */
  private finish(item: PlanItem, b: TileBuild, ms: number): void {
    const spec = item.spec;
    if (this.tiles.has(spec.id)) return;
    const group = new THREE.Group();
    group.name = `tile ${spec.id}`;
    const detail = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry | null, mat: THREE.Material, parent: THREE.Object3D): void => {
      if (!g) return;
      geos.push(g);
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      parent.add(m);
    };
    add(b.base, this.mats.ground, group);
    add(b.road, this.mats.road, group);
    add(b.walk, this.mats.walk, group);
    add(b.bldg, this.mats.bldg, group);
    add(b.water, this.mats.water, group);
    add(b.detail, this.mats.detail, detail);
    add(b.signs, this.mats.signs, detail);
    add(b.glow, this.mats.glow, detail);
    group.add(detail);
    detail.visible = item.lod === 0;
    this.group.add(group);
    const rec: Loaded = { id: spec.id, group, detail, geos, build: { boxes: b.boxes, meshes: b.meshes, ground: b.ground }, physics: false, lod: item.lod, trees: b.trees, props: b.props };
    this.tiles.set(spec.id, rec);
    this.tm.markLoaded(spec.id, item.lod);
    this.attachPhysics(rec);
    this.built++;
    this.version++;
    this.lastBuildMs = ms;
  }

  /** Build the tile now (the very first tiles, so the shaders see real meshes before the countdown). */
  private buildNow(item: PlanItem): void {
    if (this.tiles.has(item.spec.id)) return;
    const t0 = performance.now();
    this.finish(item, buildTile(item.spec, this.L, this.atlas), 0);
    this.lastBuildMs = performance.now() - t0;
  }

  private attachPhysics(t: Loaded): void {
    const p = this.phys();
    if (!p || t.physics) return;
    p.addTile(t.id, t.build.boxes, t.build.meshes, t.build.ground);
    t.physics = true;
  }

  /**
   * Call every frame with the car position; the planning itself runs ~4x per second. Tiles are built in steps until
   * `until` (a performance.now() time), at least one step per call; at most `maxTiles` are finished per call.
   */
  update(px: number, pz: number, viewDistance: number, dt: number, until: number, maxTiles = 1): void {
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
          this.version++;
        }
      }
    }
    let done = 0;
    let first = true;
    while (done < maxTiles && (first || performance.now() < until)) {
      first = false;
      if (!this.job) {
        const it = this.next();
        if (!it) break;
        this.job = { item: it, steps: buildTileSteps(it.spec, this.L, this.atlas) };
        this.buildMs = 0;
      }
      const t0 = performance.now();
      const r = this.job.steps.next();
      this.buildMs += performance.now() - t0;
      if (r.done) {
        this.finish(this.job.item, r.value, this.buildMs);
        this.job = null;
        done++;
      }
    }
    const phys = this.phys();
    if (phys) for (const t of this.tiles.values()) if (!t.physics) this.attachPhysics(t);
  }

  /** the nearest tile still to build (planning is refreshed 4x a second, so entries can be stale) */
  private next(): PlanItem | null {
    while (this.queue.length) {
      const it = this.queue.shift()!;
      if (!this.tiles.has(it.spec.id)) return it;
    }
    return null;
  }

  /** Synchronous: plan and build the nearest `maxTiles` now (mount time / respawn far away); the rest is queued for `update`. */
  loadAll(px: number, pz: number, viewDistance: number, maxTiles = 99): void {
    const plan = this.tm.plan(px, pz, viewDistance, this.plan);
    for (const id of plan.unload) this.release(id);
    this.job = null;
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
    this.version++;
  }

  radii(viewDistance: number): { load: number; unload: number; far: number } {
    return radiiFor(viewDistance);
  }

  dispose(): void {
    for (const id of [...this.tiles.keys()]) this.release(id);
    this.queue.length = 0;
    this.job = null;
  }
}
