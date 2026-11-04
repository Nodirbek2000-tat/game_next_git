import { describe, expect, it } from "vitest";
import { FlapDetector, altitudeY, climb } from "./logic";

describe("kapalak logic", () => {
  it("counts swings between arms up and arms down", () => {
    const d = new FlapDetector();
    // shoulders at y=300, scale 60: up = well above, down = well below
    expect(d.step(200, 300, 60)).toBe(0); // first state, nothing to count
    expect(d.step(380, 300, 60)).toBe(1);
    expect(d.step(390, 300, 60)).toBe(0); // still down
    expect(d.step(200, 300, 60)).toBe(1);
    expect(d.step(310, 300, 60)).toBe(0); // in between: no change
    expect(d.step(200, 300, 60)).toBe(0);
  });
  it("climbs with flaps, sinks slowly and stays in 0..1", () => {
    expect(climb(0.5, 1, 0)).toBeCloseTo(0.6);
    expect(climb(0.5, 0, 2)).toBeLessThan(0.5);
    expect(climb(0, 0, 10)).toBe(0);
    expect(climb(0.95, 3, 0)).toBe(1);
  });
  it("maps altitude to screen height", () => {
    expect(altitudeY(0, 800, 200)).toBe(800);
    expect(altitudeY(1, 800, 200)).toBe(200);
    expect(altitudeY(0.5, 800, 200)).toBe(500);
  });
});
