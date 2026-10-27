// @vitest-environment node
import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { CARS, type CarId } from "../config";
import { RaycastCar, type DriveInput } from "./vehicle";

beforeAll(async () => {
  await RAPIER.init();
});

function make(id: CarId) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setFriction(1), g);
  const car = new RaycastCar(RAPIER, world, CARS[id], 0, 0.9, 0, 0);
  const run = (sec: number, input: Partial<DriveInput> | ((t: number) => Partial<DriveInput>), each?: (t: number) => void) => {
    const n = Math.round(sec * 60);
    for (let k = 0; k < n; k++) {
      const t = k / 60;
      Object.assign(car.input, typeof input === "function" ? input(t) : input);
      car.update(1 / 60, { surface: 1, wet: 0 });
      world.step();
      each?.(t);
    }
  };
  return { world, car, run };
}

describe("raycast car", () => {
  it("settles on its suspension and stays upright", () => {
    const { car, run } = make("sedan");
    run(2, { gas: 0, brake: 0, steer: 0, handbrake: false, reverse: false });
    const y = car.body.translation().y;
    console.log("settled y", y.toFixed(3), "susp", car.wheelSusp.map((x) => x.toFixed(3)).join(","));
    expect(y).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(1.1);
    expect(car.grounded).toBe(4);
    expect(Math.abs(car.speed)).toBeLessThan(0.1);
  });

  it("accelerates forward (+z), brakes to a stop", () => {
    const { car, run } = make("sedan");
    run(1, {});
    run(6, { gas: 1 });
    const v = car.speed;
    console.log("sedan after 6 s full gas", v.toFixed(1), "m/s", (v * 3.6).toFixed(0), "km/h");
    expect(v).toBeGreaterThan(12);
    expect(car.body.translation().z).toBeGreaterThan(20);
    run(5, { gas: 0, brake: 1 });
    expect(Math.abs(car.speed)).toBeLessThan(0.5);
  });

  for (const id of ["sedan", "krossover", "sport"] as CarId[]) {
    it(`${id}: top speed and 0-100 km/h`, () => {
      const { car, run } = make(id);
      run(0.5, {});
      let t100 = -1;
      run(25, { gas: 1 }, (t) => {
        if (t100 < 0 && car.speed * 3.6 >= 100) t100 = t;
      });
      console.log(id, "0-100:", t100.toFixed(1), "s; top", (car.speed * 3.6).toFixed(0), "km/h");
      expect(car.speed).toBeGreaterThan(20);
    });
  }

  it("full brake stops a 20 m/s car within ~28 m (about 7 m/s^2 or better)", () => {
    const { car, run } = make("sedan");
    run(1, {});
    run(10, () => ({ gas: Math.max(0, Math.min(1, (20 - car.speed) / 3)) }));
    const z0 = car.body.translation().z;
    let t = -1;
    run(8, { gas: 0, brake: 1 }, (tt) => {
      if (t < 0 && car.speed < 0.3) t = tt;
    });
    const d = car.body.translation().z - z0;
    const tr: string[] = [];
    {
      const w2 = make("sedan");
      w2.run(1, {});
      w2.run(10, () => ({ gas: Math.max(0, Math.min(1, (20 - w2.car.speed) / 3)) }));
      w2.run(1.2, { gas: 0, brake: 1 }, (tt) => {
        if (Math.round(tt * 60) % 6 === 0) tr.push(w2.car.speed.toFixed(1));
      });
    }
    console.log("brake from 20 m/s: stop after", t.toFixed(2), "s and", d.toFixed(1), "m; speeds every 0.1 s", tr.join(" "));
    expect(t).toBeGreaterThan(0);
    expect(d).toBeLessThan(32);
  });

  it("brakes just as well after a teleport (place() rebuilds the controller)", () => {
    const { car, run } = make("sedan");
    run(0.5, {});
    car.place(50, 0.9, 50, 0);
    run(1, {});
    run(8, () => ({ gas: Math.max(0, Math.min(1, (9 - car.speed) / 3)) }));
    const v0 = car.speed;
    run(1, { gas: 0, brake: 1 });
    console.log("after place: v", v0.toFixed(1), "->", car.speed.toFixed(1));
    expect(car.speed).toBeLessThan(v0 - 5);
  });

  it("steers", () => {
    const { car, run } = make("sedan");
    run(1, {});
    run(4, { gas: 0.6 });
    const z0 = car.fz;
    run(1.5, { gas: 0.4, steer: 1 });
    console.log("steer +1: forward before", z0.toFixed(2), "after fx,fz", car.fx.toFixed(2), car.fz.toFixed(2), "yawRate", car.yawRate.toFixed(2));
    expect(Math.abs(car.fx)).toBeGreaterThan(0.1);
  });

  it("reverses", () => {
    const { car, run } = make("sedan");
    run(1, {});
    run(3, { gas: 1, reverse: true });
    console.log("reverse speed", car.speed.toFixed(1));
    expect(car.speed).toBeLessThan(-2);
  });

  const drift = (id: CarId, v0: number, hb: boolean, steer: number) => {
    const { car, run } = make(id);
    run(1, {});
    run(8, () => ({ gas: Math.max(0, Math.min(1, (v0 - car.speed) / 3)) }));
    const slips: number[] = [];
    run(3, (t) => ({ gas: 0.8, steer: t < 1.2 ? steer : 0, handbrake: hb && t < 0.7 }), () => slips.push((car.slip * 180) / Math.PI));
    return { slips, car };
  };

  it("handbrake on the sport car makes a drift (slip angle)", () => {
    const { slips, car } = drift("sport", 18, true, 0.8);
    const m = Math.max(...slips.map(Math.abs));
    console.log("traj", slips.filter((_, i) => i % 12 === 0).map((x) => x.toFixed(0)).join(" "));
    console.log("sport handbrake drift max", m.toFixed(0), "end", slips[slips.length - 1].toFixed(0), "speed", (car.speed * 3.6).toFixed(0));
    expect(m).toBeGreaterThan(15);
  });
  for (const [id, min] of [["sport", 25], ["sedan", 14]] as [CarId, number][]) {
    it(`${id}: a 0.9 s handbrake pull while turning starts a drift (>${min} deg) that ends in control`, () => {
      const { car, run } = make(id);
      run(1, {});
      run(8, () => ({ gas: Math.max(0, Math.min(1, (18 - car.speed) / 3)) }));
      const slips: number[] = [];
      run(4, (t) => ({ gas: 0.5, steer: t < 1.2 ? 0.7 : 0, handbrake: t < 0.9 }), () => slips.push(Math.abs((car.slip * 180) / Math.PI)));
      console.log(id, "pull", slips.filter((_, i) => i % 15 === 0).map((x) => x.toFixed(0)).join(" "), "speed", (car.speed * 3.6).toFixed(0));
      expect(Math.max(...slips)).toBeGreaterThan(min);
      expect(Math.max(...slips)).toBeLessThan(110);
      expect(slips[slips.length - 1]).toBeLessThan(20);
    });
  }
  it("sedan without handbrake does not drift at the same speed", () => {
    const { slips } = drift("sedan", 18, false, 0.8);
    const m = Math.max(...slips.map(Math.abs));
    console.log("sedan no-handbrake max slip", m.toFixed(0));
    expect(m).toBeLessThan(25);
  });
});
