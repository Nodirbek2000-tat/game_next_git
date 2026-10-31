import { describe, expect, it } from "vitest";
import { CARS } from "./config";
import { Car } from "./carSim";
import { HW, PITCH, STOP, blockKind, groundY, isField, onRoad, plan, segZ, signal } from "./city";
import { City } from "./traffic";

const idle = { gas: 0, brake: 0, steer: 0, handbrake: false, reverse: false };
const run = (car: Car, s: number, c: Partial<typeof idle>) => {
  for (let i = 0; i < s * 240; i++) car.step(1 / 240, { ...idle, ...c });
};

describe("city plan", () => {
  it("is deterministic and keeps buildings off the streets", () => {
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) {
        const a = plan(i, j);
        expect(plan(i, j)).toBe(a);
        expect(blockKind(i, j)).toBe(a.kind);
        for (const b of a.buildings) {
          for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z1], [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]]) expect(onRoad(x + 0.01, z + 0.01)).toBe(false);
        }
      }
  });

  it("streets are asphalt (y 0), blocks are raised by the curb", () => {
    expect(onRoad(0, 50)).toBe(true);
    expect(onRoad(50, PITCH)).toBe(true);
    expect(onRoad(60, 60)).toBe(false);
    expect(groundY(2, 60)).toBe(0);
    expect(groundY(60, 60)).toBeGreaterThan(0);
  });

  it("open fields: big meadows with no buildings and no streets inside", () => {
    let fields = 0;
    for (let i = -20; i <= 20; i++)
      for (let j = -20; j <= 20; j++) {
        if (!isField(i, j)) continue;
        fields++;
        expect(plan(i, j).buildings.length).toBe(0);
        if (isField(i - 1, j)) {
          expect(segZ(i, j)).toBe(false);
          // the meadow between the two blocks is grass, not asphalt
          expect(onRoad(i * PITCH, j * PITCH + PITCH / 2)).toBe(false);
        }
      }
    expect(fields).toBeGreaterThan(30);
    // street trees survive the filters; nothing stands on the asphalt
    let street = 0;
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++)
        for (const p of plan(i, j).posts) {
          if (p.kind === "rim" || p.kind === "light") continue;
          expect(onRoad(p.x, p.z)).toBe(false);
          if (p.sp === "kocha") street++;
        }
    expect(street).toBeGreaterThan(100);
    expect(isField(0, 0)).toBe(false);
  });

  it("traffic lights: the two axes are never green together", () => {
    for (let t = 0; t < 60; t += 0.25) expect(signal("x", 2, 3, t) === 2 && signal("z", 2, 3, t) === 2).toBe(false);
  });
});

