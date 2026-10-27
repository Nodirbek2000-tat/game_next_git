// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EXAM_NODES, examWaypoints, spawnFor } from "../logic/modes";
import { MODES } from "../config";
import { buildLayout, deckProfile, DECK_H, findRoute, nearestNode, surfaceAt, TILE, zoneAt } from "./layout";
import { radiiFor, TileManager } from "./tiles";

const L = buildLayout();

describe("layout (map as data)", () => {
  it("builds tiles from the ASCII rows and treats everything else as implicit field", () => {
    expect(L.tiles.get("0,0")!.kind).toBe("plaza");
    expect(L.tiles.get("6,1")!.kind).toBe("bridge");
    expect(L.tiles.get("9,2")!.kind).toBe("airfield");
    expect(L.specAt(40, -7).kind).toBe("field");
    expect(L.tileList.filter((t) => t.kind === "city")).toHaveLength(11);
  });

  it("a bigger map is only more rows", () => {
    const big = buildLayout(["CCC", "CCC", "CCC", "CCC"]);
    expect(big.tileList).toHaveLength(12);
    expect(big.rules.length).toBeGreaterThan(20);
  });

  it("roads connect: city -> highway -> bridge -> airfield, plaza only from the south", () => {
    const r = findRoute(L, "3,2", "9,1");
    expect(r[0]).toBe("3,2");
    expect(r.at(-1)).toBe("9,1");
    expect(r).toContain("6,1");
    expect(findRoute(L, "2,2", "0,0").at(-2)).toBe("0,1");
    expect(L.tiles.get("1,0")!.arms.w).toBe(false);
  });

  it("one-way street cannot be driven westwards by the router", () => {
    expect(findRoute(L, "3,2", "2,2").length).toBeGreaterThan(2); // must go around
    expect(findRoute(L, "2,2", "3,2")).toEqual(["2,2", "3,2"]);
  });

  it("edges are symmetrical except for the one-way street", () => {
    for (const e of L.edges) {
      const back = L.edges.find((b) => b.from === e.to && b.to === e.from);
      if (!back) expect(`${e.from}->${e.to}`).toBe("2,2->3,2");
    }
  });

  it("exam route exists and is short enough for a driving test", () => {
    const pts = examWaypoints(L);
    expect(pts.map((p) => p.name)).toEqual(EXAM_NODES);
    for (let i = 1; i < EXAM_NODES.length; i++) expect(L.adj.get(EXAM_NODES[i - 1])!.some((e) => e.to === EXAM_NODES[i])).toBe(true);
    const s = spawnFor(L, "imtihon");
    expect(surfaceAt(L, s.x, s.z)).toBe("asphalt");
  });

  it("every mode spawns on a drivable surface", () => {
    for (const m of MODES) {
      const s = spawnFor(L, m.id);
      expect(surfaceAt(L, s.x, s.z)).not.toBe("grass");
    }
  });

  it("surfaces and zones", () => {
    const t = L.tiles.get("2,1")!;
    expect(surfaceAt(L, t.cx, t.cz)).toBe("asphalt");
    expect(surfaceAt(L, t.cx + 20, t.cz + 20)).toBe("grass");
    expect(zoneAt(L, t.cx, t.cz)!.limit).toBe(60);
    expect(zoneAt(L, 700, 180)!.limit).toBe(90);
    expect(zoneAt(L, 1140, 200)!.kind).toBe("maydon");
    expect(zoneAt(L, 9000, 9000)).toBeNull();
  });

  it("bridge deck profile is continuous, flat over the river and 0 at the tile edges", () => {
    expect(deckProfile(60)).toBe(0);
    expect(deckProfile(0)).toBe(DECK_H);
    expect(deckProfile(-20)).toBe(DECK_H);
    let prev = deckProfile(-60);
    for (let x = -59; x <= 60; x++) {
      const y = deckProfile(x);
      expect(Math.abs(y - prev)).toBeLessThan(0.15); // < 15 % slope
      prev = y;
    }
  });

  it("nearestNode snaps to the closest intersection", () => {
    expect(nearestNode(L, 190, 190)!.id).toBe("1,1");
  });

  it("signs for every kind required by the TZ exist", () => {
    const kinds = new Set(L.signs.map((s) => s.kind));
    for (const k of ["limit", "stop", "giveWay", "zebra", "cityIn", "cityOut", "dir", "oneWay", "noEntry", "noStop"]) expect(kinds.has(k as never)).toBe(true);
  });
});

describe("tile manager (streaming)", () => {
  it("view distance grows with quality, in a sane range", () => {
    expect(radiiFor(0.5).load).toBeLessThan(radiiFor(0.75).load);
    expect(radiiFor(0.75).load).toBeLessThan(radiiFor(1).load);
    expect(radiiFor(1).load).toBeLessThan(450);
    expect(radiiFor(0.5).unload).toBeGreaterThan(radiiFor(0.5).load);
  });

  it("first plan loads the nearest tiles first, nothing to unload", () => {
    const tm = new TileManager(L);
    const plan = tm.plan(300, 180, 1);
    expect(plan.load.length).toBeGreaterThan(9);
    expect(plan.unload).toEqual([]);
    for (let i = 1; i < plan.load.length; i++) expect(plan.load[i].dist).toBeGreaterThanOrEqual(plan.load[i - 1].dist);
    expect(plan.load[0].dist).toBe(0);
    expect(plan.load[0].lod).toBe(0);
    expect(plan.load.at(-1)!.lod).toBe(1);
  });

  it("lower quality loads fewer tiles", () => {
    const hi = new TileManager(L).plan(300, 180, 1).load.length;
    const lo = new TileManager(L).plan(300, 180, 0.5).load.length;
    expect(lo).toBeLessThan(hi);
  });

  it("streams while driving east 1 km: loads ahead, releases behind, loaded set stays bounded", () => {
    const tm = new TileManager(L);
    let maxLoaded = 0;
    for (let x = 300; x <= 1300; x += 8) {
      const plan = tm.plan(x, 190, 1);
      for (const p of plan.load) tm.markLoaded(p.spec.id, p.lod);
      for (const id of plan.unload) tm.markUnloaded(id);
      for (const l of plan.lod) tm.markLoaded(l.id, l.lod);
      maxLoaded = Math.max(maxLoaded, tm.loaded.size);
      // the tile under the car is always there
      expect(tm.loaded.has(`${Math.floor(x / TILE)},1`)).toBe(true);
    }
    expect(maxLoaded).toBeLessThan(45);
    expect(tm.loaded.has("0,1")).toBe(false);
    expect(tm.loaded.has("10,1")).toBe(true);
  });

  it("is endless: far outside the manifest tiles are implicit fields", () => {
    const tm = new TileManager(L);
    const plan = tm.plan(-4000, 5000, 1);
    expect(plan.load.length).toBeGreaterThan(9);
    expect(plan.load.every((p) => p.spec.kind === "field")).toBe(true);
  });

  it("lod switches with hysteresis", () => {
    const tm = new TileManager(L);
    const plan = tm.plan(300, 180, 1);
    for (const p of plan.load) tm.markLoaded(p.spec.id, p.lod);
    const far = plan.load.find((p) => p.lod === 1)!;
    expect(tm.plan(300, 180, 1).lod).toEqual([]);
    // drive towards the far tile: it must become lod 0
    const px = far.spec.x0 + TILE / 2;
    const pz = far.spec.z0 + TILE / 2;
    const p2 = tm.plan(px, pz, 1);
    expect(p2.lod.find((l) => l.id === far.spec.id)?.lod).toBe(0);
  });
});
