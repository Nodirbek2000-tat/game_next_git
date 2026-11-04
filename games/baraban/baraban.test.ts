import { describe, expect, it } from "vitest";
import { BEAT, PATTERNS, activeBeat, approachRing, blockOf, drumRadius, drumSpot, enteredDrum, isHighBlock, isPerfect, sideAt } from "./logic";

describe("baraban logic", () => {
  it("beat windows cover the timeline after the first half beat", () => {
    expect(activeBeat(0.1)).toBe(-1);
    expect(activeBeat(BEAT)).toBe(1);
    expect(activeBeat(BEAT * 2 - 0.3)).toBe(2);
    expect(activeBeat(BEAT * 2 + 0.3)).toBe(2);
    expect(activeBeat(BEAT * 3 + 0.1)).toBe(3);
  });
  it("patterns map beats to sides", () => {
    expect(sideAt("LRLR", 0)).toBe(0);
    expect(sideAt("LRLR", 1)).toBe(1);
    expect(sideAt("LRLR", 6)).toBe(0);
    for (const p of PATTERNS) expect(p).toMatch(/^[LR]+$/);
  });
  it("blocks of 8 beats, every third one is high", () => {
    expect(blockOf(7)).toBe(0);
    expect(blockOf(8)).toBe(1);
    expect([0, 1, 2, 3, 5].map(isHighBlock)).toEqual([false, false, true, false, true]);
  });
  it("perfect hit is close to the beat", () => {
    expect(isPerfect(BEAT * 2 + 0.1, 2)).toBe(true);
    expect(isPerfect(BEAT * 2 + 0.3, 2)).toBe(false);
  });
  it("only entering a drum is a hit", () => {
    expect(enteredDrum(100, 20, 50)).toBe(true);
    expect(enteredDrum(30, 20, 50)).toBe(false);
    expect(enteredDrum(100, 60, 50)).toBe(false);
  });
  it("drums sit left and right of the head, higher in high mode", () => {
    const l = { x: 0, y: 0 };
    const r = { x: 0, y: 0 };
    drumSpot(l, 500, 200, 30, 300, 60, 0, false);
    drumSpot(r, 500, 200, 30, 300, 60, 1, false);
    expect(l.x).toBeLessThan(500);
    expect(r.x).toBeGreaterThan(500);
    expect(l.y).toBeGreaterThan(300);
    const hi = { x: 0, y: 0 };
    drumSpot(hi, 500, 200, 30, 300, 60, 0, true);
    expect(hi.y).toBeLessThan(200);
  });
  it("radius has a minimum, the ring closes in", () => {
    expect(drumRadius(10, 40)).toBe(30);
    expect(approachRing(-0.1, 50)).toBe(0);
    expect(approachRing(0.4, 50)).toBeGreaterThan(approachRing(0.1, 50));
  });
});
