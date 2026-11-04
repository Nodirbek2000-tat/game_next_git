import { describe, expect, it } from "vitest";
import { MAX_STARS, catchHit, catchRadius, fallSpeed, isBonus, starCap } from "./logic";

describe("yulduz-ushla logic", () => {
  it("star cap grows with children, never above the pool", () => {
    expect(starCap(0)).toBe(starCap(1));
    expect(starCap(3)).toBeGreaterThan(starCap(1));
    for (let k = 0; k <= 9; k++) expect(starCap(k)).toBeLessThanOrEqual(MAX_STARS);
  });
  it("catch radius has a minimum for far children", () => {
    expect(catchRadius(5, 50, 20)).toBe(50 * 0.6 + 20);
    expect(catchRadius(100, 50, 20)).toBe(80);
  });
  it("hit test", () => {
    expect(catchHit(0, 0, 3, 4, 5)).toBe(true);
    expect(catchHit(0, 0, 3, 4, 4.9)).toBe(false);
  });
  it("bonus every 10th", () => {
    expect(isBonus(0)).toBe(false);
    expect(isBonus(10)).toBe(true);
    expect(isBonus(11)).toBe(false);
    expect(isBonus(20)).toBe(true);
  });
  it("gold stars fall slower than the slowest normal star", () => {
    expect(fallSpeed(800, true, 0)).toBeLessThan(fallSpeed(800, false, 0));
  });
});
