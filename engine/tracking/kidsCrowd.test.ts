import { describe, expect, it } from "vitest";
import { makeSkeleton, type SkeletonOpts } from "../testing/skeleton";
import type { Person } from "../types";
import { CROWD_CFG } from "./crowdConfig";
import { KidTracker } from "./kids";
import { buildPeople, computeFit } from "./people";

// Crowd tracking when detections are slow and uneven (crops analysed one after the other): motion, holding and slot stability.

const W = 1280;
const H = 720;
const fit = computeFit(W, H, W, H);
const FRAME = 1000 / 60;

type Kid = SkeletonOpts & { cx: number };

const people = (kids: Kid[]): Person[] => buildPeople({ landmarks: kids.map((k) => makeSkeleton({ h: 0.5, top: 0.2, ...k })) }, fit);

/** Crops analysed one after the other: the left crop sees the children left of 0.56 (camera x), the right crop those right of 0.44. */
class Crops {
  private n = 0;
  see(kids: Kid[]): Kid[] {
    const left = this.n++ % 2 === 0;
    return kids.filter((k) => (left ? k.cx < 0.56 : k.cx > 0.44));
  }
}

/** a tracker with a 60 Hz render clock; detections are fed whenever the test wants */
class Rig {
  t = 1000;
  tr = new KidTracker();
  joins = 0;
  leaves = 0;
  /** one render frame; `kids` (if given) is a detection arriving in this frame */
  frame(kids?: Kid[]): void {
    this.t += FRAME;
    if (kids) this.tr.update(people(kids), this.t, this.t, W);
    this.tr.extrapolate(this.t, 0);
    for (const s of this.tr.slots) {
      if (s.joined) this.joins++;
      if (s.left) this.leaves++;
    }
    this.tr.endFrame();
  }
  /** a detection every `everyMs` for `sec` seconds; kids(t) gives the truth at second t (from the start of this call) */
  run(sec: number, everyMs: number, kids: (sec: number) => Kid[] | null, onFrame?: (r: Rig, sec: number) => void): void {
    const t0 = this.t;
    let nextDet = this.t;
    while (this.t - t0 < sec * 1000 - 1e-6) {
      const s = (this.t + FRAME - t0) / 1000;
      const det = this.t + FRAME >= nextDet - 1e-6;
      this.frame(det ? (kids(s) ?? undefined) : undefined);
      if (det) nextDet += everyMs;
      onFrame?.(this, s);
    }
  }
}

