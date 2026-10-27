import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { CFG, FIT, mkPeople, type Spec } from "../testing/helpers";
import type { Pt } from "../types";
import { CrankTracker, StableBool, StableLabel, SwipeDetector, emptySwipe, handInfo } from "./gestures";
import { Tracker } from "./tracker";

describe("StableBool (stability + hysteresis)", () => {
  it("needs 3 consecutive frames to turn on and 3 to turn off", () => {
    const s = new StableBool(0.25, 0.1, 3);
    expect([s.update(0.5), s.update(0.5)]).toEqual([false, false]);
    expect(s.update(0.5)).toBe(true);
    expect([s.update(0), s.update(0)]).toEqual([true, true]);
    expect(s.update(0)).toBe(false);
  });

  it("a single noisy frame does not flip the state", () => {
    const s = new StableBool(0.25, 0.1, 3);
    for (let i = 0; i < 5; i++) s.update(0.5);
    expect(s.state).toBe(true);
    s.update(0);
    s.update(0.5);
    s.update(0);
    s.update(0.5);
    expect(s.state).toBe(true);
  });

  it("hysteresis: values between exit and enter keep the current state", () => {
    const s = new StableBool(0.25, 0.1, 3);
    for (let i = 0; i < 6; i++) s.update(0.18); // between thresholds while off -> stays off
    expect(s.state).toBe(false);
    for (let i = 0; i < 4; i++) s.update(0.5);
    expect(s.state).toBe(true);
    for (let i = 0; i < 10; i++) s.update(0.18); // between thresholds while on -> stays on
    expect(s.state).toBe(true);
    for (let i = 0; i < 3; i++) s.update(0.05);
    expect(s.state).toBe(false);
  });

  it("NaN (landmark not visible) counts as off", () => {
    const s = new StableBool(0.25, 0.1, 3);
    for (let i = 0; i < 4; i++) s.update(0.5);
    for (let i = 0; i < 3; i++) s.update(NaN);
    expect(s.state).toBe(false);
  });
});

describe("StableLabel", () => {
  it("changes only after 3 identical frames", () => {
    const l = new StableLabel<string>("other");
    expect([l.update("fist"), l.update("fist")]).toEqual(["other", "other"]);
    expect(l.update("fist")).toBe("fist");
    expect(l.update("open")).toBe("fist");
    expect(l.update("fist")).toBe("fist");
    l.update("open");
    l.update("open");
    expect(l.update("open")).toBe("open");
  });
});

describe("SwipeDetector", () => {
  it("fires once above the speed threshold and respects the cooldown", () => {
    const sw = new SwipeDetector(DEFAULT_CONFIG.gestures);
    const e = emptySwipe();
    expect(sw.update(100, 0, 720, 1000, e).fired).toBe(false); // slow
    expect(sw.update(1200, 0, 720, 1100, e).fired).toBe(true);
    expect(e.dir).toBe("right");
    expect(sw.update(1200, 0, 720, 1200, e).fired).toBe(false); // cooldown
    expect(sw.update(0, -1500, 720, 1500, e).fired).toBe(true);
    expect(e.dir).toBe("up");
  });
});

describe("CrankTracker", () => {
  const turn = (hz: number, seconds = 3) => {
    const c = new CrankTracker(DEFAULT_CONFIG.gestures);
    let rate = 0;
    const dt = 1 / 30;
    for (let t = 0; t < seconds; t += dt) {
      const a = t * hz * Math.PI * 2;
      rate = c.update(500 + Math.cos(a) * 80, 300 + Math.sin(a) * 80, true, 150, dt);
    }
    return rate;
  };
  it("measures circles per second of a hand drawing circles", () => {
    expect(turn(1.5)).toBeGreaterThan(0.9);
    expect(turn(1.5)).toBeLessThan(2.1);
  });
  it("a still hand gives ~0", () => {
    const c = new CrankTracker(DEFAULT_CONFIG.gestures);
    let r = 1;
    for (let i = 0; i < 90; i++) r = c.update(500, 300, true, 150, 1 / 30);
    expect(r).toBeLessThan(0.05);
  });
});

describe("GestureEngine through the Tracker", () => {
  const run = (specs: Spec[], frames: number, t: Tracker, t0 = 0) => {
    for (let i = 0; i < frames; i++) {
      const people = mkPeople(specs);
      t.process({ pose: { landmarks: people.map((p) => p.norm) }, hand: null }, t0 + i * 33);
    }
  };
  it("hands above head become true only after the stability window", () => {
    const t = new Tracker(CFG, 1);
    t.setFit(FIT);
    t.lock.lockNearest(0);
    run([{ armL: "down", armR: "down" }], 5, t);
    expect(t.players[0].gestures.handsAboveHead).toBe(false);
    run([{ armL: "up", armR: "up" }], 2, t, 200);
    expect(t.players[0].gestures.handsAboveHead).toBe(false);
    run([{ armL: "up", armR: "up" }], 3, t, 300);
    expect(t.players[0].gestures.handsAboveHead).toBe(true);
    expect(t.players[0].gestures.handUp.L && t.players[0].gestures.handUp.R).toBe(true);
    run([{ armL: "down", armR: "down" }], 6, t, 600);
    expect(t.players[0].gestures.handsAboveHead).toBe(false);
  });

  it("raising one hand to shoulder height is not 'hands above head'", () => {
    const t = new Tracker(CFG, 1);
    t.setFit(FIT);
    t.lock.lockNearest(0);
    run([{ armL: "shoulder", armR: "down" }], 8, t);
    expect(t.players[0].gestures.handsAboveHead).toBe(false);
  });
});

describe("handInfo", () => {
  const hand = (fingers: boolean[]): Pt[] => {
    // wrist at origin, finger joints (6, 10, 14, 18) and tips (8, 12, 16, 20) extended or curled
    const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    pts[9] = { x: 0, y: -60 };
    const base = [6, 10, 14, 18];
    const tip = [8, 12, 16, 20];
    fingers.forEach((ext, i) => {
      pts[base[i]] = { x: (i - 1.5) * 20, y: -60 };
      pts[tip[i]] = { x: (i - 1.5) * 20, y: ext ? -130 : -30 };
    });
    return pts;
  };
  it("classifies fist / open / point / peace", () => {
    expect(handInfo(hand([false, false, false, false])).shape).toBe("fist");
    expect(handInfo(hand([true, true, true, true])).shape).toBe("open");
    expect(handInfo(hand([true, false, false, false])).shape).toMatch(/point|gun/);
    expect(handInfo(hand([true, true, false, false])).shape).toBe("peace");
  });
});
