import { describe, expect, it } from "vitest";
import { AFTER, Calm, LEAD_IN, Rope, Stance, ropePeriod, readBody, type LmLike } from "./logic";

const DT = 1 / 30;

function seeded(seed = 7) {
  let s = seed;
  const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return () => (u() + u() + u() + u() - 2) * 1.73; // ~ N(0, 1)
}

/** A standing person: shoulders 60 px wide (scale 60), nose 200, shoulders 260, hips 380, ankles 560. `dy` lifts the whole body (+ = up). */
function pose(dy = 0, noise = 0, rnd: () => number = () => 0): LmLike[] {
  const lm: LmLike[] = Array.from({ length: 33 }, () => ({ x: 300, y: 300, v: 0.95 }));
  const set = (i: number, x: number, y: number) => {
    lm[i].x = x + noise * rnd();
    lm[i].y = y - dy + noise * rnd();
  };
  set(0, 300, 200);
  set(11, 330, 260);
  set(12, 270, 260);
  set(23, 320, 380);
  set(24, 280, 380);
  set(27, 320, 560);
  set(28, 280, 560);
  set(31, 325, 580);
  set(32, 275, 580);
  return lm;
}

function calibrated(noise = 1.5, seed = 3): { st: Stance; rnd: () => number } {
  const st = new Stance();
  const rnd = seeded(seed);
  for (let i = 0; i < 90 && !st.ready; i++) st.update(DT, pose(0, noise, rnd), 60);
  return { st, rnd };
}

describe("calibration", () => {
  it("takes about a second of standing still, then knows the levels", () => {
    const st = new Stance();
    const rnd = seeded();
    let frames = 0;
    while (!st.ready && frames < 200) {
      st.update(DT, pose(0, 1.5, rnd), 60);
      frames++;
    }
    expect(st.ready).toBe(true);
    expect(frames * DT).toBeGreaterThan(0.9);
    expect(frames * DT).toBeLessThan(1.8);
    expect(st.progress).toBe(1);
    expect(st.hipY).toBeCloseTo(380, 0);
    expect(st.shY).toBeCloseTo(260, 0);
    expect(Math.abs(st.headY - 200)).toBeLessThan(2);
    expect(st.x).toBeCloseTo(300, 0);
    expect(st.ref).toBeCloseTo(60, 0);
    // floor: hips + (foot - hips) = the lowest foot point
    expect(Math.abs(st.groundY - 580)).toBeLessThan(4);
  });

  it("waits while the person is still moving about", () => {
    const st = new Stance();
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += DT;
      st.update(DT, pose(40 * Math.sin(t * 6)), 60);
    }
    expect(st.ready).toBe(false);
    for (let i = 0; i < 60; i++) st.update(DT, pose(0), 60);
    expect(st.ready).toBe(true);
  });

  it("works with only the shoulders visible (no legs)", () => {
    const st = new Stance();
    for (let i = 0; i < 80; i++) {
      const lm = pose();
      for (const k of [23, 24, 27, 28, 31, 32]) lm[k].v = 0.05;
      st.update(DT, lm, 60);
    }
    expect(st.ready).toBe(true);
    expect(Number.isNaN(st.hipY)).toBe(true);
    expect(st.shY).toBeCloseTo(260, 0);
    // a fallback floor under the shoulders
    expect(st.groundY).toBeGreaterThan(400);
  });

  it("readBody reports NaN for parts that are not seen", () => {
    const out = new Float64Array(5);
    const lm = pose();
    lm[0].v = 0.1;
    readBody(lm, out);
    expect(out[0]).toBe(380);
    expect(out[1]).toBe(260);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(580);
    expect(out[4]).toBe(300);
  });
});