describe("smooth motion through slow and missing detections", () => {
  // a child walking right in the camera picture at 0.2 picture widths per second = 256 px/s on the stage (mirrored: x falls)
  const SPEED = 0.2;
  const truthX = (sec: number): number => W - (0.3 + SPEED * sec) * W; // stage x of the nose... (centre of the child)
  const walk = (sec: number): Kid[] => [{ cx: 0.3 + SPEED * sec }];
  const nominal = (SPEED * W * FRAME) / 1000; // px per render frame

  it("keeps moving through a 300 ms hole in the detections, without a jump when they come back", () => {
    const r = new Rig();
    const xs: { s: number; x: number }[] = [];
    // 15 detections per second, but none between 1.5 s and 1.8 s
    r.run(
      2.8,
      66,
      (s) => (s > 1.5 && s <= 1.8 ? null : walk(s)),
      (rr, s) => xs.push({ s, x: rr.tr.slots[0].pts.head.x }),
    );
    const k = r.tr.slots[0];
    expect(k.active && k.present).toBe(true);
    // present all the time, never re-joined, never left
    expect(r.joins).toBe(1);
    expect(r.leaves).toBe(0);
    // 1) during the hole (after the last detection's own frame) the drawn point moves on in the same direction every single frame
    const hole = xs.filter((p) => p.s > 1.5 + 0.07 && p.s <= 1.8);
    expect(hole.length).toBeGreaterThan(10);
    for (let i = 1; i < hole.length; i++) {
      const step = hole[i - 1].x - hole[i].x; // x falls while the child walks to the right
      expect(step).toBeGreaterThan(0.25 * nominal);
    }
    // 2) it coasts, a little slower than the child: over the hole it covers most, never more, of the child's way
    const a = xs.find((p) => p.s >= 1.5) as { s: number; x: number };
    const b = hole[hole.length - 1];
    const progress = a.x - b.x;
    const truthProgress = (b.s - a.s) * SPEED * W;
    expect(progress).toBeGreaterThan(0.5 * truthProgress);
    expect(progress).toBeLessThan(1.05 * truthProgress);
    // 3) when the detections come back there is no jump: the point was ~35 px behind the child, it catches up smoothly
    //    (no frame moves more than ~3 frames of walking, i.e. the 35 px are spread over several frames)
    const after = xs.filter((p) => p.s > 1.8 && p.s < 2.4);
    for (let i = 1; i < after.length; i++) expect(Math.abs(after[i - 1].x - after[i].x)).toBeLessThan(3.2 * nominal);
    // 4) and a moment later it is on the child again (the offset of the point to the truth is the same as before the hole)
    const off = (p: { s: number; x: number }): number => p.x - truthX(p.s);
    const before = xs.find((p) => p.s >= 1.4) as { s: number; x: number };
    const last = xs[xs.length - 1];
    expect(Math.abs(off(last) - off(before))).toBeLessThan(0.5 * nominal * 6);
  });

  it("at 6 detections per second (166 ms apart) nothing freezes", () => {
    const r = new Rig();
    r.run(1, 166, walk);
    let still = 0;
    let prev = r.tr.slots[0].pts.head.x;
    let maxStep = 0;
    r.run(3, 166, (s) => walk(1 + s), (rr) => {
      const x = rr.tr.slots[0].pts.head.x;
      if (Math.abs(x - prev) < 0.15 * nominal) still++;
      maxStep = Math.max(maxStep, Math.abs(x - prev));
      prev = x;
    });
    expect(still).toBe(0);
    // no frame moves more than ~3 frames of walking (no jumps)
    expect(maxStep).toBeLessThan(3 * nominal);
  });

  it("the old 100 ms stop is gone: 250 ms after the last detection the point still moves", () => {
    const r = new Rig();
    r.run(1, 33, walk);
    const x0 = r.tr.slots[0].pts.head.x;
    for (let i = 0; i < 6; i++) r.frame(); // 100 ms
    const x1 = r.tr.slots[0].pts.head.x;
    for (let i = 0; i < 9; i++) r.frame(); // 250 ms
    const x2 = r.tr.slots[0].pts.head.x;
    expect(x1).toBeLessThan(x0);
    expect(x2).toBeLessThan(x1 - 5);
  });

  it("a standing child does not drift or shake between detections", () => {
    const r = new Rig();
    r.run(1.5, 100, () => [{ cx: 0.5 }]);
    const x0 = r.tr.slots[0].pts.head.x;
    let dev = 0;
    r.run(2, 100, () => [{ cx: 0.5 }], (rr) => (dev = Math.max(dev, Math.abs(rr.tr.slots[0].pts.head.x - x0))));
    expect(dev).toBeLessThan(0.5);
  });

  it("a point that was coasting slows to a stop (it does not run away)", () => {
    const r = new Rig();
    r.run(1, 33, walk);
    for (let i = 0; i < 30; i++) r.frame(); // 0.5 s
    const a = r.tr.slots[0].pts.head.x;
    for (let i = 0; i < 60; i++) r.frame(); // 1 s more (the child is no longer "present" after 0.8 s: the point is held)
    const b = r.tr.slots[0].pts.head.x;
    expect(Math.abs(b - a)).toBeLessThan(SPEED * W * CROWD_CFG.motion.holdTauMs * 0.001 * 1.1);
  });
});

