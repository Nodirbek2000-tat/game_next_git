import { describe, expect, it } from "vitest";
import { LowLightController, applyLut, buildLut, computeTarget, confidenceFor, lightStats, type LightStats } from "./lowLight";

/** RGBA frame where each pixel is a grey level (0..255), cycling through `levels`. */
const frame = (levels: number[], n = 1600): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = levels[i % levels.length];
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return d;
};
const stat = (mean: number, lo = mean * 0.3, hi = Math.min(1, mean * 1.8)): LightStats => ({ mean, lo, hi });

describe("lightStats", () => {
  it("measures mean luma and percentiles", () => {
    const s = lightStats(frame([20, 30, 40]))!;
    expect(s.mean).toBeCloseTo(30 / 255, 2);
    expect(s.lo).toBeLessThan(s.mean);
    expect(s.hi).toBeGreaterThan(s.mean);
    expect(lightStats(frame([255]))!.mean).toBeCloseTo(1, 2);
    expect(lightStats(frame([0]))!.mean).toBe(0);
  });
  it("returns null without data", () => {
    expect(lightStats(null)).toBeNull();
    expect(lightStats(new Uint8ClampedArray(4))).toBeNull();
  });
});

describe("computeTarget (what the frame needs)", () => {
  it("a well lit frame needs nothing", () => {
    const t = computeTarget(stat(0.5, 0.05, 0.95));
    expect(t.need).toBe(false);
    expect(t.darkness).toBe(0);
  });
  it("a dark frame is stretched and brightened, but never amplified without limit", () => {
    const t = computeTarget(stat(0.1, 0.02, 0.22));
    expect(t.need).toBe(true);
    expect(t.gamma).toBeLessThan(1);
    expect(t.gamma).toBeGreaterThanOrEqual(0.45);
    expect(t.hi - t.lo).toBeGreaterThanOrEqual(0.27);
    expect(t.darkness).toBeGreaterThan(0.8);
  });
  it("a dim, flat (blurry / foggy) picture gets contrast too", () => {
    expect(computeTarget(stat(0.38, 0.28, 0.46)).need).toBe(true);
  });
});

describe("LUT", () => {
  it("brightens dark pixels, keeps black and white, is monotonic", () => {
    const lut = buildLut({ gamma: 0.6, lo: 0.02, hi: 0.3 });
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[20]).toBeGreaterThan(60);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });
  it("applies in place and leaves alpha alone", () => {
    const d = frame([20], 4);
    applyLut(d, buildLut({ gamma: 0.6, lo: 0, hi: 0.3 }));
    expect(d[0]).toBeGreaterThan(20);
    expect(d[3]).toBe(255);
  });
  it("identity parameters give the identity table", () => {
    const lut = buildLut({ gamma: 1, lo: 0, hi: 1 });
    for (let i = 0; i < 256; i += 17) expect(lut[i]).toBe(i);
  });
  it("a dark frame ends up around mid grey through its own target LUT", () => {
    const d = frame([10, 20, 30, 40, 25], 2000);
    const s = lightStats(d)!;
    const t = computeTarget(s);
    applyLut(d, buildLut(t));
    expect(lightStats(d)!.mean).toBeGreaterThan(0.35);
    expect(lightStats(d)!.mean).toBeLessThan(0.7);
  });
});

describe("confidenceFor", () => {
  it("lowers the MediaPipe thresholds as the picture gets darker (in few steps)", () => {
    expect(confidenceFor(0).det).toBe(0.5);
    expect(confidenceFor(0.5).det).toBeLessThan(0.5);
    expect(confidenceFor(1).det).toBeLessThan(confidenceFor(0.5).det);
    expect(confidenceFor(1).det).toBeGreaterThanOrEqual(0.3);
    expect(new Set([0, 0.05, 0.1, 0.5, 0.6, 0.9, 1].map((d) => confidenceFor(d).det)).size).toBeLessThanOrEqual(4);
  });
});

describe("LowLightController (decision with hysteresis)", () => {
  const feed = (c: LowLightController, s: LightStats, n: number, t0 = 0): number => {
    let t = t0;
    for (let i = 0; i < n; i++) c.update(s, (t += 100));
    return t;
  };

  it("does nothing in good light (no CPU spent on the pixel pass)", () => {
    const c = new LowLightController();
    feed(c, stat(0.5, 0.05, 0.95), 50);
    expect(c.state.active).toBe(false);
    expect(c.state.darkness).toBe(0);
    expect(c.tooDark).toBe(false);
  });

  it("starts after a few dark samples, not on a single one (a passing shadow)", () => {
    const c = new LowLightController();
    c.update(stat(0.1, 0.02, 0.22), 100);
    expect(c.state.active).toBe(false);
    feed(c, stat(0.1, 0.02, 0.22), 12, 100);
    expect(c.state.active).toBe(true);
    expect(c.state.gamma).toBeLessThan(0.85);
    expect(c.state.darkness).toBeGreaterThan(0.5);
  });

  it("fades in smoothly (no jump of the exposure)", () => {
    const c = new LowLightController();
    const seen: number[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) {
      c.update(stat(0.1, 0.02, 0.22), (t += 100));
      seen.push(c.state.gamma);
    }
    for (let i = 1; i < seen.length; i++) expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThan(0.15);
  });

  it("stops only after a long run of good samples, and goes fully inactive", () => {
    const c = new LowLightController();
    let t = feed(c, stat(0.1, 0.02, 0.22), 15);
    expect(c.state.active).toBe(true);
    t = feed(c, stat(0.5, 0.05, 0.95), 5, t);
    expect(c.state.active).toBe(true); // brief light flicker: still on
    feed(c, stat(0.5, 0.05, 0.95), 40, t);
    expect(c.state.active).toBe(false);
    expect(c.state.gamma).toBe(1);
  });

  it("tells the player only when it stays really dark for a while, and clears again", () => {
    const c = new LowLightController();
    let t = feed(c, stat(0.05, 0.01, 0.1), 10);
    expect(c.tooDark).toBe(false); // 1 s is not enough
    t = feed(c, stat(0.05, 0.01, 0.1), 20, t);
    expect(c.tooDark).toBe(true);
    feed(c, stat(0.15, 0.03, 0.3), 5, t);
    expect(c.tooDark).toBe(false);
    // dim but usable room (the enhancement handles it): no hint
    const d = new LowLightController();
    feed(d, stat(0.15, 0.03, 0.3), 60);
    expect(d.tooDark).toBe(false);
    expect(d.state.active).toBe(true);
  });

  it("ignores missing data", () => {
    const c = new LowLightController();
    expect(c.update(null, 0).active).toBe(false);
  });
});
