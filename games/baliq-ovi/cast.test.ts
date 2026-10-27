import { describe, expect, it } from "vitest";
import { castPos, fillTrail, flightTime, newCastPlan, planCast, RodWhip } from "./cast";
import { FightModel, counterPull } from "./rules";
import { SPECIES_BY_ID } from "./species";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

describe("cast trajectory", () => {
  const tip = { x: 0.3, y: 3.4, z: 3.8 };
  const plan = (tx: number, tz: number, power: number) => planCast(tip.x, tip.y, tip.z, tx, tz, 0, power, newCastPlan());

  it("starts at the rod tip and lands exactly on the target at the water level", () => {
    const p = plan(10, -22, 0.8);
    const o = { x: 0, y: 0, z: 0 };
    castPos(p, 0, o);
    expect(o).toEqual({ x: tip.x, y: tip.y, z: tip.z });
    castPos(p, p.T, o);
    expect(o.x).toBeCloseTo(10, 5);
    expect(o.z).toBeCloseTo(-22, 5);
    expect(o.y).toBeCloseTo(0, 4);
  });
  it("flies in a real arc: rises above the launch height, then falls, never goes under water before landing", () => {
    const p = plan(0, -30, 1);
    const o = { x: 0, y: 0, z: 0 };
    let maxY = -1;
    let prev = tip.y;
    let rising = true;
    let turned = 0;
    for (let t = 0; t <= p.T; t += p.T / 80) {
      castPos(p, t, o);
      maxY = Math.max(maxY, o.y);
      if (rising && o.y < prev) {
        rising = false;
        turned++;
      }
      if (!rising) expect(o.y).toBeLessThanOrEqual(prev + 1e-9);
      expect(o.y).toBeGreaterThanOrEqual(-1e-6);
      prev = o.y;
    }
    expect(turned).toBe(1);
    expect(maxY).toBeGreaterThan(tip.y + p.apex * 0.9);
    expect(p.apex).toBeGreaterThan(4); // a long cast flies high
  });
  it("a harder flick throws further and keeps the float in the air longer; the flight is never absurd", () => {
    expect(flightTime(36, 1)).toBeGreaterThan(flightTime(8, 0.3));
    expect(flightTime(8, 0.3)).toBeGreaterThanOrEqual(0.9);
    expect(flightTime(500, 1)).toBeLessThanOrEqual(2.3);
    const far = plan(0, -34, 1);
    const near = plan(0, -12, 0.3);
    expect(far.T).toBeGreaterThan(near.T);
    expect(far.apex).toBeGreaterThan(near.apex);
  });
  it("the side comes from the target: a target to the left lands to the left", () => {
    const o = { x: 0, y: 0, z: 0 };
    const l = plan(-12, -20, 0.7);
    const r = plan(12, -20, 0.7);
    castPos(l, l.T * 0.6, o);
    expect(o.x).toBeLessThan(tip.x);
    castPos(r, r.T * 0.6, o);
    expect(o.x).toBeGreaterThan(tip.x);
  });
  it("the line trails along the flown path: one end at the rod tip, the other at the float", () => {
    const p = plan(5, -26, 0.9);
    const n = 30;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const zs = new Float32Array(n);
    const t = p.T * 0.5;
    const len = fillTrail(p, t, tip.x, tip.y, tip.z, xs, ys, zs, n);
    const o = { x: 0, y: 0, z: 0 };
    castPos(p, t, o);
    expect(xs[0]).toBeCloseTo(tip.x, 4);
    expect(ys[0]).toBeCloseTo(tip.y, 4);
    expect(xs[n - 1]).toBeCloseTo(o.x, 4);
    expect(zs[n - 1]).toBeCloseTo(o.z, 4);
    expect(len).toBeGreaterThan(Math.hypot(o.x - tip.x, o.z - tip.z)); // longer than the straight chord (it is an arc)
    // when the rod tip has moved, the end at the rod follows it
    fillTrail(p, t, tip.x + 0.5, tip.y - 0.4, tip.z, xs, ys, zs, n);
    expect(xs[0]).toBeCloseTo(tip.x + 0.5, 4);
    expect(ys[0]).toBeCloseTo(tip.y - 0.4, 4);
  });
});

