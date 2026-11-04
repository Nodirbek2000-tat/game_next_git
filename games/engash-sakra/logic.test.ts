import { describe, expect, it } from "vitest";
import { AFTER, Calm, Gates, Stance, WARN, readBody, type LmLike } from "./logic";

const DT = 1 / 30;

function seeded(seed = 7) {
  let s = seed;
  const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return () => (u() + u() + u() + u() - 2) * 1.73; // ~ N(0, 1)
}

/**
 * A standing person: shoulders 60 px wide (scale 60), nose 200, shoulders 260, hips 380, ankles 560.
 * `dy` lifts the whole body (+ = up); `crouch` lowers head, shoulders and hips (feet stay).
 */
function pose(dy = 0, noise = 0, rnd: () => number = () => 0, crouch = 0): LmLike[] {
  const lm: LmLike[] = Array.from({ length: 33 }, () => ({ x: 300, y: 300, v: 0.95 }));
  const set = (i: number, x: number, y: number, c = 0) => {
    lm[i].x = x + noise * rnd();
    lm[i].y = y - dy + c + noise * rnd();
  };
  set(0, 300, 200, crouch * 1.05);
  set(11, 330, 260, crouch);
  set(12, 270, 260, crouch);
  set(23, 320, 380, crouch * 0.6);
  set(24, 280, 380, crouch * 0.6);
  set(27, 320, 560);
  set(28, 280, 560);
  set(31, 325, 580);
  set(32, 275, 580);
  return lm;
}

function calibrated(noise = 1.5, seed = 3): { st: Stance; rnd: () => number } {
  const st = new Stance();
  const rnd = seeded(seed);
  for (let i = 0; i < 90 && !st.ready; i++) st.update(DT, pose(0, noise, rnd), 60);
  return { st, rnd };
}

const bump = (t: number, t0: number, h: number, len: number) => (t >= t0 && t < t0 + len ? h * Math.sin((Math.PI * (t - t0)) / len) : 0);

describe("calibration", () => {
  it("takes about a second of standing still", () => {
    const { st } = calibrated(2);
    expect(st.ready).toBe(true);
    expect(Math.abs(st.headY - 200)).toBeLessThan(3);
    expect(Math.abs(st.groundY - 580)).toBeLessThan(4);
  });
  it("readBody marks unseen parts as NaN", () => {
    const out = new Float64Array(5);
    const lm = pose();
    lm[12].v = 0.1;
    readBody(lm, out);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[0]).toBe(380);
  });
});

