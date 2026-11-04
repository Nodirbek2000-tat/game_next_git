import { describe, expect, it } from "vitest";
import { APPLES, applePlace, basketStar, pickHit } from "./logic";

describe("olma-ter logic", () => {
  it("apples hang above the head, never under the HUD", () => {
    const o = { x: 0, y: 0 };
    for (let i = 0; i < APPLES; i++) {
      applePlace(500, 400, 60, i, 100, o);
      expect(o.y).toBeLessThan(400);
    }
    applePlace(500, 150, 60, 1, 170, o);
    expect(o.y).toBe(170);
    applePlace(500, 400, 60, 0, 0, o);
    expect(o.x).toBeLessThan(500);
    applePlace(500, 400, 60, 2, 0, o);
    expect(o.x).toBeGreaterThan(500);
  });
  it("only a raised, visible hand near the apple picks it", () => {
    expect(pickHit(100, 100, 0.9, true, 110, 110, 40)).toBe(true);
    expect(pickHit(100, 100, 0.9, false, 110, 110, 40)).toBe(false);
    expect(pickHit(100, 100, 0.05, true, 110, 110, 40)).toBe(false);
    expect(pickHit(100, 100, 0.9, true, 300, 110, 40)).toBe(false);
  });
  it("a star for every second apple", () => {
    expect([0, 1, 2, 3, 4].map(basketStar)).toEqual([false, false, true, false, true]);
  });
});
