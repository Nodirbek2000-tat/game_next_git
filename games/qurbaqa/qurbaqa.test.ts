import { describe, expect, it } from "vitest";
import { jumpedRecently, logAtKid, logReach, logX, slotBit } from "./logic";

describe("qurbaqa logic", () => {
  it("log crosses the whole stage in both directions", () => {
    expect(logX(0, 4, 1, 1000, 200)).toBe(-100);
    expect(logX(4, 4, 1, 1000, 200)).toBe(1100);
    expect(logX(0, 4, -1, 1000, 200)).toBe(1100);
    expect(logX(2, 4, -1, 1000, 200)).toBe(500);
    expect(logX(9, 4, 1, 1000, 200)).toBe(1100);
  });
  it("log reaches a child", () => {
    const r = logReach(60, 1000, 200);
    expect(r).toBe(100 + 72);
    expect(logAtKid(500, 400, r)).toBe(true);
    expect(logAtKid(500, 300, r)).toBe(false);
  });
  it("recent jump window", () => {
    expect(jumpedRecently(10, 9.7)).toBe(true);
    expect(jumpedRecently(10, 9.2)).toBe(false);
    expect(jumpedRecently(10, -100)).toBe(false);
  });
  it("slot bits are distinct", () => {
    const m = [0, 1, 2, 3, 4].reduce((a, s) => a | slotBit(s), 0);
    expect(m).toBe(31);
  });
});