describe("holding a child through misses", () => {
  // camera x is mirrored on the stage: the child with the larger cx is further LEFT on the screen and gets the lower slot
  const still: Kid = { cx: 0.4 };

  it("present and held (not frozen out) through a 0.6 s miss; same slot afterwards; nobody joins", () => {
    const r = new Rig();
    r.run(1, 33, () => [still, { cx: 0.7 }]);
    const k = r.tr.slots[1]; // cx 0.4 is right of cx 0.7 on the screen
    const x0 = k.pts.head.x;
    expect(r.joins).toBe(2);
    r.run(0.6, 33, () => [{ cx: 0.7 }]);
    expect(k.active && k.present && k.held).toBe(true);
    expect(k.lostFor).toBeGreaterThan(0.5);
    expect(Math.abs(k.pts.head.x - x0)).toBeLessThan(2);
    expect(r.tr.count).toBe(2);
    r.run(0.3, 33, () => [still, { cx: 0.7 }]);
    expect(k.present && !k.held).toBe(true);
    expect(r.joins).toBe(2);
    expect(r.leaves).toBe(0);
  });

  it("after the hold time the child is not present any more but the slot is kept and the position held", () => {
    const r = new Rig();
    r.run(1, 33, () => [still]);
    const k = r.tr.slots[0];
    const x0 = k.pts.head.x;
    r.run(CROWD_CFG.hold.presentSec + 0.3, 33, () => []);
    expect(k.active).toBe(true);
    expect(k.present).toBe(false);
    expect(Math.abs(k.pts.head.x - x0)).toBeLessThan(2);
  });

  it("a longer detection round makes the hold longer", () => {
    const r = new Rig();
    r.tr.cycleMs = 800;
    r.run(1, 33, () => [still]);
    r.run(1.2, 33, () => []);
    expect(r.tr.slots[0].present).toBe(true); // 800 ms x 2.5 = 2 s (capped)
    r.run(1.2, 33, () => []);
    expect(r.tr.slots[0].present).toBe(false);
  });
});

describe("children standing close together", () => {
  /** a body is 0.5 of the picture high -> a shoulder width of ~128 px; the children stand 1.0-1.3 shoulder widths apart and sway/step */
  for (const n of [3, 4, 5]) {
    it(`${n} children shoulder to shoulder, noisy, with misses: nobody swaps, nobody joins twice`, () => {
      const r = new Rig();
      let seed = 7 + n;
      const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const base = Array.from({ length: n }, (_, i) => 0.5 + (i - (n - 1) / 2) * 0.1);
      const truth = (s: number): Kid[] =>
        base.map((x, i) => ({ cx: x + 0.018 * Math.sin(s * 1.6 + i * 2.1), top: 0.2 + 0.015 * Math.sin(s * 2.3 + i) }));
      const jitter = (k: Kid): Kid => ({ ...k, cx: k.cx + (rnd() - 0.5) * 0.006, top: (k.top ?? 0.2) + (rnd() - 0.5) * 0.006 });
      const owner: number[] = [];
      r.run(
        10,
        70, // all in one pass (MoveNet) or a crop every 70 ms
        (s) => truth(s).filter(() => rnd() > 0.15).map(jitter),
        (rr, s) => {
          if (s > 1.2 && s < 1.25 && owner.length === 0) {
            // the slot nearest to each child (left to right on the stage = right to left on the camera)
            const t = truth(s);
            t.forEach((k) => {
              let best = 0;
              for (let i = 1; i < 5; i++) if (Math.abs(rr.tr.slots[i].center.x - (W - k.cx * W)) < Math.abs(rr.tr.slots[best].center.x - (W - k.cx * W))) best = i;
              owner.push(best);
            });
          }
        },
      );
      expect(owner.length).toBe(n);
      expect(new Set(owner).size).toBe(n);
      expect(r.joins).toBe(n);
      expect(r.leaves).toBe(0);
      const t = truth((r.t - 1000) / 1000);
      owner.forEach((slot, child) => expect(Math.abs(r.tr.slots[slot].center.x - (W - t[child].cx * W))).toBeLessThan(0.06 * W));
    });
  }

  it("two neighbours swap places (walk past each other): each animal stays with its own child", () => {
    const r = new Rig();
    const A = (s: number): Kid => ({ cx: 0.45 + Math.min(1, s / 2) * 0.1 });
    const B = (s: number): Kid => ({ cx: 0.55 - Math.min(1, s / 2) * 0.1 });
    r.run(0.6, 50, () => [A(0), B(0)]);
    const sa = r.tr.slots[0].center.x > r.tr.slots[1].center.x ? 0 : 1; // A is left in the picture = larger stage x
    r.run(3, 50, (s) => [A(s), B(s)]);
    expect(r.joins).toBe(2);
    expect(Math.abs(r.tr.slots[sa].center.x - (W - 0.55 * W))).toBeLessThan(0.05 * W);
    expect(Math.abs(r.tr.slots[1 - sa].center.x - (W - 0.45 * W))).toBeLessThan(0.05 * W);
  });
});

