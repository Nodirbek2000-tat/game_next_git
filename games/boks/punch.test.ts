import { describe, expect, it } from "vitest";
import { PunchDetector, punchKmh, type HandSample } from "./punch";

const FRAME = 1000 / 30;

/** one hand: feeds samples at 30 fps and records what the detector said */
function rig() {
  const det = new PunchDetector();
  let t = 1000;
  const log = { fired: 0, ended: 0, peak: 0, kmh: 0, cue: "" };
  const feed = (o: Partial<HandSample>, sens = 1): void => {
    t += FRAME;
    const s = det.update({ t, valid: true, speed: 0.3, ex: 0.6, ey: 0, fore: 0, size: 0, dz: NaN, ...o }, sens);
    if (s.fired) {
      log.fired++;
      log.cue = s.cue;
    }
    if (s.ended) {
      log.ended++;
      log.peak = s.peak;
      log.kmh = s.kmh;
    }
  };
  return { det, feed, log, now: () => t };
}

describe("punch detector", () => {
  it("a fast thrust away from the shoulder is a punch (and is measured)", () => {
    const { feed, log, det } = rig();
    for (let i = 0; i < 6; i++) feed({});
    // 1.3 shoulder widths in 5 frames = ~8 sw/s
    for (let i = 1; i <= 5; i++) feed({ ex: 0.6 + 0.26 * i, speed: 7 + i });
    expect(log.fired).toBe(1);
    expect(log.cue).toBe("lateral");
    expect(det.st.live).toBe(true);
    // the hand stops at the pad: the punch ends once
    for (let i = 0; i < 4; i++) feed({ ex: 1.9, speed: 0.4 });
    expect(log.ended).toBe(1);
    expect(log.peak).toBeGreaterThan(10);
    // 12 sw/s * 0.42 m * 3.6 * 1.25 = ~23 km/h
    expect(log.kmh).toBeGreaterThan(20);
    expect(log.kmh).toBeLessThan(60);
  });

  it("a slow reach to the same place does not count", () => {
    const { feed, log } = rig();
    for (let i = 0; i < 6; i++) feed({});
    for (let i = 1; i <= 40; i++) feed({ ex: 0.6 + (1.3 * i) / 40, speed: 1.2 });
    expect(log.fired).toBe(0);
  });

  it("tracking jitter does not count", () => {
    const { feed, log } = rig();
    for (let i = 0; i < 90; i++) {
      // +-0.05 shoulder widths of noise and speed estimates that wobble up to 3
      feed({ ex: 0.6 + (i % 2 ? 0.05 : -0.05), ey: i % 3 ? 0.03 : -0.03, speed: 1 + (i % 4) * 0.6 });
    }
    expect(log.fired).toBe(0);
  });

  it("a one-frame spike (the point jumps and comes back) does not count", () => {
    const { feed, log } = rig();
    for (let i = 0; i < 8; i++) feed({});
    feed({ ex: 1.8, speed: 25 });
    feed({ ex: 0.6, speed: 25 });
    for (let i = 0; i < 8; i++) feed({});
    expect(log.fired).toBe(0);
  });

  it("a jump to a new place that stays there (a glitch) does not count", () => {
    const { feed, log } = rig();
    for (let i = 0; i < 8; i++) feed({});
    feed({ ex: 1.8, speed: 25 });
    for (let i = 0; i < 8; i++) feed({ ex: 1.8, speed: 0.2 });
    expect(log.fired).toBe(0);
  });

  it("an impossible speed resets the detector", () => {
    const { feed, log, det } = rig();
    for (let i = 0; i < 6; i++) feed({});
    feed({ ex: 1.0, speed: 8 });
    feed({ ex: 1.3, speed: 200 });
    feed({ ex: 1.6, speed: 9 });
    expect(log.fired).toBe(0);
    expect(det.st.live).toBe(false);
  });

  it("waving a straight arm sideways (distance to the shoulder constant) is not a punch", () => {
    const { feed, log } = rig();
    for (let i = 0; i < 6; i++) feed({ ex: 1.4, ey: 0 });
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      feed({ ex: 1.4 * Math.cos(a), ey: -1.4 * Math.sin(a), speed: 7 });
    }
    expect(log.fired).toBe(0);
  });

  it("raising the guard (the arm retracts) or dropping the hands is not a punch", () => {
    const up = rig();
    for (let i = 0; i < 6; i++) up.feed({ ex: -0.1, ey: 1.3, fore: 0.5 });
    // from the hip to the chin in 6 frames: fast, and the forearm shortens in the picture
    for (let i = 1; i <= 6; i++) up.feed({ ex: -0.1, ey: 1.3 - (1.75 * i) / 6, fore: 0.5 - 0.03 * i, speed: 8 });
    expect(up.log.fired).toBe(0);
    const down = rig();
    for (let i = 0; i < 6; i++) down.feed({ ex: -0.1, ey: -0.45, fore: 0.35 });
    for (let i = 1; i <= 6; i++) down.feed({ ex: -0.1, ey: -0.45 + (1.75 * i) / 6, fore: 0.35 + 0.03 * i, speed: 8 });
    expect(down.log.fired).toBe(0);
  });

  it("a punch straight at the camera counts through the forearm foreshortening", () => {
    const { feed, log } = rig();
    for (let i = 0; i < 6; i++) feed({ fore: 1.0 });
    // the picture hardly moves: ~2.5 sw/s, but the forearm shrinks from 1.0 to 0.5
    for (let i = 1; i <= 5; i++) feed({ ex: 0.6 + 0.07 * i, fore: 1.0 - 0.1 * i, speed: 2.5 });
    expect(log.fired).toBe(1);
    expect(log.cue).toBe("forward");
  });

  it("the world landmarks (wrist coming forward) count too, a drifting z does not", () => {
    const a = rig();
    for (let i = 0; i < 6; i++) a.feed({ dz: -0.05 });
    for (let i = 1; i <= 5; i++) a.feed({ ex: 0.6 + 0.07 * i, dz: -0.05 - 0.07 * i, speed: 2.4 });
    expect(a.log.fired).toBe(1);
    const b = rig();
    for (let i = 0; i < 6; i++) b.feed({ dz: -0.05 });
    // a slow z drift at low speed
    for (let i = 1; i <= 30; i++) b.feed({ ex: 0.6 + 0.01 * i, dz: -0.05 - 0.01 * i, speed: 0.8 });
    expect(b.log.fired).toBe(0);
  });

  it("the same hand cannot punch again at once, but can after the cooldown", () => {
    const { feed, log } = rig();
    const thrust = (x0: number): void => {
      for (let i = 1; i <= 4; i++) feed({ ex: x0 + 0.3 * i, speed: 9 });
      for (let i = 0; i < 3; i++) feed({ ex: x0 + 1.2, speed: 0.3 });
    };
    for (let i = 0; i < 6; i++) feed({});
    thrust(0.6);
    expect(log.fired).toBe(1);
    // back to the guard (slowly), then a second punch
    for (let i = 0; i < 12; i++) feed({ ex: 1.8 - (1.2 * (i + 1)) / 12, speed: 1.5 });
    for (let i = 0; i < 4; i++) feed({});
    thrust(0.6);
    expect(log.fired).toBe(2);
    expect(log.ended).toBe(2);
  });

  it("a lost hand drops the punch without scoring it", () => {
    const { feed, log, det } = rig();
    for (let i = 0; i < 6; i++) feed({});
    for (let i = 1; i <= 3; i++) feed({ ex: 0.6 + 0.3 * i, speed: 9 });
    expect(det.st.live).toBe(true);
    feed({ valid: false });
    expect(det.st.live).toBe(false);
    expect(log.ended).toBe(0);
  });

  it("higher sensitivity lets a softer punch through", () => {
    const soft = (sens: number): number => {
      const { feed, log } = rig();
      for (let i = 0; i < 6; i++) feed({});
      for (let i = 1; i <= 6; i++) feed({ ex: 0.6 + 0.16 * i, speed: 3.9 }, sens);
      return log.fired;
    };
    expect(soft(1)).toBe(0);
    expect(soft(1.4)).toBe(1);
  });

  it("km/h is bounded", () => {
    expect(punchKmh(0)).toBe(0);
    expect(punchKmh(1000)).toBeLessThanOrEqual(95);
  });
});
