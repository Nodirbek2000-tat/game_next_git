import { describe, expect, it } from "vitest";
import { QualityController, levelFromTier } from "./controller";

/** Feed a constant fps for `seconds` (1 sample per second). Returns the final `now`. */
function feed(q: QualityController, fps: number, seconds: number, now: number): number {
  for (let i = 0; i < seconds; i++) q.sample(fps, ++now);
  return now;
}

describe("levelFromTier", () => {
  it("maps device tiers to start levels", () => {
    expect(levelFromTier(3, false)).toBe("high");
    expect(levelFromTier(3, true)).toBe("low"); // phones/tablets always start cheap
    expect(levelFromTier(2, true)).toBe("low");
    expect(levelFromTier(2, false)).toBe("medium");
    expect(levelFromTier(1, false)).toBe("low");
    expect(levelFromTier(0, false)).toBe("low");
  });
});

describe("QualityController", () => {
  it("exposes the parameter set of the level", () => {
    const q = new QualityController({ initial: "high", adaptive: true, devicePixelRatio: 2 });
    expect(q.params).toMatchObject({ level: "high", shadows: true, postfx: true, pixelRatio: 1.5 });
    const l = new QualityController({ initial: "low", adaptive: true, devicePixelRatio: 2 });
    expect(l.params).toMatchObject({ level: "low", shadows: false, postfx: false, pixelRatio: 1 });
  });

  it("medium and low render at pixel ratio 1 without shadows", () => {
    const m = new QualityController({ initial: "medium", adaptive: true, devicePixelRatio: 2 });
    expect(m.params).toMatchObject({ level: "medium", shadows: false, pixelRatio: 1 });
  });

  it("caps the pixel ratio by the screen's device pixel ratio", () => {
    expect(new QualityController({ initial: "high", adaptive: true, devicePixelRatio: 1 }).params.pixelRatio).toBe(1);
  });

  it("does nothing while the fps is fine", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    feed(q, 60, 60, 0);
    expect(q.level).toBe("high");
    expect(q.scale).toBe(1);
  });

  it("low fps: first lowers the resolution scale, then drops the level", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    let now = feed(q, 30, 2, 0);
    expect(q.level).toBe("high");
    expect(q.scale).toBeLessThan(1);
    expect(q.params.pixelRatio).toBeLessThan(1.5);
    for (let i = 0; i < 40 && q.level === "high"; i++) now = feed(q, 30, 1, now);
    expect(q.level).toBe("medium");
    expect(q.scale).toBe(1);
  });

  it("never goes below 'low' and never raises postfx on weak devices", () => {
    const q = new QualityController({ initial: "low", adaptive: true });
    feed(q, 10, 120, 0);
    expect(q.level).toBe("low");
    expect(q.params.postfx).toBe(false);
  });

  it("recovers slowly after a downgrade (but never above the start level)", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    let now = 0;
    for (let i = 0; i < 80 && q.level === "high"; i++) now = feed(q, 25, 1, now);
    expect(q.level).toBe("medium");
    // short good spell: not enough to upgrade (needs 2x the normal wait)
    now = feed(q, 60, 15, now);
    expect(q.level).toBe("medium");
    now = feed(q, 60, 60, now);
    expect(q.level).toBe("high");
    feed(q, 60, 200, now);
    expect(q.level).toBe("high");
  });

  it("a forced quality never changes", () => {
    const q = new QualityController({ initial: "medium", adaptive: false });
    feed(q, 5, 100, 0);
    expect(q.level).toBe("medium");
    expect(q.scale).toBe(1);
  });

  it("notifies on change", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    const seen: string[] = [];
    q.onChange = (p) => seen.push(`${p.level}@${p.resolutionScale}`);
    feed(q, 20, 10, 0);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("QualityController reaction speed and floor", () => {
  it("a very slow device (< 50 % of target) drops a whole level within ~1 s, not in baby steps", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    feed(q, 20, 2, 0);
    expect(q.level).toBe("medium");
    expect(q.scale).toBe(1);
  });

  it("a moderately slow device reacts within about 2 s (first the resolution)", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    feed(q, 40, 3, 0);
    expect(q.scale).toBeLessThan(1);
  });

  it("goes below the old 0.75 pixel ratio on 'low' and then squeezes particles / view distance", () => {
    const q = new QualityController({ initial: "low", adaptive: true, devicePixelRatio: 1 });
    const before = q.params;
    feed(q, 12, 40, 0);
    expect(q.params.pixelRatio).toBeLessThan(0.75);
    expect(q.params.pixelRatio).toBeGreaterThanOrEqual(0.5);
    expect(q.params.particles).toBeLessThan(before.particles);
    expect(q.params.viewDistance).toBeLessThan(before.viewDistance);
    expect(q.atFloor).toBe(true);
  });

  it("recovers from the floor step by step when the fps is good again", () => {
    const q = new QualityController({ initial: "low", adaptive: true, devicePixelRatio: 1 });
    const now = feed(q, 12, 40, 0);
    expect(q.atFloor).toBe(true);
    feed(q, 60, 900, now);
    expect(q.atFloor).toBe(false);
    expect(q.scale).toBe(1);
    expect(q.params.particles).toBeCloseTo(0.4, 5);
  });

  it("hold() ignores the first seconds (shader compilation hitches)", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    q.hold(3);
    feed(q, 10, 2, 0);
    expect(q.level).toBe("high");
    expect(q.scale).toBe(1);
    feed(q, 10, 6, 2);
    expect(q.level).not.toBe("high");
  });

  it("a short hitch does not downgrade", () => {
    const q = new QualityController({ initial: "high", adaptive: true });
    let now = feed(q, 60, 5, 0);
    q.sample(20, now + 0.4); // a 0.4 s hitch
    now += 0.4;
    feed(q, 60, 10, now);
    expect(q.level).toBe("high");
    expect(q.scale).toBe(1);
  });
});
