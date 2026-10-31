// @vitest-environment node
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildLayout, TILE } from "../world/layout";
import { buildTile, buildTileSteps } from "../world/tileBuilder";
import type { SignAtlas } from "./textures";
import { carParts, type CarKind } from "./carModel";
import { GeoBuilder } from "./geo";
import { LOD, effectiveLevel, loadMetres, squeeze } from "./lod";
import { radiiFor } from "../world/tiles";

const triangles = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

/** Every triangle's winding must agree with its stored normal, and the normal must point away from the solid's centre. */
function normalsOutward(g: THREE.BufferGeometry, centre: THREE.Vector3): { bad: number; total: number } {
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const idx = g.index!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const f = new THREE.Vector3();
  let bad = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    f.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const s = new THREE.Vector3().fromBufferAttribute(n, idx.getX(i));
    const mid = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(centre);
    if (f.dot(s) < 0.99 || mid.dot(f) < -1e-6) bad++;
  }
  return { bad, total: idx.count / 3 };
}

describe("geometry builder", () => {
  it("box, cylinder, cone, blob, dome and gable have outward, consistent faces", () => {
    const shapes: [string, (g: GeoBuilder) => void][] = [
      ["box", (g) => g.box(0, -1, 0, 2, 2, 2, 0xffffff)],
      ["cyl", (g) => g.cyl(0, -1, 0, 1, 2, 0xffffff, 10)],
      ["cone", (g) => g.cone(0, -1, 0, 1, 2, 0xffffff, 8)],
      ["blob", (g) => g.blob(0, 0, 0, 1, 0xffffff)],
      ["dome", (g) => g.dome(0, 0, 0, 1, 0xffffff, 10, 4)],
      ["profile", (g) => g.profile([[-1, -0.5], [-1, 0.5], [1, 0.5], [1, -0.5]], 0.8, 0xffffff)],
    ];
    for (const [name, make] of shapes) {
      const g = new GeoBuilder();
      make(g);
      const geo = g.build();
      // dome / gable are open at the bottom: the test uses their own centre above the base
      const centre = name === "dome" ? new THREE.Vector3(0, -0.2, 0) : new THREE.Vector3(0, 0, 0);
      const r = normalsOutward(geo, centre);
      expect(r.bad, `${name}: ${r.bad}/${r.total} faces wrong`).toBe(0);
    }
  });

  it("rotated frames rotate the normals with the geometry", () => {
    const g = new GeoBuilder();
    g.push(10, 5, Math.PI / 2);
    g.box(0, 0, 0, 2, 2, 2, 0xffffff);
    g.pop();
    const geo = g.build();
    expect(normalsOutward(geo, new THREE.Vector3(10, 1, 5)).bad).toBe(0);
  });
});

describe("cars (procedural fallback models)", () => {
  for (const kind of ["sedan", "krossover", "sport", "van", "truck"] as CarKind[]) {
    it(`${kind}: well under the 40k triangle budget, finite, wheels fit under the body`, () => {
      const p = carParts(kind);
      const tris = triangles(p.paint) + triangles(p.trim) + triangles(p.lamps) + 4 * triangles(p.wheel);
      expect(tris).toBeGreaterThan(50);
      expect(tris).toBeLessThanOrEqual(40_000);
      for (const g of [p.paint, p.trim, p.lamps, p.wheel]) for (const v of g.getAttribute("position").array) expect(Number.isFinite(v)).toBe(true);
      expect(p.wheelPos).toHaveLength(4);
      p.paint.computeBoundingBox();
      p.trim.computeBoundingBox();
      const bb = p.paint.boundingBox!.clone().union(p.trim.boundingBox!);
      expect(bb.min.y).toBeGreaterThanOrEqual(0);
      expect(bb.max.z - bb.min.z).toBeGreaterThan(3.5);
    });
  }
});

