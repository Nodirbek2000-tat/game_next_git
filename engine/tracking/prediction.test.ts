import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, makeConfig } from "../config";
import type { Lm } from "../types";
import { BladeTracker, newBlade } from "./blades";
import { LatencyTracker, leadMs, predict, predictAccel, sanitizeCaptureTs, velAlpha } from "./prediction";

describe("velAlpha / leadMs / predict", () => {
  it("is frame-rate independent: two 8 ms steps smooth like one 16 ms step", () => {
    const one = velAlpha(0.016, 22);
    const two = 1 - (1 - velAlpha(0.008, 22)) ** 2;
    expect(two).toBeCloseTo(one, 10);
    expect(velAlpha(0.033, 22)).toBeGreaterThan(velAlpha(0.016, 22));
  });

  it("lead = age of the detection + display lead, capped, never negative", () => {
    expect(leadMs(1050, 1000, 8, 120)).toBe(58);
    expect(leadMs(1500, 1000, 8, 120)).toBe(120);
    expect(leadMs(1000, 1010, 0, 120)).toBe(0);
  });

  it("predict moves along the velocity, damped by the gain", () => {
    expect(predict(100, 1000, 50, 1)).toBeCloseTo(150);
    expect(predict(100, 1000, 50, 0.8)).toBeCloseTo(140);
    expect(predict(100, 0, 50, 1)).toBe(100);
  });
});

describe("predictAccel", () => {
  it("reduces to constant velocity without acceleration and adds the acceleration term", () => {
    expect(predictAccel(0, 1000, 0, 100, 1, 1)).toBeCloseTo(100);
    expect(predictAccel(0, 1000, 2000, 100, 1, 1)).toBeCloseTo(100 + 0.5 * 2000 * 0.01);
  });
  it("a braking hand stops at the standstill point, it never flies backwards", () => {
    // v = 1000 px/s, a = -5000 px/s^2 -> stops after 0.2 s at 100 px
    expect(predictAccel(0, 1000, -5000, 400, 1, 1)).toBeCloseTo(100);
    expect(predictAccel(0, 1000, -5000, 100, 1, 1)).toBeCloseTo(100 - 25);
  });
});

describe("sanitizeCaptureTs", () => {
  it("uses the camera's capture time when it is plausible", () => {
    expect(sanitizeCaptureTs(960, 1000, 1000)).toBe(960);
  });
  it("falls back to the callback time for missing, future or ancient stamps", () => {
    expect(sanitizeCaptureTs(undefined, 1000, 1000)).toBe(1000);
    expect(sanitizeCaptureTs(0, 1000, 1000)).toBe(1000);
    expect(sanitizeCaptureTs(1200, 1000, 1000)).toBe(1000);
    expect(sanitizeCaptureTs(100, 1000, 1000)).toBe(1000);
  });
});

describe("LatencyTracker", () => {
  it("splits the camera -> screen path into stages and adds the display lead", () => {
    const t = new LatencyTracker(8);
    t.record(1000, 1020, 1035, 1037);
    expect(t.wait).toBe(20);
    expect(t.infer).toBe(15);
    expect(t.apply).toBe(2);
    expect(t.total).toBe(37 + 8);
  });
  it("smooths and remembers spikes", () => {
    const t = new LatencyTracker(0);
    for (let i = 0; i < 50; i++) t.record(0, 10, 30, 32);
    expect(t.total).toBeCloseTo(32, 5);
    t.record(0, 10, 100, 120);
    expect(t.total).toBeLessThan(45);
    expect(t.peak).toBeGreaterThanOrEqual(120 * 0.98 - 1);
  });
});

// ---------------------------------------------------------------------------------------------
// End-to-end behaviour of the blade prediction: a hand sweeps, the result of a camera frame reaches the tracker
// 45 ms after the capture, detections come at 30 Hz, rendering runs at 60 Hz. How far is the drawn blade from the hand?
// ---------------------------------------------------------------------------------------------
const H = 720;
const handX = (t: number): number => 640 + 420 * Math.sin((2 * Math.PI * 1.4 * t) / 1000); // ~3.7 screen heights / s peak
const handY = (t: number): number => 360 + 150 * Math.cos((2 * Math.PI * 1.1 * t) / 1000);
type Pair = [ReturnType<typeof newBlade>, ReturnType<typeof newBlade>];
const mkRaw = (v = 1): Lm[] => Array.from({ length: 33 }, () => ({ x: 0, y: 0, v }));
const NO_HANDS = { L: null, R: null };

function simulate(opts: { useCapture: boolean; lead: number; maxMs: number; gain: number; velTauMs: number }): number {
  const bt = new BladeTracker({ ...DEFAULT_CONFIG.blade, velTauMs: opts.velTauMs });
  const blades: Pair = [newBlade("L"), newBlade("R")];
  const raw = mkRaw(0);
  const delay = 45;
  let err = 0;
  let n = 0;
  let nextDet = 0;
  for (let now = 0; now < 4000; now += 1000 / 60) {
    while (nextDet + delay <= now) {
      const cap = nextDet;
      raw[20].x = handX(cap);
      raw[20].y = handY(cap);
      raw[20].v = 1;
      bt.update(blades, raw, NO_HANDS, true, opts.useCapture ? cap : nextDet + delay, H);
      nextDet += 1000 / 30;
    }
    bt.extrapolate(blades, now, opts.maxMs, opts.gain, opts.lead);
    if (now > 500 && blades[1].active) {
      err += Math.hypot(blades[1].x - handX(now), blades[1].y - handY(now));
      n++;
    }
  }
  return err / n;
}

