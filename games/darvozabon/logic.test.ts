import { describe, expect, it } from "vitest";
import {
  ballR, bodyX, depth, difficulty, EV_GOAL, EV_KICK, EV_SAVE, flightTime, footPoint, handPoint, newSm, pickX, pickY, SAVE_FROM, segDist, Shots,
  smUpdate, ZN,
} from "./logic";

const DT = 1 / 30;

/** small deterministic random numbers */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("perspective", () => {
  it("the ball grows from 1/5 to full size and moves faster at the end", () => {
    expect(ballR(0, 50)).toBeCloseTo(50 * ZN, 5);
    expect(ballR(1, 50)).toBeCloseTo(50, 5);
    expect(depth(0)).toBeCloseTo(0, 6);
    expect(depth(1)).toBeCloseTo(1, 6);
    expect(depth(0.5) - depth(0.4)).toBeLessThan(depth(1) - depth(0.9));
  });
  it("segDist", () => {
    expect(segDist(5, 5, 0, 0, 10, 0)).toBeCloseTo(5, 6);
    expect(segDist(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5, 6);
    expect(segDist(1, 1, 3, 3, 3, 3)).toBeCloseTo(Math.hypot(2, 2), 6);
  });
});

describe("shot targets cover the whole goal", () => {
  const xMin = 60;
  const xMax = 1220;
  it("reach the far left and far right edges", () => {
    const rnd = lcg(7);
    let lo = Infinity;
    let hi = -Infinity;
    let prev = -1e9;
    for (let i = 0; i < 600; i++) {
      const x = pickX(rnd, 640, 220, xMin, xMax, 0.5, prev);
      expect(x).toBeGreaterThanOrEqual(xMin);
      expect(x).toBeLessThanOrEqual(xMax);
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      prev = x;
    }
    expect(lo).toBeLessThan(xMin + 0.08 * (xMax - xMin));
    expect(hi).toBeGreaterThan(xMax - 0.08 * (xMax - xMin));
  });
  it("most shots are beyond the keeper's reach: he has to step", () => {
    const rnd = lcg(11);
    let far = 0;
    let prev = -1e9;
    const N = 500;
    for (let i = 0; i < N; i++) {
      const x = pickX(rnd, 640, 200, xMin, xMax, 0.3, prev);
      if (Math.abs(x - 640) >= 200) far++;
      prev = x;
    }
    expect(far / N).toBeGreaterThan(0.9);
  });
  it("a keeper standing at the left edge gets balls on the right", () => {
    const rnd = lcg(3);
    let right = 0;
    let prev = -1e9;
    for (let i = 0; i < 300; i++) {
      const x = pickX(rnd, 70, 200, xMin, xMax, 0.5, prev);
      if (x >= 70 + 200) right++;
      prev = x;
    }
    expect(right / 300).toBeGreaterThan(0.8);
  });
  it("is never twice at the same place in a row", () => {
    const rnd = lcg(5);
    let prev = 640;
    let same = 0;
    for (let i = 0; i < 300; i++) {
      const x = pickX(rnd, 640, 200, xMin, xMax, 0.5, prev);
      if (Math.abs(x - prev) < 0.14 * (xMax - xMin)) same++;
      prev = x;
    }
    expect(same / 300).toBeLessThan(0.1);
  });
  it("heights stay inside the goal; low shots need visible legs", () => {
    const rnd = lcg(9);
    for (let i = 0; i < 300; i++) {
      const y = pickY(rnd, 200, 300, 450, 650, i % 2 === 0, 120, 600);
      expect(y).toBeGreaterThanOrEqual(120);
      expect(y).toBeLessThanOrEqual(600);
    }
    // no legs in view: the lowest balls stay near the hips (at most hip + half a torso = 525)
    for (let i = 0; i < 300; i++) expect(pickY(rnd, 200, 300, 450, 650, false, 120, 900)).toBeLessThanOrEqual(525);
    // legs in view: some balls go down to the ankles
    let low = 0;
    for (let i = 0; i < 300; i++) if (pickY(rnd, 200, 300, 450, 650, true, 120, 900) > 560) low++;
    expect(low).toBeGreaterThan(40);
  });
  it("gets harder with every shot", () => {
    expect(difficulty(0)).toBe(0);
    expect(difficulty(100)).toBe(1);
    expect(flightTime(1)).toBeLessThan(flightTime(0));
  });
});

describe("shots", () => {
  const X = new Float32Array(4);
  const Y = new Float32Array(4);
  const R = new Float32Array(4);
  const F = new Uint8Array(4);
  /** one shot (200,100) -> (200,300), windup 0.3 s, flight 1 s; one hand at (hx,hy) or none */
  const run = (hx: number, hy: number, n: number, foot = 0, secs = 2) => {
    const sh = new Shots();
    sh.spawn(200, 100, 200, 300, 1, 0.3, 0, 0);
    X[0] = hx;
    Y[0] = hy;
    R[0] = 30;
    F[0] = foot;
    let kick = 0;
    let save = 0;
    let goal = 0;
    let who = -1;
    let isFoot = false;
    for (let t = 0; t < secs; t += DT) {
      sh.nEv = 0;
      sh.update(DT, X, Y, R, F, n, 50);
      for (let i = 0; i < sh.nEv; i++) {
        const ev = sh.ev[i];
        if (ev.type === EV_KICK) kick++;
        if (ev.type === EV_SAVE) {
          save++;
          who = ev.who;
          isFoot = ev.foot;
        }
        if (ev.type === EV_GOAL) goal++;
      }
    }
    return { sh, kick, save, goal, who, isFoot };
  };
  it("windup first (target already known), then a kick, then the flight", () => {
    const sh = new Shots();
    const s = sh.spawn(200, 100, 200, 300, 1, 0.3, 0, 0);
    expect(s?.state).toBe(0);
    let kicked = -1;
    for (let t = 0; t < 1; t += DT) {
      sh.nEv = 0;
      sh.update(DT, X, Y, R, F, 0, 50);
      if (sh.nEv && sh.ev[0].type === EV_KICK && kicked < 0) kicked = t;
    }
    expect(kicked).toBeGreaterThan(0.25);
    expect(kicked).toBeLessThan(0.45);
  });
  it("a hand on the ball saves it", () => {
    const r = run(205, 290, 1);
    expect(r.save).toBe(1);
    expect(r.goal).toBe(0);
    expect(r.sh.pool.every((s) => !s.active)).toBe(true);
  });
  it("a foot save is reported as such", () => {
    const r = run(200, 300, 1, 1);
    expect(r.save).toBe(1);
    expect(r.isFoot).toBe(true);
  });
  it("no hand: goal", () => {
    const r = run(0, 0, 0);
    expect(r.save).toBe(0);
    expect(r.goal).toBe(1);
    expect(r.kick).toBe(1);
  });
  it("a hand far away does not save", () => {
    expect(run(20, 20, 1).goal).toBe(1);
    // keeper stands at the left, ball goes to the far right edge
    const sh = new Shots();
    sh.spawn(640, 100, 1200, 300, 1, 0.3, 0, 0);
    X[0] = 150;
    Y[0] = 300;
    let goal = 0;
    let save = 0;
    for (let t = 0; t < 2; t += DT) {
      sh.nEv = 0;
      sh.update(DT, X, Y, R, F, 1, 50);
      for (let i = 0; i < sh.nEv; i++) {
        if (sh.ev[i].type === EV_GOAL) goal++;
        if (sh.ev[i].type === EV_SAVE) save++;
      }
    }
    expect(save).toBe(0);
    expect(goal).toBe(1);
  });
  it("a hand cannot catch a ball that is still far away", () => {
    const sh = new Shots();
    sh.spawn(200, 100, 200, 300, 1, 0.1, 0, 0);
    X[0] = 200;
    Y[0] = 110;
    R[0] = 60;
    for (let t = 0; t < 0.1 + SAVE_FROM * 1 - 0.1; t += DT) {
      sh.nEv = 0;
      sh.update(DT, X, Y, R, F, 1, 50);
      for (let i = 0; i < sh.nEv; i++) expect(sh.ev[i].type).not.toBe(EV_SAVE);
    }
  });
  it("a fast ball is not missed by a hand that sits on its path between two frames", () => {
    const sh = new Shots();
    sh.spawn(0, 0, 1000, 0, 0.25, 0.01, 0, 0);
    X[0] = 880;
    Y[0] = 60;
    R[0] = 20;
    let save = 0;
    // only 2 frames at 10 fps in the last part of the flight
    for (let t = 0; t < 0.5; t += 0.1) {
      sh.nEv = 0;
      sh.update(0.1, X, Y, R, F, 1, 50);
      for (let i = 0; i < sh.nEv; i++) if (sh.ev[i].type === EV_SAVE) save++;
    }
    expect(save).toBe(1);
  });
  it("two shots at once are handled separately", () => {
    const sh = new Shots();
    sh.spawn(200, 100, 100, 300, 1, 0.1, 0, 0);
    sh.spawn(200, 100, 700, 300, 1, 0.5, 0, 0);
    X[0] = 100;
    Y[0] = 300;
    let save = 0;
    let goal = 0;
    for (let t = 0; t < 2.5; t += DT) {
      sh.nEv = 0;
      sh.update(DT, X, Y, R, F, 1, 50);
      for (let i = 0; i < sh.nEv; i++) {
        if (sh.ev[i].type === EV_SAVE) save++;
        if (sh.ev[i].type === EV_GOAL) goal++;
      }
    }
    expect(save).toBe(1);
    expect(goal).toBe(1);
  });
  it("the pool is limited (no more shots than slots) and slots are reused", () => {
    const sh = new Shots(2);
    expect(sh.spawn(0, 0, 10, 10, 1, 0.1, 0, 0)).not.toBeNull();
    expect(sh.spawn(0, 0, 10, 10, 1, 0.1, 0, 0)).not.toBeNull();
    expect(sh.spawn(0, 0, 10, 10, 1, 0.1, 0, 0)).toBeNull();
    for (let t = 0; t < 3; t += DT) {
      sh.nEv = 0;
      sh.update(DT, X, Y, R, F, 0, 50);
    }
    expect(sh.busy).toBe(0);
    expect(sh.spawn(0, 0, 10, 10, 1, 0.1, 0, 0)).not.toBeNull();
  });
  it("a bulging (curved) path still ends exactly on the target", () => {
    const sh = new Shots();
    const s = sh.spawn(300, 100, 900, 400, 1, 0.1, 80, 40);
    if (!s) throw new Error("no slot");
    sh.place(s, 0.5);
    expect(Math.abs(s.x - (300 + 600 * depth(0.5)))).toBeGreaterThan(5);
    sh.place(s, 1);
    expect(s.x).toBeCloseTo(900, 5);
    expect(s.y).toBeCloseTo(400, 5);
  });
});

describe("hand / foot points and smoothing", () => {
  const lmWith = (vis: Record<number, number>, pos: Record<number, [number, number]> = {}) =>
    Array.from({ length: 33 }, (_, i) => ({ x: pos[i]?.[0] ?? i, y: pos[i]?.[1] ?? i * 2, v: vis[i] ?? 0.1 }));
  it("hand point sits between wrist and index finger; falls back to what is visible", () => {
    const out = { x: 0, y: 0 };
    const lm = lmWith({ 15: 0.9, 19: 0.9 }, { 15: [100, 100], 19: [200, 100] });
    expect(handPoint(lm, true, out)).toBe(true);
    expect(out.x).toBeGreaterThan(100);
    expect(out.x).toBeLessThan(200);
    expect(handPoint(lmWith({ 16: 0.9 }, { 16: [50, 60] }), false, out)).toBe(true);
    expect([out.x, out.y]).toEqual([50, 60]);
    expect(handPoint(lmWith({}), true, out)).toBe(false);
  });
  it("foot point and body centre", () => {
    const out = { x: 0, y: 0 };
    expect(footPoint(lmWith({ 27: 0.9, 31: 0.9 }, { 27: [10, 100], 31: [30, 120] }), true, out)).toBe(true);
    expect([out.x, out.y]).toEqual([20, 110]);
    expect(footPoint(lmWith({}), true, out)).toBe(false);
    expect(bodyX(lmWith({ 23: 0.9, 24: 0.9 }, { 23: [100, 0], 24: [140, 0] }), 5)).toBe(120);
    expect(bodyX(lmWith({}), 5)).toBe(5);
  });
  it("a still hand with noise barely moves the marker", () => {
    const rnd = lcg(21);
    const s = newSm();
    const scale = 90;
    smUpdate(s, true, 400, 300, 1 / 60, scale);
    let travel = 0;
    let px = s.x;
    let py = s.y;
    for (let i = 0; i < 600; i++) {
      // jitter of +-3 px (0.033 scale) around the real position
      smUpdate(s, true, 400 + (rnd() - 0.5) * 6, 300 + (rnd() - 0.5) * 6, 1 / 60, scale);
      travel += Math.hypot(s.x - px, s.y - py);
      px = s.x;
      py = s.y;
    }
    expect(travel).toBeLessThan(0.5);
  });
  it("a real move reaches the marker within ~100 ms", () => {
    const s = newSm();
    const scale = 90;
    smUpdate(s, true, 400, 300, 1 / 60, scale);
    // the hand jumps 1.5 body scales to the right
    const tx = 400 + 1.5 * scale;
    let t = 0;
    while (Math.abs(s.x - tx) > 0.15 * scale && t < 1) {
      smUpdate(s, true, tx, 300, 1 / 60, scale);
      t += 1 / 60;
    }
    expect(t).toBeLessThanOrEqual(0.11);
    // a smooth slow move is followed without a big lag
    const m = newSm();
    smUpdate(m, true, 0, 0, 1 / 60, scale);
    for (let i = 1; i <= 60; i++) smUpdate(m, true, i * 4, 0, 1 / 60, scale);
    expect(240 - m.x).toBeLessThan(0.35 * scale);
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
