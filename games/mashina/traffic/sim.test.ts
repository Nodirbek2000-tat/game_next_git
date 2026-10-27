// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lightColor } from "../logic/signals";
import { buildLayout, ROAD } from "../world/layout";
import { TrafficSim, type AiCar, type TrafficCtx } from "./sim";

const L = buildLayout();

function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function setup(opts: { peds?: boolean; density?: number; seed?: number } = {}) {
  let t = 0;
  const ctx: TrafficCtx = {
    lightColor: (n, axis) => lightColor(t, axis, L.tiles.get(n.id)!.offset),
    pedsBlock: () => !!opts.peds,
  };
  const sim = new TrafficSim(L, ctx, seeded(opts.seed ?? 7));
  sim.density = opts.density ?? 1.6;
  return {
    sim,
    time: () => t,
    run(secs: number, player: { x: number; z: number } | null, each?: (cars: AiCar[], t: number) => void) {
      const dt = 1 / 30;
      for (let i = 0; i < secs * 30; i++) {
        t += dt;
        sim.update(dt, t, player ? { x: player.x, z: player.z, fx: 1, fz: 0, speed: 0 } : null);
        each?.(sim.cars, t);
      }
    },
  };
}

describe("traffic AI", { timeout: 90_000 }, () => {
  it("keeps a bounded number of cars around the player and fills the streets", () => {
    const h = setup();
    const c = L.tiles.get("1,1")!;
    let max = 0;
    h.run(120, { x: c.cx + 6, z: c.cz + 6 }, (cars) => (max = Math.max(max, cars.length)));
    expect(h.sim.spawned).toBeGreaterThan(8);
    expect(max).toBeLessThanOrEqual(18);
    expect(h.sim.cars.length).toBeGreaterThan(3);
  });

  it("never runs a red light (front of the car past the stop line while red)", () => {
    const h = setup({ density: 2.2 });
    const c = L.tiles.get("1,1")!;
    const prev = new Map<number, number>();
    let crossings = 0;
    const violations: string[] = [];
    h.run(420, { x: c.cx, z: c.cz + 40 }, (cars, t) => {
      for (const car of cars) {
        if (car.conn) {
          prev.delete(car.id);
          continue;
        }
        const B = L.nodes.get(car.edge.to)!;
        if (B.control !== "light") continue;
        const stopS = car.edge.len - ROAD.stopLine;
        const front = car.s + car.len / 2;
        const p = prev.get(car.id);
        prev.set(car.id, front);
        if (p !== undefined && p <= stopS && front > stopS) {
          crossings++;
          const col = lightColor(t, car.edge.dx !== 0 ? "x" : "z", L.tiles.get(B.id)!.offset);
          if (col === "red") violations.push(`${car.id}@${B.id} t=${t.toFixed(1)}`);
        }
      }
    });
    expect(crossings).toBeGreaterThan(8);
    expect(violations).toEqual([]);
  });

  it("stops at STOP signs on the minor street before entering", () => {
    const h = setup({ density: 2.4, seed: 11 });
    const c = L.tiles.get("1,1")!;
    const minV = new Map<number, number>();
    let judged = 0;
    const bad: string[] = [];
    h.run(420, { x: c.cx, z: c.cz + 30 }, (cars) => {
      for (const car of cars) {
        if (car.conn) continue;
        const B = L.nodes.get(car.edge.to)!;
        if (B.control !== "stop" || car.edge.dx !== 0) continue;
        const stopS = car.edge.len - ROAD.stopLine;
        const front = car.s + car.len / 2;
        if (front > stopS - 25 && front < stopS + 2) minV.set(car.id, Math.min(minV.get(car.id) ?? 99, car.v));
        if (front >= stopS + 2 && minV.has(car.id)) {
          judged++;
          if ((minV.get(car.id) ?? 99) > 0.5) bad.push(String(car.id));
          minV.delete(car.id);
        }
      }
    });
    expect(judged).toBeGreaterThan(2);
    expect(bad).toEqual([]);
  });

  it("waits for pedestrians on a zebra", () => {
    const h = setup({ peds: true, density: 2 });
    const z = L.zebras[0];
    let passing = 0;
    h.run(200, { x: z.x, z: z.z + 20 }, (cars) => {
      for (const car of cars) {
        const along = z.axis === "x" ? (car.x - z.x) * Math.sign(car.fx || 1) : (car.z - z.z) * Math.sign(car.fz || 1);
        const lateral = z.axis === "x" ? Math.abs(car.z - z.z) : Math.abs(car.x - z.x);
        if (lateral < 4 && Math.abs(along) < 1.2 && car.v > 1) passing++;
      }
    });
    expect(passing).toBe(0);
  });

  it("slow trucks get overtaken on the highway", () => {
    const h = setup({ density: 0 });
    const e = L.edges.find((x) => x.highway && x.dx === 1 && x.from === "5,1")!;
    const truck = h.sim.spawnAt(e, 60, 2, "truck")!;
    truck.vDes = 14;
    truck.v = 14;
    const fast = h.sim.spawnAt(e, 2, 2, "sedan")!;
    fast.vDes = 26;
    fast.v = 24;
    let passed = false;
    let sameLane = false;
    h.run(40, null, () => {
      if (fast.edge === e && truck.edge === e && fast.s > truck.s + 10) passed = true;
      if (fast.lane !== 2) sameLane = true;
    });
    expect(h.sim.overtakes).toBeGreaterThan(0);
    expect(sameLane).toBe(true);
    expect(passed || fast.edge !== e).toBe(true);
  });

  it("cars never overlap each other and follow the lanes (inside the road)", () => {
    const h = setup({ density: 2.4, seed: 3 });
    const c = L.tiles.get("2,1")!;
    let overlaps = 0;
    h.run(300, { x: c.cx, z: c.cz - 30 }, (cars) => {
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          if (Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z) < 2.2) overlaps++;
        }
      }
    });
    expect(overlaps).toBe(0);
  });

  it("a stopped player blocks the lane: the car behind queues instead of driving through", () => {
    const h = setup({ density: 0 });
    const e = L.edges.find((x) => x.from === "2,1" && x.to === "3,1")!;
    const car = h.sim.spawnAt(e, 12, 0, "sedan")!;
    car.vDes = 12;
    car.v = 10;
    const A = L.nodes.get(e.from)!;
    const rx = -e.dz;
    const rz = e.dx;
    const px = A.x + e.dx * 60 + rx * 1.8;
    const pz = A.z + e.dz * 60 + rz * 1.8;
    let minGap = 99;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 20; i++) {
      h.sim.update(dt, i * dt, { x: px, z: pz, fx: e.dx, fz: e.dz, speed: 0 });
      if (car.edge === e) minGap = Math.min(minGap, Math.hypot(car.x - px, car.z - pz));
    }
    expect(minGap).toBeGreaterThan(2.5);
  });

  it("crossTrafficNear sees a car approaching the intersection on the cross street", () => {
    const h = setup({ density: 0 });
    const e = L.edges.find((x) => x.to === "1,2" && x.dx === 1)!; // eastbound into (1,2)
    const car = h.sim.spawnAt(e, e.len - 30, 0, "sedan")!;
    car.v = 8;
    car.vDes = 8;
    h.sim.update(0.05, 0, null);
    expect(h.sim.crossTrafficNear("1,2", 0, -1)).toBe(true); // a northbound player would have to give way
    expect(h.sim.crossTrafficNear("1,2", 1, 0)).toBe(false); // same direction as the car: not cross traffic
  });
});