describe("blade prediction (lag of the drawn blade behind the hand)", () => {
  // the previous behaviour: stamps = arrival time, no lead, 80 ms cap, 0.8 gain, fixed ~0.6 velocity smoothing
  const legacy = simulate({ useCapture: false, lead: 0, maxMs: 80, gain: 0.8, velTauMs: 33 });
  const e = DEFAULT_CONFIG.extrapolation;
  const current = simulate({ useCapture: true, lead: e.leadMs, maxMs: e.maxMs, gain: e.gain, velTauMs: DEFAULT_CONFIG.blade.velTauMs });

  it("capture-time prediction follows the hand much closer than arrival-time extrapolation", () => {
    console.info(`blade error vs hand: before ${legacy.toFixed(1)} px, now ${current.toFixed(1)} px (screen height ${H})`);
    expect(current).toBeLessThan(legacy * 0.55);
  });

  it("stays within ~6% of the screen height of the hand even when it waves at 3.7 screen heights / s", () => {
    expect(current).toBeLessThan(H * 0.06);
  });

  it("a resting hand with sensor noise does not make the blade tremble (prediction dead zone)", () => {
    const bt = new BladeTracker(DEFAULT_CONFIG.blade);
    const blades: Pair = [newBlade("L"), newBlade("R")];
    const raw = mkRaw();
    let seed = 9;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 4; // +-2 px
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      const t = (i * 1000) / 60;
      if (i % 2 === 0) {
        raw[20].x = 640 + rnd();
        raw[20].y = 360 + rnd();
        bt.update(blades, raw, NO_HANDS, true, t - 45, H);
      }
      bt.extrapolate(blades, t, 120, 0.9, 8);
      if (i > 30) worst = Math.max(worst, Math.hypot(blades[1].x - 640, blades[1].y - 360));
    }
    expect(worst).toBeLessThan(4);
  });

  it("the sweep of the next frame starts where the previous one ended (continuous across detections)", () => {
    const bt = new BladeTracker(DEFAULT_CONFIG.blade);
    const blades: Pair = [newBlade("L"), newBlade("R")];
    const raw = mkRaw();
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i < 40; i++) {
      const t = i * 16.7;
      if (i % 2 === 0) {
        raw[20].x = 100 + t * 1.2;
        raw[20].y = 300;
        bt.update(blades, raw, NO_HANDS, true, t, H);
      }
      bt.extrapolate(blades, t + 5, 120, 0.9, 8);
      if (prev) {
        expect(blades[1].px).toBeCloseTo(prev.x, 6);
        expect(blades[1].py).toBeCloseTo(prev.y, 6);
      }
      prev = { x: blades[1].x, y: blades[1].y };
    }
  });

  it("bridges a 100 ms dropout and goes inactive afterwards", () => {
    const bt = new BladeTracker(DEFAULT_CONFIG.blade);
    const blades: Pair = [newBlade("L"), newBlade("R")];
    const raw = mkRaw();
    for (let i = 0; i < 6; i++) {
      raw[20].x = 100 + i * 20;
      raw[20].y = 200;
      bt.update(blades, raw, NO_HANDS, true, i * 33, H);
    }
    bt.update(blades, raw, NO_HANDS, false, 5 * 33 + 100, H);
    expect(blades[1].active).toBe(true);
    bt.update(blades, raw, NO_HANDS, false, 5 * 33 + 300, H);
    expect(blades[1].active).toBe(false);
  });

  it("a reversing hand turns the velocity around at once", () => {
    const bt = new BladeTracker(DEFAULT_CONFIG.blade);
    const blades: Pair = [newBlade("L"), newBlade("R")];
    const raw = mkRaw();
    let x = 100;
    for (let i = 0; i < 8; i++) {
      x += 40;
      raw[20].x = x;
      raw[20].y = 200;
      bt.update(blades, raw, NO_HANDS, true, i * 33, H);
    }
    expect(blades[1].vx).toBeGreaterThan(0);
    raw[20].x = x - 40;
    bt.update(blades, raw, NO_HANDS, true, 8 * 33, H);
    expect(blades[1].vx).toBeLessThan(0);
  });

  it("darkness lets a low-visibility fingertip still count", () => {
    const mk = () => ({ bt: new BladeTracker(DEFAULT_CONFIG.blade), blades: [newBlade("L"), newBlade("R")] as Pair, raw: mkRaw(0.3) });
    const a = mk();
    a.bt.update(a.blades, a.raw, NO_HANDS, true, 0, H);
    expect(a.blades[1].active).toBe(false);
    const b = mk();
    b.bt.setDarkness(1);
    b.bt.update(b.blades, b.raw, NO_HANDS, true, 0, H);
    expect(b.blades[1].active).toBe(true);
  });
});

describe("filter / extrapolation defaults", () => {
  it("are tuned for low latency", () => {
    const c = makeConfig();
    expect(c.filter.beta).toBeGreaterThanOrEqual(8);
    expect(c.filter.dCutoff).toBeGreaterThanOrEqual(3);
    expect(c.extrapolation.maxMs).toBeGreaterThanOrEqual(100);
    expect(c.analysisFps).toBeGreaterThanOrEqual(60);
  });
});
