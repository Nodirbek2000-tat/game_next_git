import { describe, expect, it } from "vitest";
import { emptyHead, headTurn, lookPitch, shapeTurn, turnToYawDeg, ViewController, VIEW, type HeadInput } from "./view";

/** a standing person, shoulders 200 px apart, ears 40 px apart; `shift` moves the nose sideways (px, + = right) */
const head = (shift = 0, o: Partial<HeadInput> = {}): HeadInput => ({
  ...emptyHead(),
  noseX: 500 + shift, noseV: 0.99, earLX: 480, earLV: 0.9, earRX: 520, earRV: 0.9, shLX: 400, shRX: 600, shV: 0.99, ...o,
});

describe("head -> turn", () => {
  it("nose right of the ears = turn right (+), left = (-), centred = 0", () => {
    expect(headTurn(head(0))).toBeCloseTo(0, 6);
    expect(headTurn(head(20))).toBeGreaterThan(0.4);
    expect(headTurn(head(-20))).toBeLessThan(-0.4);
    expect(headTurn(head(20))).toBeCloseTo(-headTurn(head(-20)), 6);
  });
  it("does not depend on where the body stands or how far the player is", () => {
    const a = headTurn(head(15));
    const moved = headTurn({ ...head(15), noseX: 515 + 300, earLX: 780, earRX: 820, shLX: 700, shRX: 900 });
    expect(moved).toBeCloseTo(a, 6);
    // twice as far from the camera: everything half the size
    const far = headTurn({ ...emptyHead(), noseX: 500 + 7.5, noseV: 1, earLX: 490, earLV: 1, earRX: 510, earRV: 1, shLX: 450, shRX: 550, shV: 1 });
    expect(far).toBeCloseTo(a, 6);
  });
  it("falls back to the shoulders when an ear is hidden, and gives NaN when nothing is visible", () => {
    const t = headTurn(head(30, { earRV: 0.1 }));
    expect(t).toBeGreaterThan(0.3);
    expect(headTurn(head(0, { noseV: 0.1 }))).toBeNaN();
    expect(headTurn(head(0, { shV: 0.1 }))).toBeNaN();
  });
});

describe("dead zone and shaping", () => {
  it("small movements are ignored, larger ones turn, the result is capped", () => {
    expect(shapeTurn(0)).toBe(0);
    expect(shapeTurn(VIEW.deadZone * 0.9)).toBe(0);
    expect(shapeTurn(-VIEW.deadZone * 0.9)).toBe(0);
    expect(shapeTurn(VIEW.deadZone + 0.1)).toBeGreaterThan(0);
    expect(shapeTurn(5)).toBe(1);
    expect(shapeTurn(-5)).toBe(-1);
  });
  it("is monotonic and symmetric", () => {
    let prev = -2;
    for (let x = -1.5; x <= 1.5; x += 0.05) {
      const s = shapeTurn(x);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
      expect(shapeTurn(-x)).toBeCloseTo(-s, 9);
    }
  });
  it("turn -> degrees: neutral pose is subtracted, the limit is the view limit", () => {
    expect(turnToYawDeg(0.3, 0.3)).toBe(0);
    expect(turnToYawDeg(1.6, 0)).toBe(VIEW.maxYawDeg);
    expect(turnToYawDeg(-1.6, 0.2)).toBe(-VIEW.maxYawDeg);
    expect(turnToYawDeg(0.5, 0)).toBeGreaterThan(0);
    expect(turnToYawDeg(0.5, 0)).toBeLessThan(VIEW.maxYawDeg);
  });
});

describe("view controller", () => {
  const run = (v: ViewController, seconds: number, turn: number, key = 0) => {
    for (let t = 0; t < seconds; t += 1 / 60) v.update(1 / 60, turn, key);
  };
  it("learns the neutral pose first, so a leaning posture does not turn the view", () => {
    const v = new ViewController();
    run(v, 1.2, 0.35);
    expect(v.calibrated).toBe(true);
    expect(v.neutral).toBeCloseTo(0.35, 1);
    expect(Math.abs(v.yawDeg)).toBeLessThan(1);
  });
  it("follows a head turn smoothly (no jump, no overshoot) and comes back", () => {
    const v = new ViewController();
    run(v, 1, 0);
    const first = v.update(1 / 60, 1.2, 0);
    expect(first).toBeLessThan(12); // eased, not a jump
    let prev = first;
    for (let t = 0; t < 2; t += 1 / 60) {
      const y = v.update(1 / 60, 1.2, 0);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeLessThanOrEqual(v.targetDeg + 1e-9);
      prev = y;
    }
    expect(prev).toBeGreaterThan(VIEW.maxYawDeg * 0.8);
    run(v, 3, 0);
    expect(Math.abs(v.yawDeg)).toBeLessThan(1.5);
  });
  it("left turn gives a negative yaw, right turn a positive one", () => {
    const l = new ViewController();
    const r = new ViewController();
    run(l, 1, 0);
    run(r, 1, 0);
    run(l, 1.5, -0.8);
    run(r, 1.5, 0.8);
    expect(l.yawDeg).toBeLessThan(-10);
    expect(r.yawDeg).toBeGreaterThan(10);
  });
  it("arrow keys turn the view (also without any tracking) and C re-centres", () => {
    const v = new ViewController();
    run(v, 1, NaN, -1);
    expect(v.yawDeg).toBeLessThan(-20);
    run(v, 6, NaN, 1);
    expect(v.yawDeg).toBeGreaterThan(20);
    expect(v.yawDeg).toBeLessThanOrEqual(VIEW.maxYawDeg);
    v.center();
    run(v, 3, NaN, 0);
    expect(Math.abs(v.yawDeg)).toBeLessThan(1);
  });
  it("keeps its direction while the player is briefly lost", () => {
    const v = new ViewController();
    run(v, 1, 0);
    run(v, 1.5, 0.9);
    const y = v.yawDeg;
    run(v, 0.2, NaN);
    expect(v.targetDeg).toBeLessThanOrEqual(0.001 + 0); // no head signal: the head part is 0, the view eases back
    expect(Math.abs(v.yawDeg)).toBeLessThanOrEqual(Math.abs(y));
  });
});

describe("look pitch", () => {
  it("looks down more when the target is near, stays within limits", () => {
    const far = lookPitch(2.3, 0, 30);
    const near = lookPitch(2.3, 0, 3);
    expect(near).toBeLessThan(far);
    expect(far).toBeGreaterThanOrEqual(VIEW.pitchMin);
    expect(near).toBeGreaterThanOrEqual(VIEW.pitchMin);
    expect(lookPitch(2.3, 50, 10)).toBeLessThanOrEqual(VIEW.pitchMax);
    expect(lookPitch(2.3, 0, 0)).toBeLessThan(0);
  });
});
