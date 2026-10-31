import { describe, expect, it } from "vitest";
import { CROWD_CFG } from "./crowdConfig";
import { CrowdVision, TileController } from "./crowdVision";

const A = CROWD_CFG.adapt;
const CAP = 1000 / 30;

/** feed `sec` seconds of model calls of `ms` each, one call per max(cap, ms); returns the time after */
function feed(c: TileController | CrowdVision, t0: number, sec: number, ms: number, cap = CAP): number {
  let t = t0;
  const end = t0 + sec;
  while (t < end) {
    c.report(t, ms, cap);
    t += Math.max(cap, ms) / 1000;
  }
  return t;
}

describe("TileController", () => {
  it("stays on 2 crops while the model is fast", () => {
    const c = new TileController([2, 1]);
    feed(c, 0, 60, 12);
    expect(c.count).toBe(2);
    expect(c.cycleMs).toBeCloseTo(2 * Math.max(CAP, 12 + A.overheadMs), 5);
  });

  it("steps down to the whole frame when a round of crops takes too long, not before downAfterSec", () => {
    const c = new TileController([2, 1]);
    // 2 crops x 90 ms = 180 ms > maxCycleMs
    const t = feed(c, 0, A.downAfterSec - 0.5, 90);
    expect(c.count).toBe(2);
    feed(c, t, 2, 90);
    expect(c.count).toBe(1);
  });

  it("3 -> 2 -> 1 one rung at a time, with a pause between the changes", () => {
    const c = new TileController([3, 2, 1]);
    let t = feed(c, 0, A.downAfterSec + 1, 70); // 3 x 73 = 219 ms
    expect(c.count).toBe(2); // 2 x 73 = 146 < 150: stays here
    t = feed(c, t, 10, 70);
    expect(c.count).toBe(2);
    feed(c, t, 10, 90);
    expect(c.count).toBe(1);
  });

  it("a short spike does not change anything", () => {
    const c = new TileController([2, 1]);
    let t = feed(c, 0, 5, 12);
    t = feed(c, t, 0.8, 120);
    feed(c, t, 5, 12);
    expect(c.count).toBe(2);
  });

  it("climbs back after a long calm spell, and waits longer after a failed attempt", () => {
    const c = new TileController([2, 1]);
    let t = feed(c, 0, 5, 12); // learns the crop time
    t = feed(c, t, 6, 100); // too slow -> whole frame
    expect(c.count).toBe(1);
    // whole frame is fast now (a crop would be ~ 0.75 x 20 ms): up after upAfterSec
    t = feed(c, t, A.upAfterSec - 3, 20);
    expect(c.count).toBe(1);
    t = feed(c, t, 8, 20);
    expect(c.count).toBe(2);
    // slow again right after: down again, and the next up wait is doubled
    t = feed(c, t, 6, 100);
    expect(c.count).toBe(1);
    const t1 = t;
    t = feed(c, t, A.upAfterSec + 1, 20);
    expect(c.count).toBe(1); // still waiting (twice as long)
    t = feed(c, t, A.upAfterSec + 1, 20);
    expect(c.count).toBe(2);
    expect(t - t1).toBeGreaterThan(A.upAfterSec * 2);
  });

  it("does not climb while the whole frame itself is slow", () => {
    const c = new TileController([2, 1]);
    const t = feed(c, 0, 4, 100);
    expect(c.count).toBe(1);
    feed(c, t, 60, 80);
    expect(c.count).toBe(1);
  });

  it("a fixed controller never changes", () => {
    const c = new TileController([2], false);
    feed(c, 0, 30, 200);
    expect(c.count).toBe(2);
  });

  it("round-robin cursor", () => {
    const c = new TileController([2, 1]);
    const seq = Array.from({ length: 6 }, () => c.next(2));
    expect(seq).toEqual([1, 0, 1, 0, 1, 0]);
  });
});

describe("CrowdVision", () => {
  const W = 1280;
  const H = 720;

  it("plans crops in turn once the models are ready, the whole frame before that", () => {
    const v = new CrowdVision({ force: null, allow: true });
    expect(v.maxTiles).toBe(2);
    expect(v.plan(W, H, 0)).toBeNull();
    expect(v.plan(W, H, 1)).toBeNull(); // the second crop model is not ready yet
    const idx = Array.from({ length: 4 }, () => (v.plan(W, H, 2) as { index: number }[])[0].index);
    expect(idx[0]).not.toBe(idx[1]);
    expect(new Set(idx)).toEqual(new Set([0, 1]));
    expect(v.tiled).toBe(true);
    expect(v.plan(W, H, 0)).toBeNull();
    expect(v.tiled).toBe(false);
  });

  it("falls back to the whole frame for pictures that are not wide enough", () => {
    const v = new CrowdVision({ force: null, allow: true });
    expect(v.plan(640, 480, 2)).toBeNull();
  });

  it("is off when not allowed (phones / main thread), or with ?tiles=0", () => {
    expect(new CrowdVision({ force: null, allow: false }).maxTiles).toBe(0);
    expect(new CrowdVision({ force: 0, allow: true }).plan(W, H, 3)).toBeNull();
    expect(new CrowdVision({ force: 0, allow: true }).maxTiles).toBe(0);
  });

  it("?tiles=2 / 3 forces that many crops even where it is not allowed, and does not step down", () => {
    const v = new CrowdVision({ force: 3, allow: false });
    expect(v.maxTiles).toBe(3);
    expect(v.plan(W, H, 3)).not.toBeNull();
    feed(v, 0, 30, 300);
    expect(v.ctl.count).toBe(3);
    expect(v.plan(W, H, 3)).not.toBeNull();
  });

  it("when the model is too slow the next plan is the whole frame and the older crop data is dropped", () => {
    const v = new CrowdVision({ force: null, allow: true });
    expect(v.plan(W, H, 2)).not.toBeNull();
    feed(v, 0, 6, 100);
    expect(v.ctl.count).toBe(1);
    expect(v.plan(W, H, 2)).toBeNull();
    expect(v.describe()).toBe("to‘liq kadr");
  });

  it("describes the crops in Uzbek for the debug line", () => {
    const v = new CrowdVision({ force: null, allow: true });
    v.plan(W, H, 2);
    expect(v.describe()).toContain("bo‘lak");
  });
});
