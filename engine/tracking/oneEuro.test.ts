import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { OneEuro } from "./oneEuro";

const std = (a: number[]) => {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
};

describe("OneEuro", () => {
  it("returns the first sample unchanged and keeps a constant signal constant", () => {
    const f = new OneEuro(1.6, 2.5);
    expect(f.filter(0.42, 0)).toBe(0.42);
    for (let t = 33; t < 1000; t += 33) expect(f.filter(0.42, t)).toBeCloseTo(0.42, 10);
  });

  it("removes jitter of a resting point", () => {
    const f = new OneEuro(1.6, 2.5);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01; // +-0.5 % noise
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 0.5 + rnd();
      raw.push(x);
      out.push(f.filter(x, i * 33));
    }
    expect(std(out.slice(30))).toBeLessThan(std(raw.slice(30)) * 0.7);
  });

  it("follows fast motion with little lag (speed-adaptive cutoff)", () => {
    const f = new OneEuro(1.6, 2.5);
    let last = 0;
    // 1.5 screen heights per second
    for (let i = 0; i < 40; i++) last = f.filter(i * 0.05, i * 33);
    const target = 39 * 0.05;
    expect(target - last).toBeLessThan(0.08);
    // a slow filter (beta 0) lags much more on the same signal
    const slow = new OneEuro(1.6, 0);
    let s = 0;
    for (let i = 0; i < 40; i++) s = slow.filter(i * 0.05, i * 33);
    expect(target - s).toBeGreaterThan(target - last);
  });

  it("resets after a gap longer than 500 ms", () => {
    const f = new OneEuro(1.6, 2.5);
    f.filter(0, 0);
    f.filter(0, 33);
    expect(f.filter(5, 2000)).toBe(5);
  });
});

describe("OneEuro engine defaults (low latency)", () => {
  // a fast sweep (about 3.3 screen heights / s) with a little sensor noise, sampled at 30 Hz
  const sweepError = (minCutoff: number, beta: number, dCutoff: number): number => {
    const f = new OneEuro(minCutoff, beta, dCutoff);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
    let err = 0;
    let n = 0;
    for (let i = 0; i < 90; i++) {
      const t = i * 33.3;
      const truth = 0.5 + 0.35 * Math.sin((2 * Math.PI * 1.5 * t) / 1000);
      err += Math.abs(f.filter(truth + rnd(), t) - truth);
      n++;
    }
    return err / n;
  };
  it("lags far less than the old settings on fast motion", () => {
    const f = DEFAULT_CONFIG.filter;
    expect(sweepError(f.minCutoff, f.beta, f.dCutoff)).toBeLessThan(sweepError(1.6, 2.5, 1) * 0.5);
  });
  it("still holds a resting point still", () => {
    const c = DEFAULT_CONFIG.filter;
    const f = new OneEuro(c.minCutoff, c.beta, c.dCutoff);
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.006;
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 0.5 + rnd();
      raw.push(x);
      out.push(f.filter(x, i * 33));
    }
    expect(std(out.slice(30))).toBeLessThan(std(raw.slice(30)) * 0.8);
  });
});