describe("duck and jump detection", () => {
  it("a crouch is a duck, not a jump", () => {
    const { st, rnd } = calibrated();
    let ducks = 0;
    let jumps = 0;
    for (let i = 0; i < 30 * 2; i++) {
      const t = i * DT;
      st.update(DT, pose(0, 1.5, rnd, bump(t, 0.4, 70, 1.0)), 60);
      if (st.duckFired) ducks++;
      if (st.jumpFired) jumps++;
    }
    expect(ducks).toBe(1);
    expect(jumps).toBe(0);
    expect(st.duck).toBe(false); // stood up again
  });

  it("a jump is a jump, not a duck (also the crouch before it)", () => {
    const { st, rnd } = calibrated();
    let ducks = 0;
    let jumps = 0;
    for (let i = 0; i < 30 * 2; i++) {
      const t = i * DT;
      // short wind-up squat, then the jump
      const crouch = t > 0.3 && t < 0.5 ? 20 : 0;
      st.update(DT, pose(bump(t, 0.55, 45, 0.5), 1.5, rnd, crouch), 60);
      if (st.duckFired) ducks++;
      if (st.jumpFired) jumps++;
    }
    expect(jumps).toBe(1);
    expect(ducks).toBe(0);
  });

  it("a duck is seen within about 0.3 s of the move, a shallow bow is not a duck", () => {
    const { st, rnd } = calibrated();
    let at = -1;
    for (let i = 0; i < 30 * 2 && at < 0; i++) {
      const t = i * DT;
      st.update(DT, pose(0, 1.5, rnd, t > 0.5 ? 60 : 0), 60);
      if (st.duckFired) at = t - 0.5;
    }
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(0.35);
    const bow = calibrated();
    let d = 0;
    for (let i = 0; i < 30 * 2; i++) {
      bow.st.update(DT, pose(0, 1.5, bow.rnd, 12), 60); // 0.2 body scales
      if (bow.st.duckFired) d++;
    }
    expect(d).toBe(0);
  });

  it("standing still with noise and one frame glitches never ducks or jumps", () => {
    const { st, rnd } = calibrated(2.5);
    let n = 0;
    for (let i = 0; i < 30 * 60; i++) {
      const glitch = i % 37 === 11 ? 40 : 0;
      const dip = i % 53 === 20 ? 40 : 0; // one frame of the head and shoulders dropping
      st.update(DT, pose(glitch, 2.5, rnd, dip), 60);
      if (st.jumpFired || st.duckFired) n++;
    }
    expect(n).toBe(0);
  });

  it("the keyboard works without a camera", () => {
    const st = new Stance();
    st.skipCalibration();
    st.update(DT, null, 60, false, true);
    expect(st.isDuck).toBe(true);
    st.update(DT, null, 60, false, false);
    expect(st.isDuck).toBe(false);
    st.update(DT, null, 60, true, false);
    expect(st.air).toBe(true);
  });
});

describe("calm smoothing", () => {
  it("does not move inside the dead zone and follows real moves", () => {
    const c = new Calm();
    c.update(100, 4, DT);
    for (let i = 0; i < 100; i++) c.update(100 + (i % 2 ? 3 : -3), 4, DT);
    expect(c.v).toBe(100);
    let v = 0;
    for (let i = 0; i < 3; i++) v = c.update(200, 4, DT);
    expect(v).toBeGreaterThan(185);
  });
});

