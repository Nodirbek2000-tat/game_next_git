import { describe, expect, it } from "vitest";
import { HOLD_SEC, classify, holdStep, nextLetter, type ShapeIn } from "./logic";

// body scale 60 px, head at y=200, shoulders at y=300, centre x=500
const base: ShapeIn = { scale: 60, headY: 200, shoulderY: 300, lwx: 0, lwy: 0, lwv: 1, rwx: 0, rwy: 0, rwv: 1, ankleDx: 80, legsSeen: true };
const pose = (lx: number, ly: number, rx: number, ry: number, over: Partial<ShapeIn> = {}): ShapeIn => ({ ...base, lwx: lx, lwy: ly, rwx: rx, rwy: ry, ...over });

describe("harflar logic", () => {
  it("I = hands up together", () => {
    expect(classify(pose(480, 100, 520, 100))).toBe("I");
  });
  it("T = arms out sideways at shoulder height", () => {
    expect(classify(pose(300, 310, 700, 295))).toBe("T");
    expect(classify(pose(300, 450, 700, 450))).toBe("");
  });
  it("Y = V up with legs together, X = V up with legs wide", () => {
    expect(classify(pose(350, 100, 650, 100))).toBe("Y");
    expect(classify(pose(350, 100, 650, 100, { ankleDx: 150 }))).toBe("X");
    // legs not in the picture: never X
    expect(classify(pose(350, 100, 650, 100, { ankleDx: 150, legsSeen: false }))).toBe("Y");
  });
  it("hidden wrists or arms down are no letter", () => {
    expect(classify(pose(480, 100, 520, 100, { lwv: 0.05 }))).toBe("");
    expect(classify(pose(480, 450, 520, 450))).toBe("");
  });
  it("hold grows, then drains twice as fast", () => {
    let h = 0;
    for (let i = 0; i < 10; i++) h = holdStep(h, true, 0.1);
    expect(h).toBeCloseTo(HOLD_SEC);
    expect(holdStep(0.5, false, 0.1)).toBeCloseTo(0.3);
    expect(holdStep(0.1, false, 0.5)).toBe(0);
  });
  it("next letter differs and skips X without legs", () => {
    for (let i = 0; i < 20; i++) {
      const l = nextLetter("T", i / 20, false);
      expect(l).not.toBe("T");
      expect(l).not.toBe("X");
    }
    expect(nextLetter("I", 0.99, true)).toBe("X");
  });
});