describe("rod whip", () => {
  const settle = (w: RodWhip, seconds: number) => {
    let flips = 0;
    let last = Math.sign(w.bend);
    let peak = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      w.step(1 / 60, 0);
      peak = Math.max(peak, Math.abs(w.bend));
      const s = Math.sign(w.bend);
      if (s !== 0 && s !== last) flips++;
      if (s !== 0) last = s;
    }
    return { flips, peak };
  };
  it("loads backwards, snaps forward, rings and settles", () => {
    const w = new RodWhip();
    w.trigger(1);
    expect(w.bend).toBeLessThan(-0.5);
    const { flips } = settle(w, 0.9);
    expect(flips).toBeGreaterThanOrEqual(1);
    settle(w, 2.5);
    expect(Math.abs(w.bend)).toBeLessThan(0.02);
    expect(Math.abs(w.kick)).toBeLessThan(0.02);
  });
  it("a harder cast whips harder", () => {
    const soft = new RodWhip();
    const hard = new RodWhip();
    soft.trigger(0.3);
    hard.trigger(1);
    expect(settle(hard, 1).peak).toBeGreaterThan(settle(soft, 1).peak);
  });
  it("pitch kicks forward (down) first", () => {
    const w = new RodWhip();
    w.trigger(0.8);
    let min = 0;
    for (let t = 0; t < 0.6; t += 1 / 60) {
      w.step(1 / 60, 0);
      min = Math.min(min, w.kick);
    }
    expect(min).toBeLessThan(-0.15);
  });
  it("stays stable at a low frame rate", () => {
    const w = new RodWhip();
    w.trigger(1);
    for (let t = 0; t < 3; t += 0.05) w.step(0.05, 0.2);
    expect(Math.abs(w.bend - 0.2)).toBeLessThan(0.05);
  });
});

describe("fish pull model (left / right, bigger fish fight harder)", () => {
  const make = (id: keyof typeof SPECIES_BY_ID, weight: number, seed = 7, kids = false) =>
    new FightModel({ species: SPECIES_BY_ID[id], weight, startD: 20, kids, rng: seeded(seed) });
  const maxSwing = (f: FightModel, seconds = 60, side = 0) => {
    let lo = 0;
    let hi = 0;
    for (let t = 0; t < seconds; t += 0.016) {
      f.step(0.016, { crank: 0.6, pump: 0, reelMul: 1, side });
      f.D = Math.max(f.D, 14);
      lo = Math.min(lo, f.ang);
      hi = Math.max(hi, f.ang);
    }
    return { lo, hi };
  };
  it("the fish swings to both sides and the angle is bounded by its own limit", () => {
    const f = make("sazan", 4);
    const { lo, hi } = maxSwing(f);
    expect(lo).toBeLessThan(-0.08);
    expect(hi).toBeGreaterThan(0.08);
    expect(Math.max(-lo, hi)).toBeLessThanOrEqual(f.maxAng * 1.4 + 1e-6);
  });
  it("a bigger, stronger fish pulls wider and harder than a small weak one", () => {
    const small = make("karas", 0.3);
    const big = make("laqqa", 14);
    expect(big.maxAng).toBeGreaterThan(small.maxAng);
    expect(big.pull).toBeGreaterThan(small.pull);
    const a = maxSwing(small);
    const b = maxSwing(big);
    expect(Math.max(-b.lo, b.hi)).toBeGreaterThan(Math.max(-a.lo, a.hi));
  });
  it("the sideways offset grows with the distance (same angle, further away)", () => {
    const f = make("sazan", 4);
    let near = 0;
    let far = 0;
    for (let t = 0; t < 30; t += 0.016) {
      f.step(0.016, { crank: 0.6, pump: 0, reelMul: 1 });
      f.D = 6;
      near = Math.max(near, Math.abs(f.lat));
    }
    const g = make("sazan", 4);
    for (let t = 0; t < 30; t += 0.016) {
      g.step(0.016, { crank: 0.6, pump: 0, reelMul: 1 });
      g.D = 24;
      far = Math.max(far, Math.abs(g.lat));
    }
    expect(far).toBeGreaterThan(near * 2);
  });
  it("pullDir says which way the fish runs and is 0 while it rests", () => {
    const f = make("sazan", 4);
    const dirs = new Set<number>();
    for (let t = 0; t < 60; t += 0.016) {
      f.step(0.016, { crank: 0.6, pump: 0, reelMul: 1 });
      f.D = Math.max(f.D, 14);
      dirs.add(f.pullDir);
      if (!f.run) expect(f.pullDir).toBe(0);
    }
    expect(dirs.has(-1)).toBe(true);
    expect(dirs.has(1)).toBe(true);
  });
  it("leaning the rod hand against the run lowers the tension (adult mode)", () => {
    expect(counterPull(1, -1)).toBe(1);
    expect(counterPull(1, 1)).toBe(0);
    expect(counterPull(-1, 0.1)).toBe(0.0 + Math.max(0, (0.1 - 0.3) / 0.7));
    const tension = (leanAgainst: boolean) => {
      const f = make("sazan", 5, 3);
      let sum = 0;
      let n = 0;
      for (let t = 0; t < 40; t += 0.016) {
        f.step(0.016, { crank: 0.8, pump: 0, reelMul: 1, side: leanAgainst ? -f.runDir : 0 });
        f.D = Math.max(f.D, 12);
        if (f.run) {
          sum += f.T;
          n++;
        }
      }
      return sum / Math.max(1, n);
    };
    expect(tension(true)).toBeLessThan(tension(false));
  });
  it("kids mode ignores the counter pull (a gentle fight)", () => {
    const f = make("sazan", 5, 3, true);
    for (let t = 0; t < 10; t += 0.016) f.step(0.016, { crank: 0.8, pump: 0, reelMul: 1, side: -f.runDir });
    expect(f.counter).toBe(0);
  });
});
