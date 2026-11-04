import { describe, expect, it } from "vitest";
import { CLOUDS, cloudSpot, smooth, windGain, wristSpeed } from "./logic";

describe("shamol logic", () => {
  it("wrist speed is in body scales per second", () => {
    expect(wristSpeed(30, 40, 0.5, 50)).toBeCloseTo(2);
    expect(wristSpeed(10, 10, 0, 50)).toBe(0);
  });
  it("a slow hand does not charge the wind, a fast one does, waving helps", () => {
    expect(windGain(1, false)).toBe(0);
    expect(windGain(4.5, false)).toBeCloseTo(1);
    expect(windGain(100, false)).toBeCloseTo(1.2);
    expect(windGain(0, true)).toBeCloseTo(0.5);
    expect(windGain(4.5, true)).toBeGreaterThan(windGain(4.5, false));
  });
  it("smoothing moves toward the target without overshoot", () => {
    const v = smooth(0, 10, 0.016);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(10);
    expect(smooth(10, 10, 0.1)).toBe(10);
  });
  it("clouds hang above the head, left to right", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    cloudSpot(a, 500, 400, 30, 60, 0);
    cloudSpot(b, 500, 400, 30, 60, CLOUDS - 1);
    expect(a.x).toBeLessThan(500);
    expect(b.x).toBeGreaterThan(500);
    expect(a.y).toBeLessThan(400);
  });
});