describe("jump detection", () => {
  const jumpOffset = (t: number, t0: number, h: number, air = 0.5) => (t >= t0 && t < t0 + air ? h * Math.sin((Math.PI * (t - t0)) / air) : 0);

  it("standing still with camera noise never triggers (60 s, with single frame spikes)", () => {
    const { st, rnd } = calibrated(2.5);
    let fired = 0;
    let ducks = 0;
    for (let i = 0; i < 30 * 60; i++) {
      // every 40th frame the whole body jumps 40 px for one frame (a tracking glitch)
      const glitch = i % 40 === 17 ? 40 : 0;
      st.update(DT, pose(glitch, 2.5, rnd), 60);
      if (st.jumpFired) fired++;
      if (st.duckFired) ducks++;
    }
    expect(fired).toBe(0);
    expect(ducks).toBe(0);
    expect(st.air).toBe(false);
  });

  it("breathing, swaying and walking in place do not trigger", () => {
    const { st, rnd } = calibrated();
    let fired = 0;
    let t = 0;
    for (let i = 0; i < 30 * 30; i++) {
      t += DT;
      const dy = 4 * Math.sin(t * 2 * Math.PI * 2) + 2 * Math.sin(t * 2.4); // +-6 px = 0.1 scale
      st.update(DT, pose(dy, 1.5, rnd), 60);
      if (st.jumpFired) fired++;
    }
    expect(fired).toBe(0);
  });

  it("a slow drift upwards (stepping onto a step, camera tilt) is not a jump", () => {
    const { st, rnd } = calibrated();
    let fired = 0;
    for (let i = 0; i < 30 * 8; i++) {
      st.update(DT, pose((40 * i) / (30 * 8), 1.5, rnd), 60);
      if (st.jumpFired) fired++;
    }
    expect(fired).toBe(0);
  });

  it("a real jump is detected quickly, once, and ends on landing", () => {
    const { st, rnd } = calibrated();
    const t0 = 0.5;
    let firedAt = -1;
    let fired = 0;
    let airFrames = 0;
    let landed = -1;
    for (let i = 0; i < 30 * 2; i++) {
      const t = i * DT;
      st.update(DT, pose(jumpOffset(t, t0, 45), 1.5, rnd), 60);
      if (st.jumpFired) {
        fired++;
        firedAt = t;
      }
      if (st.air) airFrames++;
      if (st.landFired && landed < 0) landed = t;
    }
    expect(fired).toBe(1);
    expect(firedAt - t0).toBeLessThan(0.16);
    expect(airFrames * DT).toBeGreaterThan(0.2);
    expect(airFrames * DT).toBeLessThan(0.6);
    expect(landed).toBeGreaterThan(t0 + 0.3);
    expect(st.air).toBe(false);
  });

  it("a small hop (0.35 body scales) counts, a 0.12 bounce does not", () => {
    const hop = calibrated();
    let a = 0;
    for (let i = 0; i < 60; i++) {
      hop.st.update(DT, pose(jumpOffset(i * DT, 0.4, 21), 1, hop.rnd), 60);
      if (hop.st.jumpFired) a++;
    }
    expect(a).toBe(1);
    const small = calibrated();
    let b = 0;
    for (let i = 0; i < 60; i++) {
      small.st.update(DT, pose(jumpOffset(i * DT, 0.4, 7), 1, small.rnd), 60);
      if (small.st.jumpFired) b++;
    }
    expect(b).toBe(0);
  });

  it("works at 15 and 60 frames per second too", () => {
    for (const fps of [15, 60]) {
      const { st, rnd } = (() => {
        const s = new Stance();
        const r = seeded(9);
        for (let i = 0; i < fps * 3 && !s.ready; i++) s.update(1 / fps, pose(0, 1.5, r), 60);
        return { st: s, rnd: r };
      })();
      expect(st.ready).toBe(true);
      let fired = 0;
      for (let i = 0; i < fps * 2; i++) {
        const t = i / fps;
        st.update(1 / fps, pose(jumpOffset(t, 0.5, 45), 1.5, rnd), 60);
        if (st.jumpFired) fired++;
      }
      expect(fired).toBe(1);
    }
  });

  it("two jumps in a row (a rhythm) are two events; the second needs a new push", () => {
    const { st, rnd } = calibrated();
    let fired = 0;
    for (let i = 0; i < 30 * 3; i++) {
      const t = i * DT;
      st.update(DT, pose(jumpOffset(t, 0.4, 40) + jumpOffset(t, 1.3, 40), 1.5, rnd), 60);
      if (st.jumpFired) fired++;
    }
    expect(fired).toBe(2);
  });

  it("the standing level follows a permanent move (player stepped closer)", () => {
    const { st, rnd } = calibrated();
    for (let i = 0; i < 30 * 12; i++) st.update(DT, pose(-20, 1.5, rnd), 60);
    expect(st.hipY).toBeGreaterThan(395);
    expect(st.air).toBe(false);
    expect(st.duck).toBe(false);
  });

  it("the keyboard can jump without any camera", () => {
    const st = new Stance();
    st.skipCalibration();
    st.update(DT, null, 60, true);
    expect(st.air).toBe(true);
    for (let i = 0; i < 30; i++) st.update(DT, null, 60, false);
    expect(st.air).toBe(false);
  });
});

