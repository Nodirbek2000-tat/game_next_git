import { describe, expect, it } from "vitest";
import { COLORS, pickTarget, shuffleColors, zoneCount, zoneOf } from "./logic";

describe("rangni-top logic", () => {
  it("zone count follows the group size", () => {
    expect(zoneCount(0)).toBe(2);
    expect(zoneCount(2)).toBe(2);
    expect(zoneCount(3)).toBe(3);
    expect(zoneCount(5)).toBe(3);
  });
  it("zoneOf clamps and splits evenly", () => {
    expect(zoneOf(0, 900, 3)).toBe(0);
    expect(zoneOf(299, 900, 3)).toBe(0);
    expect(zoneOf(300, 900, 3)).toBe(1);
    expect(zoneOf(899, 900, 3)).toBe(2);
    expect(zoneOf(-50, 900, 3)).toBe(0);
    expect(zoneOf(5000, 900, 3)).toBe(2);
  });
  it("shuffle gives distinct valid colours", () => {
    const out = [0, 0, 0, 0];
    for (let s = 0; s < 20; s++) {
      shuffleColors(out, 3, Math.random);
      const set = new Set(out.slice(0, 3));
      expect(set.size).toBe(3);
      for (const i of set) expect(i).toBeLessThan(COLORS.length);
    }
  });
  it("pickTarget never repeats the previous zone", () => {
    for (let i = 0; i < 100; i++) {
      const z = pickTarget(3, 1, Math.random);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThan(3);
      expect(z).not.toBe(1);
    }
  });
});
