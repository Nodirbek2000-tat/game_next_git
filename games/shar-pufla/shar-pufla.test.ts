import { describe, expect, it } from "vitest";
import { PUMPS, PumpCounter, balloonRadius } from "./logic";

describe("shar-pufla logic", () => {
  it("a pump is a squat followed by standing up", () => {
    const p = new PumpCounter();
    expect(p.step(false, 0.05)).toBe(false);
    expect(p.step(true, 0.1)).toBe(false);
    expect(p.step(true, 0.1)).toBe(false);
    expect(p.step(false, 0.05)).toBe(true);
    expect(p.step(false, 0.05)).toBe(false);
  });
  it("a flicker of the squat signal is not a pump", () => {
    const p = new PumpCounter();
    p.step(true, 0.03);
    expect(p.step(false, 0.03)).toBe(false);
  });
  it("the balloon grows with every pump and has a minimum size", () => {
    const a = balloonRadius(0, 60, 720);
    const b = balloonRadius(PUMPS, 60, 720);
    expect(b).toBeGreaterThan(a);
    expect(balloonRadius(99, 60, 720)).toBe(b);
    expect(balloonRadius(0, 5, 720)).toBeCloseTo(720 * 0.04);
  });
});
