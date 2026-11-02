import { describe, expect, it } from "vitest";
import { type AnimAttack, type AnimInput, PartnerAnim, type PadTarget, ik2, strikePath } from "./anim";
import { RECOVER_SEC, STRIKE_SEC } from "./config";
import { type View, gloveToPx, newView, pxToWorld, worldToPx } from "./space";

describe("two-bone IK", () => {
  const out = new Float64Array(6);
  it("keeps the bone lengths and reaches a target in range", () => {
    ik2(0, 1.5, 0, 0.3, 1.4, 0.5, 0.32, 0.3, 0.3, -1, 0, out);
    const sh = [0, 1.5, 0];
    const el = [out[0], out[1], out[2]];
    const en = [out[3], out[4], out[5]];
    expect(Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2])).toBeCloseTo(0.32, 5);
    expect(Math.hypot(en[0] - el[0], en[1] - el[1], en[2] - el[2])).toBeCloseTo(0.3, 5);
    expect(en[0]).toBeCloseTo(0.3, 5);
    expect(en[2]).toBeCloseTo(0.5, 5);
  });

  it("stops at full stretch when the target is too far", () => {
    ik2(0, 1.5, 0, 0, 1.5, 3, 0.32, 0.3, 0, -1, 0, out);
    expect(Math.hypot(out[3], out[4] - 1.5, out[5])).toBeLessThanOrEqual(0.62);
    expect(out[5]).toBeGreaterThan(0.5);
  });

  it("bends towards the pole", () => {
    ik2(0, 1.5, 0, 0, 1.5, 0.45, 0.32, 0.3, 0, -1, 0, out);
    expect(out[1]).toBeLessThan(1.5);
    ik2(0, 1.5, 0, 0, 1.5, 0.45, 0.32, 0.3, 0, 1, 0, out);
    expect(out[1]).toBeGreaterThan(1.5);
  });
});

describe("strike path", () => {
  const p = new Float64Array(3);
  it("starts at the shoulder side and ends at the face (straight and hook)", () => {
    strikePath("straight", -1, 0, 0, 1.6, 1.5, p);
    expect(p[0]).toBeCloseTo(-0.2);
    strikePath("straight", -1, 1, 0, 1.6, 1.5, p);
    expect([p[0], p[1], p[2]]).toEqual([0, 1.6, 1.5]);
    strikePath("hook", 1, 0, 0, 1.6, 1.5, p);
    expect(p[0]).toBeCloseTo(0.6);
    strikePath("hook", 1, 1, 0, 1.6, 1.5, p);
    expect(p[0]).toBeCloseTo(0.12);
    expect(p[2]).toBeCloseTo(1.58);
  });

  it("a hook swings wider than a straight punch on the way", () => {
    const a = new Float64Array(3);
    strikePath("hook", 1, 0.5, 0, 1.6, 1.5, p);
    strikePath("straight", 1, 0.5, 0, 1.6, 1.5, a);
    expect(Math.abs(p[0])).toBeGreaterThan(Math.abs(a[0]) + 0.2);
  });
});

const pad = (on = false, x = 0, y = 1.4, z = 0.5): PadTarget => ({ on, x, y, z, recoil: 0 });
const noAtk = (): AnimAttack => ({ active: false, kind: "straight", from: 1, t: 0, windup: 0.7 });
const input = (o: Partial<AnimInput> = {}): AnimInput => ({ pad: [pad(), pad()], attack: noAtk(), faceX: 0, faceY: 1.55, faceZ: 2.0, down: false, ...o });

