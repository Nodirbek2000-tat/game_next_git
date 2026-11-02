import { describe, expect, it } from "vitest";
import { CAMERA_IDEAL_MOBILE, swapIdealSize } from "./camera/camera";
import { portraitFov } from "./math";
import { computeFit, toStage } from "./tracking/people";

describe("portrait (upright phone)", () => {
  it("keeps the vertical field of view on landscape / square screens", () => {
    expect(portraitFov(58, 16 / 9)).toBe(58);
    expect(portraitFov(58, 1)).toBe(58);
  });

  it("widens it on a tall screen, with a cap, and never narrows it", () => {
    const f = portraitFov(58, 390 / 844);
    expect(f).toBeGreaterThan(58);
    expect(f).toBeLessThanOrEqual(96);
    // the horizontal field ends up near 62 degrees (or the cap)
    const h = (2 * Math.atan(Math.tan((f * Math.PI) / 360) * (390 / 844)) * 180) / Math.PI;
    expect(h).toBeGreaterThan(50);
    expect(portraitFov(100, 0.46)).toBe(100);
  });

  it("asks a portrait camera picture by swapping width and height", () => {
    const s = swapIdealSize(CAMERA_IDEAL_MOBILE);
    expect(s.width).toEqual(CAMERA_IDEAL_MOBILE.height);
    expect(s.height).toEqual(CAMERA_IDEAL_MOBILE.width);
    expect(s.frameRate).toEqual(CAMERA_IDEAL_MOBILE.frameRate);
  });

  it("maps a portrait camera frame onto a portrait stage (cover fit), mirrored", () => {
    const fit = computeFit(390, 844, 270, 480);
    // cover fit: the frame keeps its own shape and fills the stage height (only the sides are cropped)
    expect(fit.dw / fit.dh).toBeCloseTo(270 / 480, 5);
    expect(fit.dh).toBeCloseTo(844, 5);
    const p = toStage({ x: 0.25, y: 0.5 }, computeFit(390, 780, 390, 780), { x: 0, y: 0, v: 0 });
    expect(p.x).toBeCloseTo(390 * 0.75, 5);
    expect(p.y).toBeCloseTo(390, 5);
  });
});