describe("car physics", () => {
  it("accelerates through the gears and stops with the brakes", () => {
    const car = new Car(CARS.boron.phys);
    car.place(0, 0, 0);
    run(car, 4, { gas: 1 });
    expect(car.speed * 3.6).toBeGreaterThan(90);
    expect(car.gear).toBeGreaterThan(1);
    expect(car.z).toBeGreaterThan(30);
    expect(Math.abs(car.x)).toBeLessThan(0.5);
    run(car, 4, { brake: 1 });
    expect(car.speed).toBeLessThan(0.5);
  });

  it("steering right turns right (heading decreases) and the top speed is bounded by drag", () => {
    const car = new Car(CARS.sport.phys);
    car.place(0, 0, 0);
    run(car, 2, { gas: 0.6 });
    const h0 = car.h;
    run(car, 1, { gas: 0.4, steer: 1 });
    expect(car.h).toBeLessThan(h0 - 0.3);
    const top = new Car(CARS.sport.phys);
    top.place(0, 0, 0);
    run(top, 40, { gas: 1 });
    expect(top.speed * 3.6).toBeGreaterThan(220);
    expect(top.speed * 3.6).toBeLessThan(340);
  });

  it("stability control: after a hard turn at speed the car stops rotating when the wheel is straight", () => {
    const car = new Car(CARS.boron.phys);
    car.place(0, 0, 0);
    run(car, 3, { gas: 1 });
    run(car, 0.8, { gas: 1, steer: -1 });
    run(car, 1.5, { gas: 1 });
    expect(Math.abs(car.w)).toBeLessThan(0.08);
    expect(car.speed).toBeGreaterThan(10);
  });

  it("normal driving does not slide (no smoke / marks): full throttle, a normal bend", () => {
    const car = new Car(CARS.boron.phys);
    car.place(0, 0, 0);
    let worst = 0;
    for (let i = 0; i < 240 * 4; i++) {
      car.step(1 / 240, { ...idle, gas: 1 });
      worst = Math.max(worst, car.slipR, car.wheelspin);
    }
    // a normal bend at city speed (~80-90 km/h)
    while (car.speed > 24) car.step(1 / 240, { ...idle, brake: 0.5 });
    for (let i = 0; i < 240 * 2; i++) {
      car.step(1 / 240, { ...idle, gas: 0.3, steer: 0.3 });
      worst = Math.max(worst, car.slipR, car.wheelspin);
    }
    expect(worst).toBeLessThan(0.17);
  });

  it("a sudden full lock at speed does slide (smoke + marks)", () => {
    const car = new Car(CARS.boron.phys);
    car.place(0, 0, 0);
    car.assist = true;
    let worst = 0;
    for (let i = 0; i < 240 * 3; i++) car.step(1 / 240, { ...idle, gas: 1 });
    for (let i = 0; i < 240 * 1; i++) {
      car.step(1 / 240, { ...idle, gas: 0.6, steer: 1 });
      worst = Math.max(worst, car.slipR, car.slipF);
    }
    expect(worst).toBeGreaterThan(0.17);
  });

  it("a handbrake turn slides the tail (smoke + marks) and the car recovers afterwards", () => {
    const car = new Car(CARS.boron.phys);
    car.place(0, 0, 0);
    run(car, 3, { gas: 0.8 });
    let maxSlip = 0;
    for (let i = 0; i < 240 * 0.8; i++) {
      car.step(1 / 240, { ...idle, gas: 0.5, steer: 1, handbrake: true });
      maxSlip = Math.max(maxSlip, car.slip);
    }
    expect(maxSlip).toBeGreaterThan(0.3);
    run(car, 2, { gas: 0.3 });
    expect(Math.abs(car.w)).toBeLessThan(0.15);
  });

  it("reverse gear drives backwards", () => {
    const car = new Car(CARS.boron.phys);
    car.place(0, 0, 0);
    run(car, 2, { gas: 0.5, reverse: true });
    expect(car.vLong).toBeLessThan(-2);
    expect(car.gear).toBe(-1);
  });

  it("a wall stops the car and reports the impact", () => {
    const car = new Car(CARS.boron.phys);
    car.place(0, 0, 0);
    car.vz = 20;
    const wall = [{ x0: -10, z0: 5, x1: 10, z1: 8 }];
    let hit = 0;
    for (let i = 0; i < 240; i++) {
      car.step(1 / 240, idle);
      const h = car.collide(wall, []);
      if (h) hit = Math.max(hit, h.speed);
    }
    expect(hit).toBeGreaterThan(10);
    expect(car.z + CARS.boron.phys.len / 2).toBeLessThan(5.2);
    expect(Math.abs(car.vz)).toBeLessThan(10);
  });
});

describe("traffic", () => {
  it("keeps a few cars on the streets, in lanes, and stops at red lights", () => {
    const city = new City(8, 10, 3);
    let stoppedAtRed = 0;
    for (let k = 0; k < 60 * 90; k++) {
      // the "player" stands inside a block (not in anybody's lane)
      city.step(1 / 60, 60, 60, { x: 0, z: 0 });
      if (k % 30 === 0)
        for (const c of city.cars) {
          if (c.turn) continue;
          // on the asphalt, near a lane line
          expect(onRoad(c.x, c.z)).toBe(true);
          const lane = c.axis === "z" ? c.x - Math.round(c.x / PITCH) * PITCH : c.z - Math.round(c.z / PITCH) * PITCH;
          expect([1.75, 5.25]).toContain(Math.round(Math.abs(lane) * 100) / 100);
          if (c.v < 0.2) stoppedAtRed++;
        }
    }
    expect(city.cars.length).toBe(8);
    expect(stoppedAtRed).toBeGreaterThan(0);
    // nobody parked inside a crossroads box at a standstill for long: cars that stop do it before the stop line
    for (const c of city.cars) {
      if (c.turn || c.v > 0.2) continue;
      const along = c.axis === "z" ? c.z : c.x;
      const toJunction = Math.abs(along - Math.round(along / PITCH) * PITCH);
      expect(toJunction).toBeGreaterThan(HW + STOP - 0.1);
    }
  });
});

describe("the bent world", () => {
  it("unwarp inverts warp and the streets really bend", async () => {
    const { unwarp, warpX, warpZ, unwarpDir, warpDir } = await import("./city");
    for (const [x, z] of [[0, 0], [130, -470], [-900, 1234], [55.5, 3000]]) {
      const [px, pz] = unwarp(warpX(x, z), warpZ(x, z));
      expect(px).toBeCloseTo(x, 4);
      expect(pz).toBeCloseTo(z, 4);
      const [dx, dz] = warpDir(x, z, 0.3, 0.8);
      const [bx, bz] = unwarpDir(x, z, dx, dz);
      expect(bx).toBeCloseTo(0.3, 6);
      expect(bz).toBeCloseTo(0.8, 6);
    }
    // the street x = 0 is not a straight line in the world
    const xs = [0, 200, 400, 600].map((z) => warpX(0, z));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5);
  });
});