describe("partner animation", () => {
  it("idles: bounces and sways, glove up in the guard", () => {
    const a = new PartnerAnim();
    let minBob = 0;
    let maxX = -1;
    let minX = 1;
    for (let t = 0; t < 6; t += 1 / 60) {
      a.update(1 / 60, t, input());
      minBob = Math.min(minBob, a.bob);
      maxX = Math.max(maxX, a.swayX);
      minX = Math.min(minX, a.swayX);
    }
    expect(minBob).toBeLessThan(-0.03);
    expect(maxX - minX).toBeGreaterThan(0.05);
    expect(a.phase).toBe("idle");
    expect(a.hand[0][1]).toBeGreaterThan(1.4);
    expect(a.hand[0][0]).toBeLessThan(0);
    expect(a.hand[1][0]).toBeGreaterThan(0);
  });

  it("holds the pads where they are", () => {
    const a = new PartnerAnim();
    const inp = input({ pad: [pad(true, -0.4, 1.3, 0.55), pad()] });
    for (let t = 0; t < 1; t += 1 / 60) a.update(1 / 60, t, inp);
    expect(a.phase).toBe("pads");
    expect(a.hand[0][0]).toBeCloseTo(-0.4, 1);
    expect(a.hand[0][1]).toBeCloseTo(1.3, 1);
    expect(a.hand[0][2]).toBeCloseTo(0.55 - 0.13, 1);
  });

  it("a pad hit pushes the glove back", () => {
    const a = new PartnerAnim();
    const p1 = pad(true, 0.4, 1.3, 0.55);
    const inp = input({ pad: [pad(), p1] });
    for (let t = 0; t < 1; t += 1 / 60) a.update(1 / 60, t, inp);
    const z0 = a.hand[1][2];
    p1.recoil = 1;
    a.hit(1);
    for (let t = 1; t < 1.2; t += 1 / 60) a.update(1 / 60, t, inp);
    expect(a.hand[1][2]).toBeLessThan(z0 - 0.08);
  });

  it("wind-up pulls the glove back and glows, the strike reaches the face, the recovery returns to the guard", () => {
    const a = new PartnerAnim();
    const atk: AnimAttack = { active: true, kind: "straight", from: -1, t: 0, windup: 0.7 };
    const inp = input({ attack: atk });
    let t = 0;
    const guardZ = 0.38;
    // wind-up
    let minZ = 9;
    let lastGlow = 0;
    for (; atk.t < 0.699; atk.t += 1 / 60, t += 1 / 60) {
      a.update(1 / 60, t, inp);
      minZ = Math.min(minZ, a.hand[0][2]);
      expect(a.glow).toBeGreaterThanOrEqual(lastGlow - 1e-9);
      lastGlow = a.glow;
    }
    expect(a.phase).toBe("windup");
    expect(minZ).toBeLessThan(guardZ - 0.3);
    expect(a.glow).toBeGreaterThan(0.9);
    // strike
    let peakZ = -9;
    for (; atk.t < 0.7 + STRIKE_SEC; atk.t += 1 / 60, t += 1 / 60) {
      a.update(1 / 60, t, inp);
      peakZ = Math.max(peakZ, a.hand[0][2] + a.lunge);
    }
    expect(a.phase === "strike" || a.phase === "recover").toBe(true);
    // the glove ends close to the player's face (2.0 m away; the root lunges forward, so root-local z + lunge is the world distance)
    expect(peakZ).toBeGreaterThan(1.45);
    expect(a.lunge).toBeGreaterThan(0.3);
    // recover
    for (; atk.t < 0.7 + STRIKE_SEC + RECOVER_SEC + 0.5; atk.t += 1 / 60, t += 1 / 60) a.update(1 / 60, t, inp);
    atk.active = false;
    for (let i = 0; i < 60; i++, t += 1 / 60) a.update(1 / 60, t, inp);
    expect(a.hand[0][2]).toBeLessThan(0.6);
    expect(a.lunge).toBeLessThan(0.05);
    expect(a.glow).toBe(0);
  });

  it("the attacking hand is the one on the side the glove comes from", () => {
    const a = new PartnerAnim();
    const atk: AnimAttack = { active: true, kind: "hook", from: 1, t: 0, windup: 0.7 };
    const inp = input({ attack: atk });
    for (let t = 0; atk.t < 0.7 + STRIKE_SEC * 0.5; atk.t += 1 / 60, t += 1 / 60) a.update(1 / 60, t, inp);
    expect(a.glowHand).toBe(1);
    expect(a.hand[1][2]).toBeGreaterThan(0.8);
    expect(a.hand[0][2]).toBeLessThan(0.6);
  });

  it("knockdown: falls backwards and lies, then gets up", () => {
    const a = new PartnerAnim();
    let prev = 0;
    let t = 0;
    for (; t < 1.2; t += 1 / 60) {
      a.update(1 / 60, t, input({ down: true }));
      expect(a.fall).toBeLessThanOrEqual(prev + 1e-9);
      prev = a.fall;
    }
    expect(a.fall).toBeLessThan(-1.4);
    expect(a.phase).toBe("down");
    for (; t < 3.2; t += 1 / 60) a.update(1 / 60, t, input({ down: false }));
    expect(a.fall).toBeGreaterThan(-0.05);
    expect(a.phase).not.toBe("down");
  });
});

describe("screen <-> world", () => {
  const v: View = { ...newView(), w: 960, h: 540 };
  it("round trips", () => {
    const w = { x: 0, y: 0, z: 0 };
    const px = { x: 0, y: 0, s: 0 };
    pxToWorld(v, 700, 200, 1.6, w);
    worldToPx(v, w.x, w.y, w.z, px);
    expect(px.x).toBeCloseTo(700, 4);
    expect(px.y).toBeCloseTo(200, 4);
  });

  it("the glove of the left hand stays on the left, a lifted hand goes up", () => {
    const o = { x: 0, y: 0 };
    gloveToPx(v, -1.2, 0, o);
    expect(o.x).toBeLessThan(480);
    const y0 = gloveToPx(v, 0.5, 0, { x: 0, y: 0 }).y;
    const y1 = gloveToPx(v, 0.5, -0.8, { x: 0, y: 0 }).y;
    expect(y1).toBeLessThan(y0);
  });
});