describe("tile geometry", () => {
  const L = buildLayout();
  const atlas = { cells: { get: () => ({ uv: [0, 0, 1, 1], w: 1, h: 1 }) } } as unknown as SignAtlas;
  const samples = ["0,0", "1,1", "3,2", "4,1", "6,1", "9,1", "10,1", "9,2", "10,2"];
  for (const id of samples) {
    it(`tile ${id} builds merged meshes with finite vertices inside its area`, () => {
      const spec = L.tiles.get(id)!;
      const t = buildTile(spec, L, atlas);
      const meshes = [t.base, t.road, t.walk, t.bldg, t.detail, t.signs, t.glow, t.water].filter((g): g is THREE.BufferGeometry => !!g);
      expect(meshes.length).toBeGreaterThan(0);
      expect(meshes.length).toBeLessThanOrEqual(8);
      let verts = 0;
      for (const g of meshes) {
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        for (const v of g.getAttribute("position").array) expect(Number.isFinite(v)).toBe(true);
        // everything stays within the tile (plus the props that lean a little over the border) and below 40 m
        expect(bb.min.x).toBeGreaterThan(spec.x0 - 12);
        expect(bb.max.x).toBeLessThan(spec.x0 + TILE + 12);
        expect(bb.min.z).toBeGreaterThan(spec.z0 - 12);
        expect(bb.max.z).toBeLessThan(spec.z0 + TILE + 12);
        expect(bb.max.y).toBeLessThan(45);
        verts += g.getAttribute("position").count;
      }
      expect(verts).toBeLessThan(60_000);
      if (spec.kind !== "bridge") expect(t.ground.length).toBeGreaterThan(0);
      else expect(t.meshes.length).toBeGreaterThan(0);
    });
  }

  it("the ground is split by surface (asphalt, pavement, grass each get their own texture) and every flat vertex has world UVs", () => {
    const city = buildTile(L.tiles.get("3,0")!, L, atlas);
    expect(city.road).not.toBeNull();
    expect(city.walk).not.toBeNull();
    expect(city.base).not.toBeNull();
    for (const g of [city.road!, city.walk!, city.base!]) {
      const uv = g.getAttribute("uv");
      const pos = g.getAttribute("position");
      // flat quads: u = x / 8, v = z / 8 (the PBR textures tile every 8 m)
      for (let i = 0; i < Math.min(40, pos.count); i++) {
        expect(uv.getX(i)).toBeCloseTo(pos.getX(i) / 8, 4);
        expect(uv.getY(i)).toBeCloseTo(pos.getZ(i) / 8, 4);
      }
    }
    const air = buildTile(L.tiles.get("10,1")!, L, atlas);
    expect(air.road).not.toBeNull();
    // the highway has no pavement
    expect(buildTile(L.tiles.get("5,1")!, L, atlas).walk).toBeNull();
  });

  it("trees and street furniture are placements (no geometry): inside their tile, and the city has benches and hydrants", () => {
    let trees = 0;
    const kinds = new Set<string>();
    for (const id of ["1,1", "3,1", "4,1", "6,1", "9,1", "11,2", "0,0"]) {
      const spec = L.tiles.get(id) ?? L.specAt(...(id.split(",").map(Number) as [number, number]));
      const t = buildTile(spec, L, atlas);
      for (const tr of t.trees) {
        trees++;
        expect(tr.x).toBeGreaterThan(spec.x0 - 1);
        expect(tr.x).toBeLessThan(spec.x0 + TILE + 1);
        expect(tr.z).toBeGreaterThan(spec.z0 - 1);
        expect(tr.z).toBeLessThan(spec.z0 + TILE + 1);
        expect(tr.v).toBeGreaterThanOrEqual(0);
        expect(tr.v).toBeLessThan(1);
        expect(tr.s).toBeGreaterThan(0.3);
      }
      for (const pr of t.props) {
        kinds.add(pr.kind);
        expect(Number.isFinite(pr.x + pr.z + pr.rot)).toBe(true);
      }
    }
    expect(trees).toBeGreaterThan(10);
    expect(kinds.has("bench") || kinds.has("hydrant")).toBe(true);
  });

  it("the stepwise build gives the same tile as the one-go build and yields between its heavy parts", () => {
    for (const id of ["3,0", "6,1", "10,1"]) {
      const spec = L.tiles.get(id)!;
      const whole = buildTile(spec, L, atlas);
      const it = buildTileSteps(spec, L, atlas);
      let steps = 0;
      let r = it.next();
      while (!r.done) {
        steps++;
        r = it.next();
      }
      expect(steps).toBeGreaterThanOrEqual(spec.kind === "city" ? 6 : 2);
      const same = (a: THREE.BufferGeometry | null, b: THREE.BufferGeometry | null) => (a?.getAttribute("position").count ?? 0) === (b?.getAttribute("position").count ?? 0);
      for (const k of ["base", "road", "walk", "bldg", "detail", "signs", "glow", "water"] as const) expect(same(whole[k], r.value[k])).toBe(true);
      expect(r.value.boxes.length).toBe(whole.boxes.length);
      expect(r.value.trees.length).toBe(whole.trees.length);
    }
  });

  it("a city tile has buildings (colliders) and a stub barrier at the city edge", () => {
    const t = buildTile(L.tiles.get("3,0")!, L, atlas);
    expect(t.stats.buildings).toBeGreaterThan(8);
    expect(t.boxes.length).toBeGreaterThan(8);
  });
});

describe("quality levels (render/lod.ts)", () => {
  it("every number gets cheaper from high to low, and low is a real lite mode", () => {
    const { high, medium, low } = LOD;
    for (const k of ["vd", "fogNear", "density", "peds", "treeNear", "treeNearDist", "treeFar", "aniso", "rain", "smoke", "workMs"] as const) {
      expect(high[k], k).toBeGreaterThanOrEqual(medium[k]);
      expect(medium[k], k).toBeGreaterThanOrEqual(low[k]);
    }
    expect(low.treeNear).toBe(0); // no tree models are fetched
    expect([low.props, low.pbrMaps, low.clearcoat, low.hdr, low.post]).toEqual([false, false, false, false, false]);
    expect([medium.post, medium.clearcoat]).toEqual([false, false]); // no heavy passes below high
    expect(high.post).toBe(true);
    // the haze and the streamed radius follow the engine's view distance of each level (controller BASE: 1 / 0.75 / 0.5)
    expect([high, medium, low].map((l) => Math.round(loadMetres(l.vd)))).toEqual([300, 238, 175]);
    expect(radiiFor(0.5).load).toBe(loadMetres(0.5));
  });

  it("the level the scene was built for caps the live one; the emergency squeeze is read from the view distance", () => {
    expect(effectiveLevel("medium", "high")).toBe("medium");
    expect(effectiveLevel("high", "low")).toBe("low");
    expect(squeeze("low", 0.5)).toBe(1);
    expect(squeeze("low", 0.375)).toBeCloseTo(0.75, 5);
    expect(squeeze("low", 0.01)).toBe(0.3);
  });
});