describe("quality levels", () => {
  it("every number gets cheaper from high to low", async () => {
    const { LOD, effectiveLevel, squeeze } = await import("./config");
    const keys = ["tileR", "farR", "towerR", "fogFar", "treeR", "treeNear", "treeFar", "propR", "cars", "peds", "aniso", "workMs"] as const;
    for (const k of keys) {
      expect(LOD.high[k]).toBeGreaterThanOrEqual(LOD.medium[k]);
      expect(LOD.medium[k]).toBeGreaterThanOrEqual(LOD.low[k]);
    }
    // the lite level loads no tower, tree or prop models
    expect(LOD.low.towerR).toBe(0);
    expect(LOD.low.treeNear).toBe(0);
    expect(LOD.low.propR).toBe(0);
    // the post pipeline (ambient occlusion and the rest) is high only
    expect(LOD.low.post).toBe(false);
    expect(LOD.medium.post).toBe(false);
    expect(LOD.high.post).toBe(true);
    // never above the level the scene was built for
    expect(effectiveLevel("low", "high")).toBe("low");
    expect(effectiveLevel("high", "medium")).toBe("medium");
    // the controller's emergency squeeze shortens the view; no squeeze = 1
    expect(squeeze("low", 0.5)).toBe(1);
    expect(squeeze("low", 0.375)).toBeCloseTo(0.75, 5);
  });

  it("traffic counts change while it runs", () => {
    const city = new City(8, 10, 3);
    for (let k = 0; k < 120; k++) city.step(1 / 60, 60, 60, { x: 0, z: 0 });
    city.setCounts(3, 4);
    expect(city.cars.length).toBe(3);
    expect(city.peds.length).toBe(4);
    for (let k = 0; k < 120; k++) city.step(1 / 60, 60, 60, { x: 0, z: 0 });
    expect(city.cars.length).toBe(3);
    city.setCounts(6, 8);
    for (let k = 0; k < 120; k++) city.step(1 / 60, 60, 60, { x: 0, z: 0 });
    expect(city.cars.length).toBe(6);
    expect(city.peds.length).toBe(8);
  });
});

describe("streaming", () => {
  // a renderer that is just enough for the constructors (no WebGL in the tests)
  const fakeGl = { capabilities: { getMaxAnisotropy: () => 16 }, initTexture: () => {} } as unknown as import("three").WebGLRenderer;
  const stubCanvas = () => {
    const ctx = new Proxy({}, { get: (_t, k) => (k === "createImageData" ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}) });
    (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;
  };

  it("city tiles are queued, the ones under the car first, the rest within a time budget", async () => {
    stubCanvas();
    const { CityView } = await import("./cityView");
    const view = new CityView(fakeGl, "high", false);
    view.update(-1.75, 46, 0);
    expect(view.count).toBe(0);
    expect(view.pending).toBe(49);
    view.work(0);
    // only what the car stands on / touches (the road under it)
    expect(view.count).toBeGreaterThanOrEqual(1);
    expect(view.count).toBeLessThanOrEqual(3);
    // a time budget in the past builds nothing more
    const had = view.count;
    view.work(performance.now() - 1);
    expect(view.count).toBe(had);
    // a budget in the future finishes the ring
    view.work(performance.now() + 1e6);
    expect(view.count).toBe(49);
    expect(view.pending).toBe(0);
    // a smaller radius (the controller stepped down) drops the far tiles at the next update
    view.setRadius(1);
    view.update(-1.75, 46, 0.2);
    expect(view.count).toBeLessThanOrEqual(25);
    view.work(performance.now() + 1e6);
    expect(view.count).toBeLessThanOrEqual(25);
    expect(view.pending).toBe(0);
    view.dispose();
  });

  it("the far city is built chunk by chunk, plain boxes stand in for the towers on the lite level", async () => {
    const { Skyline } = await import("./skyline");
    const pre = async () => {};
    const sky = new Skyline(fakeGl, "low", pre);
    // the first update builds nothing: the work is queued
    sky.update(0, 0);
    expect(sky.chunks).toBe(0);
    sky.work(performance.now() + 1e6);
    // low: 2 chunks around the car in each direction = 5 x 5
    expect(sky.chunks).toBe(25);
    sky.setLod(1, 0);
    sky.update(0, 0);
    expect(sky.chunks).toBe(9);
    sky.dispose();
    const high = new Skyline(fakeGl, "high", pre);
    high.update(0, 0);
    high.work(performance.now() + 1e6);
    expect(high.chunks).toBe(49);
    high.dispose();
  });
});
