import { describe, expect, it } from "vitest";
import { DetectionScheduler, RATE_LADDER, initialRung } from "./scheduler";

/** Feed a constant render fps for `seconds` (one sample per second); returns the last `now`. */
const feed = (s: DetectionScheduler, fps: number, seconds: number, now: number, floor = true): number => {
  for (let i = 0; i < seconds; i++) s.sample(fps, floor, ++now);
  return now;
};

describe("DetectionScheduler", () => {
  it("strong CPUs start at the highest rate, weak ones lower", () => {
    expect(new DetectionScheduler({ cores: 12, level: "high", mainThread: false }).capFps).toBe(60);
    expect(new DetectionScheduler({ cores: 4, level: "medium", mainThread: false }).capFps).toBe(30);
    expect(new DetectionScheduler({ cores: 2, level: "low", mainThread: false }).capFps).toBeLessThanOrEqual(24);
    expect(initialRung(8, "low", true)).toBeGreaterThanOrEqual(2); // main thread inference is capped too
  });

  it("keeps the rate while rendering is smooth", () => {
    const s = new DetectionScheduler({ cores: 8, level: "high", mainThread: false });
    feed(s, 60, 60, 0);
    expect(s.capFps).toBe(60);
  });

  it("does not touch the detection while graphics can still be reduced (tracking first)", () => {
    const s = new DetectionScheduler({ cores: 8, level: "high", mainThread: false });
    feed(s, 25, 30, 0, false);
    expect(s.capFps).toBe(60);
  });

  it("lowers the rate when rendering stays slow with the cheapest graphics, within seconds", () => {
    const s = new DetectionScheduler({ cores: 8, level: "low", mainThread: false });
    feed(s, 30, 4, 0, true);
    expect(s.capFps).toBeLessThan(60);
  });

  it("never goes below the last rung and recovers slowly, only up to its start", () => {
    const s = new DetectionScheduler({ cores: 8, level: "low", mainThread: false });
    let now = feed(s, 10, 120, 0, true);
    expect(s.capFps).toBe(RATE_LADDER[RATE_LADDER.length - 1]);
    now = feed(s, 60, 8, now);
    expect(s.capFps).toBe(RATE_LADDER[RATE_LADDER.length - 1]); // not yet
    feed(s, 60, 200, now);
    expect(s.capFps).toBe(60);
  });

  it("main-thread inference lowers the rate even before the graphics are at their floor, and bounds the interval by the model time", () => {
    const s = new DetectionScheduler({ cores: 8, level: "high", mainThread: true });
    const start = s.capFps;
    feed(s, 25, 6, 0, false);
    expect(s.capFps).toBeLessThan(start);
    expect(s.minIntervalMs(30)).toBeGreaterThanOrEqual(60);
    const w = new DetectionScheduler({ cores: 8, level: "high", mainThread: false });
    expect(w.minIntervalMs(30)).toBeCloseTo(1000 / 60, 5); // a worker never blocks rendering
  });

  it("smaller model input on the lower rungs", () => {
    const hi = new DetectionScheduler({ cores: 8, level: "high", mainThread: false });
    const lo = new DetectionScheduler({ cores: 2, level: "low", mainThread: false });
    expect(lo.maxSide).toBeLessThan(hi.maxSide);
  });
});
