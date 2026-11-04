import { describe, expect, it } from "vitest";
import {
  apexY, ballScale, difficulty, gravity, handPoint, headPoint, launch, newBall, newSm, smUpdate, step, touch, V_MAX, Wind, windMax, type Field,
} from "./logic";

const W = 400;
const H = 800;
const F: Field = { w: W, h: H, floor: 760 };
const DT = 1 / 60;

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("ball physics", () => {
  it("falls under gravity and strikes the floor", () => {
    const b = newBall();
    launch(b, 200, 100, 0);
    let hit = false;
    let t = 0;
    for (; t < 5 && !hit; t += DT) hit = step(b, DT, F, gravity(0));
    expect(hit).toBe(true);
    // 0.5 * 1.0 * 800 * t^2 ~ 630 px -> about 1.25 s (a little more with air drag)
    expect(t).toBeGreaterThan(1.1);
    expect(t).toBeLessThan(1.6);
    expect(b.y).toBeCloseTo(F.floor - b.r, 3);
  });
  it("air drag: a ball thrown up gets lower than in a vacuum", () => {
    const b = newBall();
    launch(b, 200, 600, 0, -1.2 * H);
    let top = b.y;
    for (let t = 0; t < 2; t += DT) {
      step(b, DT, F, 1);
      top = Math.min(top, b.y);
    }
    const vacuum = 600 - (1.2 * H) ** 2 / (2 * 1 * H);
    expect(top).toBeGreaterThan(vacuum);
    expect(top).toBeLessThan(vacuum + 0.25 * H);
  });
  it("the floor bounces weakly and keeps reporting a strike only for a falling ball", () => {
    const b = newBall();
    launch(b, 200, 700, 0, 600);
    expect(step(b, DT, F, 1)).toBe(false);
    let strikes = 0;
    for (let i = 0; i < 20; i++) if (step(b, DT, F, 1)) strikes++;
    expect(strikes).toBeGreaterThanOrEqual(1);
    expect(b.vy).toBeLessThan(0.3 * H);
  });
  it("side walls bounce and flip the spin, the ceiling is open", () => {
    const b = newBall();
    launch(b, 395, 300, 500);
    b.spin = 8;
    step(b, DT, F, 1);
    expect(b.vx).toBeLessThan(0);
    expect(b.spin).toBeLessThan(0);
    const l = newBall();
    launch(l, 5, 300, -500);
    step(l, DT, F, 1);
    expect(l.vx).toBeGreaterThan(0);
    // the ball may leave through the top and comes back
    const c = newBall();
    launch(c, 200, 10, 0, -1.2 * H);
    let min = c.y;
    let back = false;
    for (let t = 0; t < 3; t += DT) {
      step(c, DT, F, 1);
      min = Math.min(min, c.y);
      if (c.y > 100 && min < -100) back = true;
    }
    expect(min).toBeLessThan(-100);
    expect(back).toBe(true);
  });
  it("spin curves the flight, opposite spins to opposite sides", () => {
    const run = (spin: number) => {
      const b = newBall();
      launch(b, 200, 600, 0, -1.0 * H);
      b.spin = spin;
      for (let t = 0; t < 0.6; t += DT) step(b, DT, F, 1);
      return b.x - 200;
    };
    const a = run(10);
    const c = run(-10);
    expect(Math.abs(a)).toBeGreaterThan(5);
    expect(a * c).toBeLessThan(0);
    expect(Math.abs(run(0))).toBeLessThan(0.1);
  });
  it("wind pushes the ball sideways", () => {
    const run = (ax: number) => {
      const b = newBall();
      launch(b, 200, 300, 0, 0);
      for (let t = 0; t < 0.8; t += DT) step(b, DT, F, 1, ax);
      return b.x - 200;
    };
    expect(run(0.12)).toBeGreaterThan(15);
    expect(run(-0.12)).toBeLessThan(-15);
    expect(Math.abs(run(0))).toBeLessThan(0.1);
  });
  it("apex of a rising ball", () => {
    const b = newBall();
    launch(b, 200, 600, 0, -H);
    expect(apexY(b, 1, H)).toBeCloseTo(600 - H / 2, 3);
    launch(b, 200, 300, 0, 100);
    expect(apexY(b, 1, H)).toBe(300);
  });
});

