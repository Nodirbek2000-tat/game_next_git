import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { accessoryGeometry, bodyGeometry, bombGeometry, capGeometry, capRadius, FRUIT_IDS, halfGeometry } from "./geometry";
import { FRUIT_DEFS } from "./logic";
import { hasModels, parseManifest } from "./models";
import { parseMode } from "./mode";

const seg = { nu: 20, nv: 10 };

function outwardShare(g: THREE.BufferGeometry): number {
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  let ok = 0;
  const v = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(c);
    nn.fromBufferAttribute(n, i);
    if (v.dot(nn) > 0) ok++;
  }
  return ok / p.count;
}

describe("procedural fruit geometry", () => {
  it("covers exactly the eight fruits of the game, in the same order", () => {
    expect(FRUIT_IDS).toEqual(FRUIT_DEFS.map((d) => d.id));
    expect(FRUIT_IDS).toHaveLength(8);
  });

  for (const id of FRUIT_IDS) {
    it(`${id}: finite vertices, unit normals pointing outwards, bounded size`, () => {
      const g = bodyGeometry(id, seg);
      const p = g.getAttribute("position");
      const n = g.getAttribute("normal");
      for (let i = 0; i < p.count; i++) {
        expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeGreaterThan(0.99);
      }
      expect(outwardShare(g)).toBeGreaterThan(0.9);
      g.computeBoundingSphere();
      // the collision radius is about 1 model unit: the fruit must stay near it
      expect(g.boundingSphere!.radius).toBeGreaterThan(0.7);
      expect(g.boundingSphere!.radius).toBeLessThan(1.45);
    });

    it(`${id}: half sits on y >= 0 with its cut face at y = 0 looking down`, () => {
      const h = halfGeometry(id, seg);
      h.computeBoundingBox();
      expect(h.boundingBox!.min.y).toBeGreaterThan(-0.2);
      expect(h.boundingBox!.max.y).toBeGreaterThan(0.4);
      const cap = capGeometry(id, 16);
      const nrm = cap.getAttribute("normal");
      expect(nrm.getY(0)).toBeLessThan(-0.99);
      expect(capRadius(id)).toBeGreaterThan(0.1);
    });
  }

  it("accessories are one merged mesh with vertex colours (or none)", () => {
    for (const id of FRUIT_IDS) {
      const a = accessoryGeometry(id);
      if (!a) continue;
      expect(a.getAttribute("color")).toBeDefined();
      expect(a.getAttribute("position").count).toBeGreaterThan(8);
    }
    expect(accessoryGeometry("kivi")).toBeNull();
  });

  it("the bomb is a single mesh with a fuse above the body", () => {
    const b = bombGeometry(seg);
    b.computeBoundingBox();
    expect(b.boundingBox!.max.y).toBeGreaterThan(1.6);
    expect(b.getAttribute("color")).toBeDefined();
  });
});

describe("assets.json / models manifest", () => {
  it("parses the bundled manifest: every fruit listed, no model yet (procedural fallback)", async () => {
    const raw = (await import("./assets.json")).default;
    const m = parseManifest(raw);
    expect(Object.keys(m.fruits).sort()).toEqual([...FRUIT_IDS].sort());
    expect(hasModels(m)).toBe(false);
  });

  it("accepts same-origin model paths only and ignores garbage", () => {
    const m = parseManifest({ fruits: { olma: { whole: "/models/ninja/olma.glb", half: "https://evil.example/x.glb", scale: 1.2 }, kivi: 5 }, bomb: { whole: "//evil.example/b.glb" } });
    expect(m.fruits.olma.whole).toBe("/models/ninja/olma.glb");
    expect(m.fruits.olma.half).toBeNull();
    expect(m.fruits.olma.scale).toBe(1.2);
    expect(m.fruits.kivi.whole).toBeNull();
    expect(m.bomb.whole).toBeNull();
    expect(hasModels(m)).toBe(true);
    expect(hasModels(parseManifest(null))).toBe(false);
  });

  it("mode query values", () => {
    expect(parseMode("xona")).toBe("xona");
    expect(parseMode("PARTY")).toBe("xona");
    expect(parseMode("oddiy")).toBe("oddiy");
    expect(parseMode("boshqa")).toBeNull();
  });
});
