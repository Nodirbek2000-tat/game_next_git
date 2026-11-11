import { describe, expect, it } from "vitest";
import { EXERCISE_LIST } from "@/lib/fitness/exercises";
import { SteadyLandmarks } from "./body";
import { demoPose } from "./demo";
import type { Lm } from "./form";

const frame = (x: number, v = 0.9): Lm[] => Array.from({ length: 33 }, () => ({ x, y: 100, v }));

describe("SteadyLandmarks", () => {
  it("smooths jitter but follows a real move within a few frames", () => {
    const s = new SteadyLandmarks();
    s.update(frame(100), 1 / 30);
    const a = s.update(frame(104), 1 / 30)[0].x;
    expect(a).toBeGreaterThan(100);
    expect(a).toBeLessThan(104);
    let x = 0;
    for (let i = 0; i < 8; i++) x = s.update(frame(200), 1 / 30)[0].x;
    expect(x).toBeGreaterThan(195);
  });
  it("a point lost for a moment keeps its last position; lost for long it is not seen any more", () => {
    const s = new SteadyLandmarks();
    s.update(frame(100), 1 / 30);
    let o = s.update(frame(500, 0.1), 0.1);
    expect(o[0].v).toBeGreaterThanOrEqual(0.4);
    expect(o[0].x).toBeCloseTo(100);
    for (let i = 0; i < 5; i++) o = s.update(frame(500, 0.1), 0.1);
    expect(o[0].v).toBeLessThan(0.4);
  });
});

describe("coach animation", () => {
  it("every exercise has a pose inside its panel at any time", () => {
    for (const ex of EXERCISE_LIST)
      for (let t = 0; t < 6; t += 0.37) {
        const p = demoPose(ex.id, t);
        for (const [x, y] of Object.values(p)) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
          expect(y).toBeGreaterThanOrEqual(-0.15);
          expect(y).toBeLessThanOrEqual(1.05);
        }
      }
  });
});