describe("gates", () => {
  const run = (rand: () => number, air: (t: number) => boolean, duck: (t: number) => boolean, secs: number, horizon = 45) => {
    const g = new Gates(rand, horizon);
    const ev: { t: number; r: number; kind: number; perfect: boolean; wrong: boolean }[] = [];
    for (let t = 0; t < secs; t += DT) {
      const r = g.update(DT, air(t), duck(t), true);
      if (r) ev.push({ t, r, kind: g.lastKind, perfect: g.lastPerfect, wrong: g.lastWrong });
    }
    return { ev, g };
  };
  it("the first bars teach: high, then low", () => {
    const { ev } = run(Math.random, () => true, () => true, 8);
    expect(ev.slice(0, 2).map((e) => e.kind)).toEqual([0, 1]);
  });
  it("standing still hits every bar", () => {
    const { ev } = run(Math.random, () => false, () => false, 14);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev.every((e) => e.r === 2)).toBe(true);
  });
  it("ducking all the time clears the high bars only; jumping all the time clears the low bars only", () => {
    const d = run(() => 0.4, () => false, () => true, 20).ev;
    for (const e of d) expect(e.r).toBe(e.kind === 0 ? 1 : 2);
    const j = run(() => 0.4, () => true, () => false, 20).ev;
    for (const e of j) expect(e.r).toBe(e.kind === 1 ? 1 : 2);
    expect(d.some((e) => e.kind === 0)).toBe(true);
    expect(j.some((e) => e.kind === 1)).toBe(true);
  });
  it("the right action at the right time is perfect, the wrong one is flagged", () => {
    // first bar is a high one: arrives at 0.9 + 1.9 = 2.8 s (+ a frame)
    const arrive = 0.9 + 1.9;
    const ok = run(() => 0.4, () => false, (t) => t > arrive - 0.5 && t < arrive + 0.5, 3.2).ev;
    expect(ok[0]).toMatchObject({ r: 1, kind: 0, perfect: true });
    const wrong = run(() => 0.4, (t) => t > arrive - 0.3 && t < arrive + 0.3, () => false, 3.5).ev;
    expect(wrong[0]).toMatchObject({ r: 2, kind: 0, wrong: true });
  });
  it("an action within the camera delay still counts but is not perfect; later it is a hit", () => {
    const arrive = 0.9 + 1.9;
    const late = run(() => 0.4, () => false, (t) => t > arrive + 0.1 && t < arrive + 0.6, 3.5).ev;
    expect(late[0]).toMatchObject({ r: 1, perfect: false });
    const tooLate = run(() => 0.4, () => false, (t) => t > arrive + AFTER + 0.15 && t < arrive + 0.8, 3.5).ev;
    expect(tooLate[0].r).toBe(2);
  });
  it("a duck that ended long before the bar arrives does not count", () => {
    const arrive = 0.9 + 1.9;
    const ev = run(() => 0.4, () => false, (t) => t > arrive - 1.2 && t < arrive - 0.5, 3.5).ev;
    expect(ev[0].r).toBe(2);
  });
  it("speeds up and gets denser", () => {
    const g = new Gates(() => 0.4, 45);
    const early = g.approach;
    for (let t = 0; t < 45; t += DT) g.update(DT, false, false, true);
    expect(g.approach).toBeLessThan(early - 0.5);
    const gaps = (secs: number) => {
      const q = new Gates(() => 0.4, 10);
      let n = 0;
      for (let t = 0; t < secs; t += DT) {
        const before = q.count;
        q.update(DT, true, true, true);
        if (q.count > before) n++;
      }
      return n;
    };
    expect(gaps(40)).toBeGreaterThan(14);
  });
  it("sometimes sends a quick double (low, then high) after the first 14 s", () => {
    const g = new Gates(() => 0.1, 45);
    const spawns: { time: number; kind: number }[] = [];
    let count = 0;
    for (let t = 0; t < 60; t += DT) {
      g.update(DT, true, true, true);
      if (g.count > count) {
        count = g.count;
        const newest = g.pool.filter((x) => x.active && x.t < DT * 1.5)[0];
        if (newest) spawns.push({ time: g.time, kind: newest.kind });
      }
    }
    let pairs = 0;
    for (let i = 1; i < spawns.length; i++) if (spawns[i].time - spawns[i - 1].time < 1.3 && spawns[i].kind !== spawns[i - 1].kind) pairs++;
    expect(pairs).toBeGreaterThanOrEqual(1);
    expect(spawns.filter((s) => s.time < 14).every((_, i, a) => i === 0 || a[i].time - a[i - 1].time > 1.3)).toBe(true);
  });
  it("never more than two of the same kind in a row", () => {
    const g = new Gates(Math.random, 45);
    const kinds: number[] = [];
    let count = 0;
    for (let t = 0; t < 120; t += DT) {
      g.update(DT, true, true, true);
      if (g.count > count) {
        count = g.count;
        const newest = g.pool.find((x) => x.active && x.t < DT * 1.5);
        if (newest) kinds.push(newest.kind);
      }
    }
    let run3 = 0;
    for (let i = 2; i < kinds.length; i++) if (kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2]) run3++;
    expect(kinds.length).toBeGreaterThan(20);
    expect(run3).toBe(0);
  });
  it("warns before each bar and reports which one is next", () => {
    const g = new Gates(() => 0.4, 45);
    let warnAt = -1;
    let arrived = -1;
    for (let t = 0; t < 4 && arrived < 0; t += DT) {
      g.update(DT, false, false, true);
      if (g.warnKind >= 0 && warnAt < 0) {
        warnAt = g.time;
        expect(g.next()?.kind).toBe(0);
      }
      if (g.arrived) arrived = g.time;
    }
    expect(arrived - warnAt).toBeGreaterThan(WARN - 0.1);
    expect(arrived - warnAt).toBeLessThan(WARN + 0.1);
  });
});