describe("calm smoothing", () => {
  it("is perfectly still while the input only trembles inside the dead zone", () => {
    const c = new Calm();
    const rnd = seeded(5);
    c.update(300, 3, DT);
    const first = c.v;
    for (let i = 0; i < 600; i++) c.update(300 + Math.max(-2.9, Math.min(2.9, rnd() * 1.5)), 3, DT);
    expect(c.v).toBe(first);
  });
  it("follows a real move within about 100 ms", () => {
    const c = new Calm();
    c.update(300, 3, DT);
    let t = 0;
    let v = 0;
    while (t < 0.1) {
      v = c.update(400, 3, DT);
      t += DT;
    }
    expect(v).toBeGreaterThan(300 + 100 * 0.85);
    for (let i = 0; i < 30; i++) v = c.update(400, 3, DT);
    expect(Math.abs(v - 400)).toBeLessThan(3);
  });
});

describe("rope", () => {
  const run = (jumpAt: (t: number) => boolean, secs: number, go = true) => {
    const r = new Rope();
    const out: { t: number; ev: number; perfect: boolean }[] = [];
    for (let t = 0; t < secs; t += DT) {
      const e = r.update(DT, jumpAt(t), go);
      if (e) out.push({ t, ev: e, perfect: r.perfect });
    }
    return out;
  };
  it("speeds up", () => {
    expect(ropePeriod(0)).toBeGreaterThan(ropePeriod(20));
    expect(ropePeriod(20)).toBeGreaterThan(ropePeriod(45));
    expect(ropePeriod(45)).toBeCloseTo(0.85, 5);
    expect(ropePeriod(500)).toBeCloseTo(0.85, 5);
  });
  it("lies still until it is told to go", () => {
    const r = new Rope();
    for (let i = 0; i < 90; i++) expect(r.update(DT, false, false)).toBe(0);
    expect(r.phase).toBe(0.5);
    expect(LEAD_IN).toBeGreaterThan(0.3);
  });
  it("standing still trips every pass (after the grace time)", () => {
    const ev = run(() => false, 12);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev.every((e) => e.ev === 2)).toBe(true);
  });
  it("jumping all the time clears every pass, perfectly", () => {
    const ev = run(() => true, 8);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev.every((e) => e.ev === 1 && e.perfect)).toBe(true);
  });
  it("first pass comes one full turn after the start; a jump timed to it is perfect", () => {
    // the rope starts lying at the feet, one turn (1.5 s) later it is there again
    const ev = run((t) => t > 1.35 && t < 1.85, 2.5);
    expect(ev.length).toBe(1);
    expect(ev[0].ev).toBe(1);
    expect(ev[0].perfect).toBe(true);
  });
  it("a jump that lands just before the rope arrives still counts, one long before does not", () => {
    expect(run((t) => t > 1.0 && t < 1.45, 2.5)[0].ev).toBe(1); // landed 0.05 s before the pass
    expect(run((t) => t > 0.5 && t < 0.9, 2.5)[0].ev).toBe(2);
  });
  it("a late jump within the grace time saves the player but is not perfect", () => {
    const ev = run((t) => t > 1.58 && t < 1.9, 2.5);
    expect(ev[0].ev).toBe(1);
    expect(ev[0].perfect).toBe(false);
    // later than the grace time: tripped
    const ev2 = run((t) => t > 1.5 + AFTER + 0.12 && t < 2.3, 2.5);
    expect(ev2[0].ev).toBe(2);
  });
  it("the rope waits at the feet while the verdict is open and rests after a trip", () => {
    const r = new Rope();
    let waited = 0;
    let tripped = false;
    for (let t = 0; t < 3; t += DT) {
      const e = r.update(DT, false, true);
      if (r.waiting) {
        waited++;
        expect(r.phase).toBe(0.5);
      }
      if (e === 2) {
        tripped = true;
        expect(r.stall).toBeGreaterThan(0);
      }
    }
    expect(waited).toBeGreaterThan(3);
    expect(tripped).toBe(true);
  });
  it("emits one cue per turn", () => {
    const r = new Rope();
    let cues = 0;
    for (let t = 0; t < 6; t += DT) {
      r.update(DT, true, true);
      if (r.cue) cues++;
    }
    expect(cues).toBeGreaterThanOrEqual(3);
    expect(cues).toBeLessThanOrEqual(5);
  });
});