describe("hits", () => {
  it("a hand under the ball sends it up; a far hand does not", () => {
    const b = newBall();
    launch(b, 200, 400, 0, 300);
    const s = touch(b, 200, 470, 0, -500, 40, F);
    expect(s).toBeGreaterThan(0);
    expect(b.vy).toBeLessThan(-0.7 * H);
    const c = newBall();
    launch(c, 200, 400, 0);
    expect(touch(c, 50, 700, 0, -500, 40, F)).toBe(0);
  });
  it("a harder upward swing hits higher (and stronger), a still hand just bounces it", () => {
    const still = newBall();
    const slow = newBall();
    const fast = newBall();
    for (const b of [still, slow, fast]) launch(b, 200, 400, 0, 300);
    const s0 = touch(still, 200, 460, 0, 0, 40, F);
    const s1 = touch(slow, 200, 460, 0, -200, 40, F);
    const s2 = touch(fast, 200, 460, 0, -1400, 40, F);
    expect(still.vy).toBeLessThan(-0.55 * H);
    expect(fast.vy).toBeLessThan(slow.vy);
    expect(slow.vy).toBeLessThanOrEqual(still.vy);
    expect(s2).toBeGreaterThan(s1);
    expect(s1).toBeGreaterThanOrEqual(s0);
    // never faster than the limit
    expect(fast.vy).toBeGreaterThanOrEqual(-V_MAX * H - 1e-6);
  });
  it("the ball always leaves upward, even when struck from above or from the side", () => {
    const rnd = lcg(4);
    for (let i = 0; i < 200; i++) {
      const b = newBall();
      launch(b, 200, 400, 0, (rnd() - 0.5) * 800);
      const ang = rnd() * Math.PI * 2;
      const hit = touch(b, 200 + Math.cos(ang) * 50, 400 + Math.sin(ang) * 50, (rnd() - 0.5) * 2000, (rnd() - 0.5) * 2000, 40, F);
      if (hit > 0) expect(b.vy).toBeLessThan(-0.5 * H);
    }
  });
  it("sideways: follows the hand velocity and the side struck", () => {
    const r = newBall();
    launch(r, 200, 400, 0);
    touch(r, 200, 460, 600, -300, 40, F);
    expect(r.vx).toBeGreaterThan(0);
    const l = newBall();
    launch(l, 200, 400, 0);
    touch(l, 200, 460, -600, -300, 40, F);
    expect(l.vx).toBeLessThan(0);
    const side = newBall();
    launch(side, 230, 440, 0);
    touch(side, 200, 460, 0, -300, 40, F); // ball is right of the hand
    expect(side.vx).toBeGreaterThan(0);
    const left = newBall();
    launch(left, 170, 440, 0);
    touch(left, 200, 460, 0, -300, 40, F);
    expect(left.vx).toBeLessThan(0);
  });
  it("a swing gives spin in its direction", () => {
    const r = newBall();
    launch(r, 200, 400, 0);
    touch(r, 200, 460, 800, -300, 40, F);
    const l = newBall();
    launch(l, 200, 400, 0);
    touch(l, 200, 460, -800, -300, 40, F);
    expect(r.spin).toBeGreaterThan(1);
    expect(l.spin).toBeLessThan(-1);
  });
  it("cannot be hit twice in a row at once, nor after it dropped", () => {
    const b = newBall();
    launch(b, 200, 400, 0);
    expect(touch(b, 200, 440, 0, -300, 40, F)).toBeGreaterThan(0);
    b.y = 440;
    expect(touch(b, 200, 440, 0, -300, 40, F)).toBe(0);
    step(b, 0.2, F, 1);
    expect(b.cool).toBe(0);
    b.alive = false;
    expect(touch(b, b.x, b.y + 30, 0, -300, 40, F)).toBe(0);
  });
  it("the ball is pushed out of the hand", () => {
    const b = newBall();
    launch(b, 205, 470, 0);
    touch(b, 200, 480, 0, -300, 40, F);
    expect(Math.hypot(b.x - 200, b.y - 480)).toBeGreaterThanOrEqual(b.r + 40);
  });
  it("a head hit also lifts the ball", () => {
    const b = newBall();
    launch(b, 200, 300, 0, 500);
    expect(touch(b, 200, 350, 0, 0, 40, F, true)).toBeGreaterThan(0);
    expect(b.vy).toBeLessThan(-0.6 * H);
  });
  it("keeps the rally going: a still hand under a falling ball can bounce it many times", () => {
    const b = newBall();
    launch(b, 200, 100, 0);
    let hits = 0;
    for (let t = 0; t < 12; t += DT) {
      if (touch(b, 200, 560, 0, 0, 40, F) > 0) hits++;
      if (step(b, DT, F, 1)) break;
    }
    expect(hits).toBeGreaterThanOrEqual(5);
  });
});