describe("a child who is missed keeps moving gently and keeps the animal", () => {
  it("a walking child is not seen for 1.3 s: the animal glides on and stops (never jumps), then follows again from the same slot", () => {
    const r = new Rig();
    const x = (s: number): number => 0.2 + 0.1 * s;
    let prev = 0;
    let maxStep = 0;
    r.run(2, 60, (s) => [{ cx: x(s) }]);
    prev = r.tr.slots[0].pts.head.x;
    const x0 = prev;
    r.run(1.3, 60, () => [], (rr) => {
      maxStep = Math.max(maxStep, Math.abs(rr.tr.slots[0].pts.head.x - prev));
      prev = rr.tr.slots[0].pts.head.x;
    });
    expect(r.tr.slots[0].active).toBe(true);
    const moved = x0 - r.tr.slots[0].pts.head.x;
    expect(moved).toBeGreaterThan(10); // it glided on a little
    expect(moved).toBeLessThan(0.1 * W * 0.7); // but not a runaway
    expect(maxStep).toBeLessThan(6);
    const at = r.tr.slots[0].pts.head.x;
    r.run(0.1, 60, () => []);
    expect(Math.abs(r.tr.slots[0].pts.head.x - at)).toBeLessThan(3); // settled: no creep
    r.run(1, 60, (s) => [{ cx: x(3.3 + s) }]);
    expect(r.joins).toBe(1);
    expect(r.tr.slots[0].present).toBe(true);
    expect(Math.abs(r.tr.slots[0].center.x - (W - x(4.3 ) * W))).toBeLessThan(0.08 * W);
  });
});

describe("joining", () => {
  it("one false detection does not make a child; two at the same place do", () => {
    const r = new Rig();
    r.run(0.5, 33, () => [{ cx: 0.3 }]);
    expect(r.tr.count).toBe(1);
    r.frame([{ cx: 0.3 }, { cx: 0.8 }]); // phantom, one detection only
    r.run(0.4, 33, () => [{ cx: 0.3 }]);
    expect(r.tr.slots[1].active).toBe(false);
    expect(r.joins).toBe(1);
    r.run(0.3, 33, () => [{ cx: 0.3 }, { cx: 0.8 }]);
    expect(r.tr.slots[1].active).toBe(true);
    expect(r.joins).toBe(2);
  });

  it("a duplicate from the overlap of two crops (same child, a few px apart, alternating) is one child", () => {
    const r = new Rig();
    let i = 0;
    r.run(2, 33, () => [{ cx: 0.5 + (i++ % 2 ? 0.004 : -0.004), top: 0.2 + (i % 2 ? 0.003 : 0) }]);
    expect(r.tr.count).toBe(1);
    expect(r.joins).toBe(1);
    expect(r.tr.slots[1].active).toBe(false);
  });
});

