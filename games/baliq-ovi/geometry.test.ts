import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FISH_VERTS, fishPositions, fishTopology, makeBootGeometry, makeBottleGeometry, makeFishGeometry, profile, swimBend } from "./fishGeometry";
import { LAKE, bedDepth } from "./locations";
import { LineRibbon, RodMesh, ROD_LEN } from "./rod";
import { FISH_SPECIES, SPECIES } from "./species";
import { buildWaterGeometry } from "./water";
import { BRIDGE, flattenModel, terrainHeight } from "./world";

describe("procedural fish", () => {
  it("every species fits the budget (<= 6k triangles) and has finite, sensible positions", () => {
    const t = fishTopology();
    expect(t.index.length / 3).toBeLessThan(6000);
    expect(Math.max(...t.index)).toBeLessThan(FISH_VERTS);
    for (const s of FISH_SPECIES) {
      const p = new Float32Array(FISH_VERTS * 3);
      fishPositions(s, p);
      expect(p.every(Number.isFinite)).toBe(true);
      let minX = 1e9;
      let maxX = -1e9;
      for (let i = 0; i < FISH_VERTS; i++) {
        minX = Math.min(minX, p[i * 3]);
        maxX = Math.max(maxX, p[i * 3]);
      }
      // nose at +x, tail fin behind the body
      expect(maxX).toBeGreaterThanOrEqual(s.len / 2 - 1e-6);
      expect(maxX).toBeLessThan(s.len / 2 + s.len * 0.25); // whiskers (laqqa) reach past the nose
      expect(minX).toBeLessThan(-s.len / 2);
      expect(minX).toBeGreaterThan(-s.len * 1.2);
    }
  });
  it("the body profile is thin at the tail, deepest near 38 % and closed at the nose", () => {
    expect(profile(0)).toBe(0);
    expect(profile(0.38)).toBeCloseTo(1, 5);
    expect(profile(1)).toBeCloseTo(0, 5);
    expect(profile(0.1)).toBeLessThan(profile(0.3));
  });
  it("swimming bends the tail more than the head and keeps x", () => {
    const sp = SPECIES[1];
    const base = new Float32Array(FISH_VERTS * 3);
    fishPositions(sp, base);
    const pos = new Float32Array(FISH_VERTS * 3);
    swimBend(base, pos, sp.len, 1.2, 1);
    let tailDz = 0;
    let headDz = 0;
    for (let i = 0; i < FISH_VERTS; i++) {
      const u = base[i * 3] / sp.len + 0.5;
      const dz = Math.abs(pos[i * 3 + 2] - base[i * 3 + 2]);
      expect(pos[i * 3]).toBe(base[i * 3]);
      if (u < 0.1) tailDz = Math.max(tailDz, dz);
      if (u > 0.9) headDz = Math.max(headDz, dz);
    }
    expect(tailDz).toBeGreaterThan(headDz);
  });
  it("builds the shared dynamic geometry and the junk items", () => {
    const g = makeFishGeometry();
    expect(g.getAttribute("position").count).toBe(FISH_VERTS);
    expect(g.getAttribute("uv").count).toBe(FISH_VERTS);
    for (const m of [makeBootGeometry(), makeBottleGeometry()]) {
      expect(m.getAttribute("position").count).toBeGreaterThan(30);
      expect(m.getAttribute("color")).toBeTruthy();
    }
  });
});

describe("world", () => {
  it("the lake bed is below the water, the shore above it, the bridge deck over the water", () => {
    expect(terrainHeight(LAKE, 0, -20)).toBeLessThan(-1);
    expect(terrainHeight(LAKE, 0, 20)).toBeGreaterThan(0.1);
    expect(terrainHeight(LAKE, 0, -20)).toBeCloseTo(-bedDepth(LAKE, 0, -20), 5);
    expect(BRIDGE.deckY).toBeGreaterThan(0.2);
    expect(bedDepth(LAKE, 0, BRIDGE.z0)).toBeGreaterThan(0.5);
  });
  it("the water grid is dense near the casting area", () => {
    const g = buildWaterGeometry(40);
    const p = g.getAttribute("position");
    expect(p.count).toBe(41 * 41);
    const xs = new Set<number>();
    for (let i = 0; i < p.count; i++) xs.add(Math.round(p.getX(i) * 100));
    const sorted = [...xs].sort((a, b) => a - b).map((v) => v / 100);
    const mid = sorted.length >> 1;
    expect(sorted[mid + 1] - sorted[mid]).toBeLessThan(sorted[sorted.length - 1] - sorted[sorted.length - 2]);
  });
  it("flattenModel merges the meshes of a loaded model into one geometry", () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshStandardMaterial());
    b.position.set(2, 0, 0);
    root.add(a, b);
    const f = flattenModel(root)!;
    expect(f.geometry.getAttribute("position").count).toBeGreaterThan(36);
    expect((f.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);
    f.geometry.computeBoundingBox();
    expect(f.geometry.boundingBox!.max.x).toBeGreaterThan(2);
    expect(flattenModel(new THREE.Group())).toBeNull();
  });
});

describe("rod and line meshes", () => {
  it("the rod tip moves up with the pitch and down with the bend; the length stays ROD_LEN", () => {
    const r = new RodMesh();
    r.update(0, 1.4, 4, 0, 0.5, 0, 0, 0);
    const straightY = r.tip.y;
    const len = Math.hypot(r.tip.x, r.tip.y - 1.4, r.tip.z - 4);
    expect(len).toBeCloseTo(ROD_LEN, 1);
    r.update(0, 1.4, 4, 0, 0.5, 1.2, 0, 0);
    expect(r.tip.y).toBeLessThan(straightY);
    r.update(0, 1.4, 4, 0.3, 0.5, 0, 0, 0);
    expect(r.tip.x).toBeGreaterThan(0.5);
    r.update(0, 1.4, 4, 0, 0.9, 0, 0, 0);
    expect(r.tip.y).toBeGreaterThan(straightY);
    r.blank.geometry.computeVertexNormals();
  });
  it("the line ribbon follows the points", () => {
    const rib = new LineRibbon(5);
    const x = new Float32Array([0, 1, 2, 3, 4]);
    const y = new Float32Array(5).fill(1);
    const z = new Float32Array(5).fill(-3);
    rib.update(x, y, z, new THREE.PerspectiveCamera());
    const p = rib.mesh.geometry.getAttribute("position");
    expect(p.count).toBe(10);
    expect(Math.abs(p.getX(8) - 4)).toBeLessThan(0.1);
    expect(Array.from(p.array).every(Number.isFinite)).toBe(true);
  });
});