describe("difficulty", () => {
  it("the ball shrinks, falls faster and wind appears as touches pile up", () => {
    expect(difficulty(0)).toBe(0);
    expect(difficulty(1000)).toBe(1);
    expect(ballScale(1)).toBeLessThan(ballScale(0));
    expect(ballScale(1)).toBeGreaterThan(0.7);
    expect(gravity(1)).toBeGreaterThan(gravity(0));
    expect(windMax(0.1)).toBe(0);
    expect(windMax(1)).toBeGreaterThan(0.05);
  });
  it("wind stays calm early and within its limit later", () => {
    const rnd = lcg(2);
    const w = new Wind();
    for (let t = 0; t < 60; t += DT) w.update(DT, 0.1, rnd);
    expect(w.v).toBe(0);
    let max = 0;
    for (let t = 0; t < 120; t += DT) {
      w.update(DT, 1, rnd);
      max = Math.max(max, Math.abs(w.v));
    }
    expect(max).toBeGreaterThan(0.02);
    expect(max).toBeLessThanOrEqual(windMax(1) + 1e-9);
  });
});

describe("calm hand markers", () => {
  const lmWith = (vis: Record<number, number>, pos: Record<number, [number, number]> = {}) =>
    Array.from({ length: 33 }, (_, i) => ({ x: pos[i]?.[0] ?? i, y: pos[i]?.[1] ?? i * 2, v: vis[i] ?? 0.1 }));
  it("hand and head points", () => {
    const out = { x: 0, y: 0 };
    expect(handPoint(lmWith({ 15: 0.9, 19: 0.9 }, { 15: [100, 100], 19: [200, 100] }), true, out)).toBe(true);
    expect(out.x).toBeGreaterThan(100);
    expect(out.x).toBeLessThan(200);
    expect(handPoint(lmWith({}), false, out)).toBe(false);
    expect(headPoint(lmWith({ 0: 0.9 }, { 0: [100, 100] }), 40, out)).toBe(true);
    expect([out.x, out.y]).toEqual([100, 90]);
    expect(headPoint(lmWith({}), 40, out)).toBe(false);
  });
  it("a still hand with noise barely moves the marker (perfectly calm)", () => {
    const rnd = lcg(21);
    const s = newSm();
    const scale = 90;
    smUpdate(s, true, 400, 300, 1 / 60, scale);
    let travel = 0;
    let px = s.x;
    let py = s.y;
    for (let i = 0; i < 600; i++) {
      smUpdate(s, true, 400 + (rnd() - 0.5) * 6, 300 + (rnd() - 0.5) * 6, 1 / 60, scale);
      travel += Math.hypot(s.x - px, s.y - py);
      px = s.x;
      py = s.y;
    }
    expect(travel).toBeLessThan(0.5);
    expect(Math.hypot(s.x - 400, s.y - 300)).toBeLessThan(0.07 * scale);
  });
  it("slow drift is followed, a real move reaches the marker within ~100 ms", () => {
    const scale = 90;
    const s = newSm();
    smUpdate(s, true, 400, 300, 1 / 60, scale);
    const tx = 400 + 1.5 * scale;
    let t = 0;
    while (Math.abs(s.x - tx) > 0.15 * scale && t < 1) {
      smUpdate(s, true, tx, 300, 1 / 60, scale);
      t += 1 / 60;
    }
    expect(t).toBeLessThanOrEqual(0.11);
    const m = newSm();
    smUpdate(m, true, 0, 0, 1 / 60, scale);
    for (let i = 1; i <= 60; i++) smUpdate(m, true, i * 4, 0, 1 / 60, scale);
    expect(240 - m.x).toBeLessThan(0.35 * scale);
    // 30 fps (phones) is as good
    const p = newSm();
    smUpdate(p, true, 0, 0, 1 / 30, scale);
    let u = 0;
    while (Math.abs(p.x - 1.5 * scale) > 0.15 * scale && u < 1) {
      smUpdate(p, true, 1.5 * scale, 0, 1 / 30, scale);
      u += 1 / 30;
    }
    expect(u).toBeLessThanOrEqual(0.15);
  });
  it("its velocity follows a real move and is ~0 at rest", () => {
    const s = newSm();
    smUpdate(s, true, 0, 0, 1 / 60, 90);
    for (let i = 0; i < 30; i++) smUpdate(s, true, 0, 0, 1 / 60, 90);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(1);
    for (let i = 1; i <= 20; i++) smUpdate(s, true, i * 10, 0, 1 / 60, 90);
    expect(s.vx).toBeGreaterThan(300);
  });
  it("a short dropout keeps the marker, a long one removes it, the return snaps", () => {
    const s = newSm();
    smUpdate(s, true, 100, 100, 1 / 30, 80);
    smUpdate(s, false, 0, 0, 0.1, 80);
    expect(s.on).toBe(true);
    smUpdate(s, false, 0, 0, 0.1, 80);
    expect(s.on).toBe(false);
    smUpdate(s, true, 500, 50, 1 / 30, 80);
    expect([s.x, s.y]).toEqual([500, 50]);
  });
});
