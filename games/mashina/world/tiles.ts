import { loadMetres } from "../render/lod";
import { TILE, type Layout, type TileSpec } from "./layout";

export type Lod = 0 | 1;

export interface TileRadii {
  /** tiles whose nearest edge is closer than this get loaded (m) */
  load: number;
  /** loaded tiles farther than this are released (m), a bit larger than `load` so tiles do not flap */
  unload: number;
  /** fog end / camera far plane (m) */
  far: number;
}

/** View distance from engine.quality.viewDistance (0..1): high 300 m, medium 237 m, low 175 m of streamed world (render/lod.ts). */
export function radiiFor(viewDistance: number): TileRadii {
  const load = loadMetres(viewDistance);
  return { load, unload: load + TILE * 0.5, far: load * 1.05 };
}

export interface PlanItem {
  spec: TileSpec;
  lod: Lod;
  dist: number;
}
export interface TilePlan {
  load: PlanItem[];
  unload: string[];
  lod: { id: string; lod: Lod }[];
}

function rectDist(px: number, pz: number, s: TileSpec): number {
  const dx = Math.max(s.x0 - px, 0, px - (s.x0 + TILE));
  const dz = Math.max(s.z0 - pz, 0, pz - (s.z0 + TILE));
  return Math.hypot(dx, dz);
}

/**
 * Streaming bookkeeping for the tile world (pure, no three.js): given the car position and the view distance it says
 * which tiles to build (nearest first), which to release and which switch level of detail. Tiles outside the manifest
 * are implicit "field" tiles, so the world is endless; new areas are just more manifest rows.
 */
export class TileManager {
  readonly loaded = new Map<string, Lod>();

  constructor(private layout: Layout) {}

  reset(): void {
    this.loaded.clear();
  }

  plan(px: number, pz: number, viewDistance: number, out: TilePlan = { load: [], unload: [], lod: [] }): TilePlan {
    const R = radiiFor(viewDistance);
    out.load.length = 0;
    out.unload.length = 0;
    out.lod.length = 0;
    const c0 = Math.floor((px - R.load) / TILE);
    const c1 = Math.floor((px + R.load) / TILE);
    const r0 = Math.floor((pz - R.load) / TILE);
    const r1 = Math.floor((pz + R.load) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const spec = this.layout.specAt(c, r);
        const d = rectDist(px, pz, spec);
        if (d >= R.load) continue;
        const cur = this.loaded.get(spec.id);
        if (cur === undefined) out.load.push({ spec, lod: d < R.load * 0.5 ? 0 : 1, dist: d });
      }
    }
    out.load.sort((a, b) => a.dist - b.dist);
    for (const [id, lod] of this.loaded) {
      const spec = this.layout.specAt(...(id.split(",").map(Number) as [number, number]));
      const d = rectDist(px, pz, spec);
      if (d > R.unload) out.unload.push(id);
      else if (lod === 0 && d > R.load * 0.58) out.lod.push({ id, lod: 1 });
      else if (lod === 1 && d < R.load * 0.45) out.lod.push({ id, lod: 0 });
    }
    return out;
  }

  markLoaded(id: string, lod: Lod): void {
    this.loaded.set(id, lod);
  }
  markUnloaded(id: string): void {
    this.loaded.delete(id);
  }
}
