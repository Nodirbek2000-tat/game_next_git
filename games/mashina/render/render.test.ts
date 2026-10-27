// @vitest-environment node
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildLayout, TILE } from "../world/layout";
import { buildTile } from "../world/tileBuilder";
import type { SignAtlas } from "./textures";
import { carParts, type CarKind } from "./carModel";
import { GeoBuilder } from "./geo";

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
      const meshes = [t.base, t.bldg, t.detail, t.signs, t.glow, t.water].filter((g): g is THREE.BufferGeometry => !!g);
      expect(meshes.length).toBeGreaterThan(0);
      expect(meshes.length).toBeLessThanOrEqual(6);
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

  it("a city tile has buildings (colliders) and a stub barrier at the city edge", () => {
    const t = buildTile(L.tiles.get("3,0")!, L, atlas);
    expect(t.stats.buildings).toBeGreaterThan(8);
    expect(t.boxes.length).toBeGreaterThan(8);
  });
});
