import { describe, expect, it } from "vitest";
import { CFG, mkPeople, type Spec } from "../testing/helpers";
import type { LegState } from "../types";
import { LegCalibrator, LegPedals } from "./legCalibration";

const DT = 1 / 30;
type Frame = ReturnType<typeof mkPeople>[number];
type Tweak = (p: Frame, i: number) => void;

/** run `secs` of frames of one synthetic body through the pedals; `tweak` may disturb the landmarks per frame */
function run(pd: LegPedals, spec: Spec, secs: number, tweak?: Tweak): LegPedals {
  const frames = Math.round(secs / DT);
  for (let i = 0; i < frames; i++) {
    const p = mkPeople([spec])[0];
    tweak?.(p, i);
    pd.update(p.lm, p.scale, DT);
  }
  return pd;
}

/** a tiny deterministic noise source (LCG) in -1..1 */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
};

const calibrated = (spec: Spec = {}): LegPedals => {
  const pd = new LegPedals();
  run(pd, spec, 1.3);
  return pd;
};

describe("LegPedals", () => {
  it("calibrates in about a second with both legs down; pedals are 0 until then and afterwards", () => {
    const pd = new LegPedals();
    run(pd, {}, 0.5);
    expect(pd.ready).toBe(false);
    expect(pd.calib).toBeGreaterThan(0.3);
    expect(pd.calib).toBeLessThan(1);
    expect(pd.gas).toBe(0);
    run(pd, {}, 0.8);
    expect(pd.ready).toBe(true);
    expect(pd.ok).toBe(true);
    run(pd, {}, 2);
    expect(pd.gas).toBe(0);
    expect(pd.brake).toBe(0);
  });

  it("right knee = proportional gas (brake stays 0), left knee = brake (gas stays 0)", () => {
    const pd = calibrated();
    run(pd, { kneeR: 0.4 }, 0.3);
    const low = pd.gas;
    run(pd, { kneeR: 1 }, 0.3);
    expect(low).toBeGreaterThan(0.1);
    expect(pd.gas).toBeGreaterThan(low);
    expect(pd.gas).toBeGreaterThan(0.9);
    expect(pd.brake).toBe(0);
    run(pd, {}, 0.5);
    expect(pd.gas).toBe(0);
    run(pd, { kneeL: 1 }, 0.3);
    expect(pd.brake).toBeGreaterThan(0.9);
    expect(pd.gas).toBe(0);
  });

  it("wrong leg raised does NOT gas, even when the stance is asymmetric (the old shared-rest bug)", () => {
    // the right leg reads 14 % shorter than the left one while standing (leg forward / hips tilted / body turned)
    const shorten: Tweak = (p) => {
      const rel = p.lm[26].y - p.lm[24].y;
      p.lm[26].y -= rel * 0.14;
      p.lm[28].y -= rel * 0.14;
    };
    const pd = new LegPedals();
    run(pd, {}, 1.3, shorten);
    expect(pd.ready).toBe(true);
    let maxGas = 0;
    for (const spec of [{}, { kneeL: 1 }, { kneeL: 1 }, {}, { kneeL: 0.6 }, {}] as Spec[]) {
      for (let i = 0; i < 45; i++) {
        const p = mkPeople([spec])[0];
        shorten(p, i);
        pd.update(p.lm, p.scale, DT);
        maxGas = Math.max(maxGas, pd.gas);
      }
    }
    expect(maxGas).toBe(0);
    // and the real gas still works afterwards
    run(pd, { kneeR: 1 }, 0.4, shorten);
    expect(pd.gas).toBeGreaterThan(0.8);
  });

  it("an asymmetric stance alone never gives a pedal, however long the player stands", () => {
    const shorten: Tweak = (p) => {
      const rel = p.lm[26].y - p.lm[24].y;
      p.lm[26].y -= rel * 0.2;
      p.lm[28].y -= rel * 0.2;
    };
    const pd = new LegPedals();
    run(pd, {}, 1.5, shorten);
    let max = 0;
    for (let i = 0; i < 300; i++) {
      const p = mkPeople([{}])[0];
      shorten(p, i);
      pd.update(p.lm, p.scale, DT);
      max = Math.max(max, pd.gas, pd.brake);
    }
    expect(max).toBe(0);
  });

  it("raised-leg start: the standing leg gives the rest; the raised knee reads gas, the standing one never brakes", () => {
    const pd = new LegPedals();
    run(pd, { kneeR: 1 }, 0.4);
    expect(pd.gas).toBe(0); // (not decided yet: the first half second only collects evidence)
    run(pd, { kneeR: 1 }, 0.5);
    expect(pd.ready).toBe(true);
    expect(pd.gas).toBeGreaterThan(0.8);
    expect(pd.brake).toBe(0);
    // leg down: gas 0, and it keeps working (the rest of that leg is learnt on the way)
    run(pd, {}, 1.5);
    expect(pd.gas).toBe(0);
    expect(pd.brake).toBe(0);
    run(pd, { kneeR: 1 }, 0.4);
    expect(pd.gas).toBeGreaterThan(0.8);
    run(pd, {}, 0.5);
    run(pd, { kneeL: 1 }, 0.4);
    expect(pd.brake).toBeGreaterThan(0.8);
    expect(pd.gas).toBe(0);
  });

  it("raised LEFT leg at the start: brake, never gas", () => {
    const pd = new LegPedals();
    run(pd, { kneeL: 1 }, 1.2);
    expect(pd.brake).toBeGreaterThan(0.8);
    expect(pd.gas).toBe(0);
  });

  it("noise (dim light) gives no pedal; the dead zone grows with the noise and a real lift still works", () => {
    const n = rng(7);
    const jitter =
      (amp: number): Tweak =>
      (p) => {
        for (const i of [25, 26, 27, 28]) p.lm[i].y += n() * amp * p.scale;
      };
    const pd = new LegPedals();
    run(pd, {}, 1.5, jitter(0.05));
    expect(pd.ready).toBe(true);
    let max = 0;
    for (let i = 0; i < 600; i++) {
      const p = mkPeople([{}])[0];
      jitter(0.05)(p, i);
      pd.update(p.lm, p.scale, DT);
      max = Math.max(max, pd.gas, pd.brake);
    }
    expect(max).toBe(0);
    expect(pd.gasThr).toBeGreaterThanOrEqual(0.14);
    run(pd, { kneeR: 1 }, 0.6, jitter(0.05));
    expect(pd.gas).toBeGreaterThan(0.6);
  });

  it("occlusion: invisible or low-confidence knees give 0 and never an automatic gas when they come back", () => {
    const pd = calibrated({ kneeR: 0 });
    run(pd, { kneeR: 1 }, 0.4);
    expect(pd.gas).toBeGreaterThan(0.8);
    // the right knee disappears while lifted: pedal is 0 at once
    run(pd, { kneeR: 1 }, 0.2, (p) => {
      p.lm[26].v = 0.1;
    });
    expect(pd.gas).toBe(0);
    expect(pd.okR).toBe(false);
    expect(pd.okL).toBe(true);
    // low confidence hip: 0 as well
    run(pd, { kneeR: 1 }, 0.2, (p) => {
      p.lm[24].v = 0.2;
    });
    expect(pd.gas).toBe(0);
    // back and standing: still 0
    run(pd, {}, 2);
    expect(pd.gas).toBe(0);
    expect(pd.brake).toBe(0);
    // legs not visible at all, from the start: never ready, never a pedal
    const lost = new LegPedals();
    run(lost, { legsVisible: false }, 6);
    expect(lost.ready).toBe(false);
    expect(lost.ok).toBe(false);
    expect(lost.gas).toBe(0);
    expect(lost.brake).toBe(0);
  });

  it("a flicker of visibility around the threshold does not chatter the pedal on and off", () => {
    const pd = calibrated();
    const n = rng(3);
    let drops = 0;
    let was = false;
    for (let i = 0; i < 120; i++) {
      const p = mkPeople([{ kneeR: 1 }])[0];
      p.lm[26].v = 0.42 + n() * 0.04; // between "lost" (0.35) and "seen" (0.5)
      pd.update(p.lm, p.scale, DT);
      if (was && pd.gas === 0) drops++;
      was = pd.gas > 0;
    }
    // it either never came on (not confident enough to start) or stayed on
    expect(drops).toBe(0);
  });

  it("swapped left / right labels (a knee coming up in front of the other leg) are resolved by position", () => {
    const pd = calibrated();
    const swap: Tweak = (p) => {
      for (const [a, b] of [[25, 26], [27, 28], [23, 24]]) {
        const t = { ...p.lm[a] };
        Object.assign(p.lm[a], p.lm[b]);
        Object.assign(p.lm[b], t);
      }
    };
    // the player lifts the RIGHT knee, but the model labels it as the left one
    run(pd, { kneeR: 1 }, 0.5, swap);
    expect(pd.gas).toBeGreaterThan(0.8);
    expect(pd.brake).toBe(0);
    run(pd, {}, 0.5, swap);
    run(pd, { kneeL: 1 }, 0.5, swap);
    expect(pd.brake).toBeGreaterThan(0.8);
    expect(pd.gas).toBe(0);
  });

  it("both knees dropping by the same small amount (twist / crouch / scale jump) is not a pedal and is absorbed", () => {
    const pd = calibrated();
    let max = 0;
    for (let i = 0; i < 150; i++) {
      const p = mkPeople([{}])[0];
      for (const k of [25, 26, 27, 28]) p.lm[k].y -= 0.2 * (p.lm[25].y - p.lm[23].y);
      pd.update(p.lm, p.scale, DT);
      max = Math.max(max, pd.gas, pd.brake);
    }
    expect(max).toBe(0);
    // after it settled, a real lift is still measured from the (re-based) rest
    const lowered: Tweak = (p) => {
      for (const k of [25, 26, 27, 28]) p.lm[k].y -= 0.2 * (p.lm[25].y - p.lm[23].y);
    };
    run(pd, { kneeR: 1 }, 0.5, lowered);
    expect(pd.gas).toBeGreaterThan(0.5);
  });

  it("the weaker leg is ignored when the other one is lifted high", () => {
    const pd = calibrated();
    // left knee fully up, right knee 'jiggles' up a little (weight shift): brake only
    run(pd, { kneeL: 1, kneeR: 0.35 }, 0.5);
    expect(pd.brake).toBeGreaterThan(0.8);
    expect(pd.gas).toBe(0);
  });

  it("standing: a knee that moves alone (ankle stays down) is not a lifted leg", () => {
    const pd = calibrated();
    run(pd, { kneeR: 1 }, 0.5, (p) => {
      // the ankle of the right leg stays where it was
      const q = mkPeople([{}])[0];
      p.lm[28].y = q.lm[28].y;
    });
    expect(pd.gas).toBe(0);
    // an ankle that is not seen clearly (< 0.65) cannot veto
    const weak: Tweak = (p) => {
      const q = mkPeople([{}])[0];
      p.lm[28].y = q.lm[28].y;
      p.lm[28].v = 0.55;
    };
    const pd2 = new LegPedals();
    run(pd2, {}, 1.3, weak);
    run(pd2, { kneeR: 1 }, 0.5, weak);
    expect(pd2.gas).toBeGreaterThan(0.8);
  });

  it("seated mode: knee relative to the hip, no standing clamp; wrong leg does not gas", () => {
    const seat = (kr: number, kl: number): Tweak => (p) => {
      const hy = p.lm[23].y;
      p.lm[23].y = p.lm[24].y = hy;
      // knees about level with the hips (seated), lift in body scales
      p.lm[25].y = hy + 0.05 * p.scale - kl * 0.3 * p.scale;
      p.lm[26].y = hy + 0.05 * p.scale - kr * 0.3 * p.scale;
      p.lm[27].v = p.lm[28].v = 0.1;
    };
    const pd = new LegPedals({ seated: true });
    run(pd, {}, 1.3, seat(0, 0));
    expect(pd.ready).toBe(true);
    expect(pd.gas).toBe(0);
    run(pd, {}, 0.4, seat(1, 0));
    expect(pd.gas).toBeGreaterThan(0.8);
    expect(pd.brake).toBe(0);
    run(pd, {}, 0.6, seat(0, 0));
    expect(pd.gas).toBe(0);
    run(pd, {}, 0.4, seat(0, 1));
    expect(pd.brake).toBeGreaterThan(0.8);
    expect(pd.gas).toBe(0);
    // seated start with the right knee raised
    const pd2 = new LegPedals({ seated: true });
    run(pd2, {}, 1.2, seat(1, 0));
    expect(pd2.gas).toBeGreaterThan(0.8);
    expect(pd2.brake).toBe(0);
  });

  it("standing mode with the player sitting: not calibrated, flagged as sitting, no pedals", () => {
    const pd = new LegPedals();
    run(pd, {}, 2, (p) => {
      p.lm[25].y = p.lm[23].y + 0.05 * p.scale;
      p.lm[26].y = p.lm[24].y + 0.05 * p.scale;
    });
    expect(pd.sitting).toBe(true);
    expect(pd.gas).toBe(0);
  });

  it("a player who left the picture for a few seconds has to calibrate again", () => {
    const pd = calibrated();
    for (let i = 0; i < 150; i++) pd.absent(DT);
    expect(pd.ready).toBe(false);
    expect(pd.gas).toBe(0);
    run(pd, {}, 1.3);
    expect(pd.ready).toBe(true);
  });

  it("changing the mode needs a new calibration; setting the same mode keeps it", () => {
    const pd = calibrated();
    pd.setSeated(false);
    expect(pd.ready).toBe(true);
    pd.setSeated(true);
    expect(pd.ready).toBe(false);
  });
});

describe("LegCalibrator (engine PlayerFrame.legs)", () => {
  it("fills the LegState: ok, gas, brake, rest", () => {
    const cal = new LegCalibrator(CFG.legs);
    const out: LegState = { gas: 0, brake: 0, ok: false, rest: 0 };
    const feed = (spec: Spec, secs: number) => {
      for (let i = 0; i < secs / DT; i++) {
        const p = mkPeople([spec])[0];
        cal.update(p.lm, p.scale, DT, out);
      }
    };
    feed({}, 1.5);
    expect(out.ok).toBe(true);
    expect(out.gas).toBe(0);
    expect(out.rest).toBeGreaterThan(0.5);
    feed({ kneeR: 1 }, 0.4);
    expect(out.gas).toBeGreaterThan(0.8);
    feed({}, 0.5);
    feed({ kneeL: 1 }, 0.4);
    expect(out.brake).toBeGreaterThan(0.8);
    expect(out.gas).toBe(0);
    feed({ legsVisible: false }, 0.3);
    expect(out.ok).toBe(false);
    expect(out.gas).toBe(0);
  });
});