describe("five children, crops analysed one after the other", () => {
  // camera x of the five children; the left crop sees the ones left of 0.56, the right crop the ones right of 0.44
  const BASE = [0.1, 0.3, 0.5, 0.7, 0.9];
  const sway = (i: number, s: number): number => 0.03 * Math.sin(s * 1.3 + i * 1.7);
  const truth = (s: number): Kid[] => BASE.map((x, i) => ({ cx: x + sway(i, s), top: 0.2 + 0.02 * Math.sin(s * 2 + i) }));

  it("all five keep their slots for 8 s, nobody joins twice, nobody is lost", () => {
    const r = new Rig();
    const crops = new Crops();
    let seed = 11;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // which slot holds which child after the first 1.5 s (the children join in two groups, one per crop, so the slot order need not be left to right)
    const owner = (): number[] => {
      const t = truth(r.t === 0 ? 0 : (r.t - 1000) / 1000);
      return t.map((k) => {
        let best = 0;
        for (let i = 1; i < 5; i++) if (Math.abs(r.tr.slots[i].center.x - (W - k.cx * W)) < Math.abs(r.tr.slots[best].center.x - (W - k.cx * W))) best = i;
        return best;
      });
    };
    let first: number[] = [];
    r.run(
      8,
      45, // one crop every 45 ms: each child is refreshed every ~90 ms
      (s) => crops.see(truth(s)).filter(() => rnd() > 0.1), // 10 % misses on top
      (rr, s) => {
        if (s > 1.45 && s < 1.5) first = owner();
      },
    );
    expect(r.joins).toBe(5);
    expect(r.leaves).toBe(0);
    expect(r.tr.count).toBe(5);
    expect(new Set(first).size).toBe(5);
    // every child is still on the slot it had at the start, and the slot is on the child
    expect(owner()).toEqual(first);
    const t = truth((r.t - 1000) / 1000);
    first.forEach((slot, child) => expect(Math.abs(r.tr.slots[slot].center.x - (W - t[child].cx * W))).toBeLessThan(0.08 * W));
  });

  it("slow rounds (a crop every 150 ms, each child refreshed every 300 ms): nobody flickers, nobody joins twice", () => {
    const r = new Rig();
    r.tr.cycleMs = 300;
    const crops = new Crops();
    let bad = 0;
    r.run(
      8,
      150,
      (s) => crops.see(truth(s)),
      (rr, s) => {
        if (s > 1.5 && rr.tr.count !== 5) bad++;
      },
    );
    expect(bad).toBe(0);
    expect(r.joins).toBe(5);
    expect(r.leaves).toBe(0);
  });

  it("the avatars keep moving: no slot stands still for more than 0.2 s while its child sways", () => {
    const r = new Rig();
    const crops = new Crops();
    const det = (s: number): Kid[] => crops.see(truth(s));
    r.run(2, 45, det);
    const prev = r.tr.slots.map((k) => k.pts.head.x);
    const stillFor = [0, 0, 0, 0, 0];
    let worst = 0;
    r.run(6, 45, (s) => det(2 + s), (rr) => {
      for (let i = 0; i < 5; i++) {
        const x = rr.tr.slots[i].pts.head.x;
        stillFor[i] = Math.abs(x - prev[i]) < 0.02 ? stillFor[i] + FRAME / 1000 : 0;
        prev[i] = x;
        worst = Math.max(worst, stillFor[i]);
      }
    });
    // the sway has turning points (speed 0) that last a frame or two; a freeze would last much longer
    expect(worst).toBeLessThan(0.2);
  });

  it("two children cross each other on the same row and keep their own slots", () => {
    const r = new Rig();
    // A walks 0.3 -> 0.7, B walks 0.7 -> 0.3 in 3 s, same height; three more children stand around (one on a lower row)
    const A = (s: number): Kid => ({ cx: 0.3 + (0.4 * s) / 3 });
    const B = (s: number): Kid => ({ cx: 0.7 - (0.4 * s) / 3 });
    const others: Kid[] = [{ cx: 0.08 }, { cx: 0.92 }, { cx: 0.5, top: 0.5 }];
    const all = (s: number): Kid[] => [A(s), B(s), ...others];
    r.run(0.5, 33, () => all(0));
    const slotOf = (x: number): number => {
      let best = 0;
      for (let i = 1; i < 5; i++) if (Math.abs(r.tr.slots[i].center.x - x) < Math.abs(r.tr.slots[best].center.x - x)) best = i;
      return best;
    };
    const sa = slotOf(W - 0.3 * W);
    const sb = slotOf(W - 0.7 * W);
    expect(sa).not.toBe(sb);
    const crops = new Crops();
    r.run(3, 45, (s) => crops.see(all(s))); // crops, as in the room
    expect(r.joins).toBe(5);
    expect(r.leaves).toBe(0);
    // A is now on the right of the picture (stage x small), B on the left
    expect(Math.abs(r.tr.slots[sa].center.x - (W - 0.7 * W))).toBeLessThan(0.1 * W);
    expect(Math.abs(r.tr.slots[sb].center.x - (W - 0.3 * W))).toBeLessThan(0.1 * W);
  });

  it("a child missed for a few frames while crossing is not taken over by the neighbour", () => {
    const r = new Rig();
    const A = (s: number): Kid => ({ cx: 0.3 + (0.4 * s) / 3 });
    const B = (s: number): Kid => ({ cx: 0.7 - (0.4 * s) / 3 });
    r.run(0.5, 33, () => [A(0), B(0)]);
    const sa = r.tr.slots[0].center.x > r.tr.slots[1].center.x ? 0 : 1; // stage x grows to the left: A starts at the left of the picture (cx .3) -> larger stage x
    const sb = 1 - sa;
    // during the crossing (1.3 .. 1.7 s) the detector only finds one of them (B), 5 detections in a row
    r.run(3, 33, (s) => (s > 1.3 && s < 1.5 ? [B(s)] : [A(s), B(s)]));
    expect(r.joins).toBe(2);
    expect(Math.abs(r.tr.slots[sa].center.x - (W - 0.7 * W))).toBeLessThan(0.1 * W);
    expect(Math.abs(r.tr.slots[sb].center.x - (W - 0.3 * W))).toBeLessThan(0.1 * W);
  });

  it("a stranger never takes the slot of a child who was seen a moment ago", () => {
    const r = new Rig();
    const five = BASE.map((x) => ({ cx: x }));
    r.run(1, 33, () => five);
    expect(r.tr.count).toBe(5);
    // the middle child steps out of view; 0.5 s later somebody new appears far from every slot (e.g. a teacher behind the group)
    const four = five.filter((_, i) => i !== 2);
    const stranger: Kid = { cx: 0.5, top: 0.6, h: 0.12 }; // small: not the child who left
    r.run(0.5, 33, () => four);
    r.run(0.4, 33, () => [...four, stranger]);
    expect(r.tr.slots[2].active).toBe(true);
    expect(r.joins).toBe(5);
    expect(r.leaves).toBe(0);
    // the middle child comes back to its place: still slot 2
    r.run(0.4, 33, () => five);
    expect(r.tr.slots[2].present).toBe(true);
    expect(r.tr.slots[2].joined).toBe(false);
    expect(r.joins).toBe(5);
  });

  it("a child who has really left (> 1 s) gives his slot to a newcomer", () => {
    const r = new Rig();
    const five = BASE.map((x) => ({ cx: x }));
    r.run(1, 33, () => five);
    const four = five.filter((_, i) => i !== 2);
    r.run(1.3, 33, () => four);
    expect(r.tr.slots[2].present).toBe(false);
    r.run(0.4, 33, () => [...four, { cx: 0.5, top: 0.6, h: 0.12 }]);
    expect(r.tr.slots[2].present).toBe(true);
    expect(r.joins).toBe(6);
    expect(r.leaves).toBe(1);
  });
});
