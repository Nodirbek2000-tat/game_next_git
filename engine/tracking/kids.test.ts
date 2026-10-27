import { describe, expect, it } from "vitest";
import { makeSkeleton, type SkeletonOpts } from "../testing/skeleton";
import type { Person } from "../types";
import { FREE_AFTER_SEC, KidTracker } from "./kids";
import { buildPeople, computeFit } from "./people";

const W = 1280;
const H = 720;
const fit = computeFit(W, H, W, H);
const DT = 1000 / 30;

type Kid = SkeletonOpts & { cx: number };

/** people of one synthetic camera frame (stage px, mirrored like the engine does it) */
function people(kidsIn: Kid | Kid[]): Person[] {
  const kids = Array.isArray(kidsIn) ? kidsIn : [kidsIn];
  return buildPeople({ landmarks: kids.map((k) => makeSkeleton({ h: 0.5, top: 0.2, ...k })) }, fit);
}

class Sim {
  t = 1000;
  tr = new KidTracker();
  /** one detection + one render frame */
  step(kids: Kid | Kid[]): void {
    this.t += DT;
    this.tr.update(people(kids), this.t, this.t, W);
    this.tr.extrapolate(this.t, 0);
  }
  run(sec: number, kids: Kid | Kid[] | ((i: number) => Kid | Kid[])): void {
    const n = Math.round(sec * 30);
    for (let i = 0; i < n; i++) this.step(typeof kids === "function" ? kids(i) : kids);
  }
  /** end of a render frame (clears the one-frame events) */
  end(): void {
    this.tr.endFrame();
  }
}

// camera x -> stage x is mirrored: a larger cx is further LEFT on screen
const FIVE: Kid[] = [0.9, 0.7, 0.5, 0.3, 0.1].map((cx) => ({ cx }));

describe("kid slots: assignment", () => {
  it("5 children get slots 0..4 from left to right (on screen)", () => {
    const s = new Sim();
    s.run(0.5, FIVE);
    expect(s.tr.count).toBe(5);
    const xs = s.tr.slots.map((k) => k.center.x);
    for (let i = 1; i < 5; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    for (const k of s.tr.slots) {
      expect(k.active && k.present).toBe(true);
      expect(k.animal.emoji).toBeTruthy();
    }
    expect(s.tr.slots.map((k) => k.animal.emoji)).toEqual(["🐰", "🐻", "🐱", "🐶", "🐸"]);
  });

  it("a child keeps the slot while walking, also when the order of detections changes", () => {
    const s = new Sim();
    s.run(0.4, FIVE);
    const x0 = s.tr.slots.map((k) => k.center.x);
    // everybody walks 0.05 to the right (camera) in a second; the detector lists the people in reverse order
    s.run(1, (i) => {
      const dx = (0.05 * i) / 30;
      return FIVE.map((k) => ({ cx: k.cx - dx })).reverse();
    });
    const x1 = s.tr.slots.map((k) => k.center.x);
    for (let i = 0; i < 5; i++) expect(x1[i]).toBeGreaterThan(x0[i]); // stage x grows when camera cx falls
    expect(s.tr.count).toBe(5);
  });

  it("two children swap places without swapping slots", () => {
    const s = new Sim();
    // A (top row) walks 0.3 -> 0.7, B (lower row) walks 0.7 -> 0.3: they cross in the middle
    const A = (u: number): Kid => ({ cx: 0.3 + 0.4 * u, top: 0.08 });
    const B = (u: number): Kid => ({ cx: 0.7 - 0.4 * u, top: 0.3 });
    s.run(0.4, [A(0), B(0)]);
    const slotA = s.tr.slots.findIndex((k) => k.active && Math.abs(k.center.x - (W - 0.3 * W)) < 80);
    const slotB = 1 - slotA;
    expect(slotA).toBeGreaterThanOrEqual(0);
    const N = 60;
    for (let i = 1; i <= N; i++) s.step([A(i / N), B(i / N)]);
    const a = s.tr.slots[slotA];
    const b = s.tr.slots[slotB];
    expect(Math.abs(a.center.x - (W - 0.7 * W))).toBeLessThan(60);
    expect(Math.abs(b.center.x - (W - 0.3 * W))).toBeLessThan(60);
    expect(a.center.y).toBeLessThan(b.center.y);
  });

  it("a child who leaves keeps the slot for ~2 s and gets it back; later the slot is freed", () => {
    const s = new Sim();
    const three: Kid[] = [{ cx: 0.8 }, { cx: 0.5 }, { cx: 0.2 }];
    s.run(0.5, three);
    expect(s.tr.slots.map((k) => k.active)).toEqual([true, true, true, false, false]);
    // the middle child steps out of the picture for 1 s
    s.run(1, [three[0], three[2]]);
    expect(s.tr.slots[1].active).toBe(true);
    expect(s.tr.slots[1].present).toBe(false);
    expect(s.tr.count).toBe(2);
    // ... and comes back at the same place: same slot, nobody else took it
    s.run(0.3, three);
    expect(s.tr.slots[1].present).toBe(true);
    expect(s.tr.slots[3].active).toBe(false);
    // leaves for good
    s.run(FREE_AFTER_SEC + 0.3, [three[0], three[2]]);
    expect(s.tr.slots[1].active).toBe(false);
    // the slot is announced once
    expect(s.tr.slots[1].left).toBe(true);
    s.end();
    expect(s.tr.slots[1].left).toBe(false);
    // returns after > 2 s: a new child, it takes the free slot that keeps the left-to-right order
    s.run(0.4, three);
    expect(s.tr.slots[1].active && s.tr.slots[1].present).toBe(true);
    expect(s.tr.slots[1].joined).toBe(true);
    expect(s.tr.count).toBe(3);
  });

  it("a new child takes a free slot and never steals one from a present child", () => {
    const s = new Sim();
    s.run(0.5, [{ cx: 0.7 }, { cx: 0.4 }]);
    const before = [s.tr.slots[0].center.x, s.tr.slots[1].center.x];
    s.run(0.5, [{ cx: 0.7 }, { cx: 0.4 }, { cx: 0.15 }]);
    expect(s.tr.slots[2].active).toBe(true);
    expect(s.tr.slots[2].center.x).toBeGreaterThan(s.tr.slots[1].center.x);
    expect(Math.abs(s.tr.slots[0].center.x - before[0])).toBeLessThan(5);
    expect(Math.abs(s.tr.slots[1].center.x - before[1])).toBeLessThan(5);
    expect(s.tr.count).toBe(3);
  });

  it("respects maxKids", () => {
    const s = new Sim();
    s.tr.maxKids = 3;
    s.run(0.5, FIVE);
    expect(s.tr.count).toBe(3);
    expect(s.tr.slots[3].active).toBe(false);
  });
});

describe("kid signals", () => {
  const stand = (o: Partial<Kid> = {}): Kid => ({ cx: 0.5, ...o });

  it("handsUp / armsOut", () => {
    const s = new Sim();
    s.run(0.5, stand());
    expect(s.tr.slots[0].signals.handsUp).toBe(false);
    s.run(0.5, stand({ armL: "up", armR: "up" }));
    expect(s.tr.slots[0].signals.handsUp).toBe(true);
    s.run(0.5, stand({ armL: [0.5 + 0.18, 0.2 + 0.5 * 0.17], armR: [0.5 - 0.18, 0.2 + 0.5 * 0.17] }));
    expect(s.tr.slots[0].signals.armsOut).toBe(true);
    expect(s.tr.slots[0].signals.handsUp).toBe(false);
  });

  it("jump fires once per jump; squat is a state", () => {
    const s = new Sim();
    s.run(1.5, stand());
    const k = s.tr.slots[0];
    expect(k.signals.jump || k.signals.squat).toBe(false);
    let fired = 0;
    // 0.5 s jump: the whole body rises by 0.1 of the image height and comes down
    for (let i = 0; i < 15; i++) {
      s.step(stand({ top: 0.2 - 0.1 * Math.sin((i / 14) * Math.PI) }));
      if (k.signals.jumpFired) fired++;
      s.end();
    }
    expect(fired).toBe(1);
    expect(k.signals.jumps).toBe(1);
    s.run(0.6, stand());
    expect(k.signals.jump).toBe(false);
    // second jump later: counted again
    for (let i = 0; i < 15; i++) {
      s.step(stand({ top: 0.2 - 0.1 * Math.sin((i / 14) * Math.PI) }));
      s.end();
    }
    expect(k.signals.jumps).toBe(2);
    // squat: hips drop and stay down
    s.run(0.2, stand({ top: 0.2 + 0.1 }));
    expect(k.signals.squat).toBe(true);
    expect(k.signals.jump).toBe(false);
    s.run(1, stand());
    expect(k.signals.squat).toBe(false);
  });

  it("slow drift (walking away) is not a jump", () => {
    const s = new Sim();
    s.run(1, stand());
    s.run(3, (i) => stand({ top: 0.2 - 0.06 * (i / 90) }));
    expect(s.tr.slots[0].signals.jumps).toBe(0);
  });

  it("clap fires when the hands meet after being apart", () => {
    const s = new Sim();
    const y = 0.29;
    const apart = stand({ armL: [0.5 + 0.1, y], armR: [0.5 - 0.1, y] });
    const together = stand({ armL: [0.5 + 0.005, y], armR: [0.5 - 0.005, y] });
    s.run(0.6, apart);
    const k = s.tr.slots[0];
    expect(k.signals.clap).toBe(false);
    let fired = 0;
    for (let i = 0; i < 12; i++) {
      s.step(i < 5 ? apart : together);
      if (k.signals.clapFired) fired++;
      s.end();
    }
    expect(fired).toBe(1);
    expect(k.signals.clap).toBe(true);
    expect(k.signals.claps).toBe(1);
  });

  it("wave: a raised hand swinging left-right", () => {
    const s = new Sim();
    s.run(0.5, stand());
    let seen = false;
    s.run(1.5, (i) => {
      const x = 0.5 - 0.17 + 0.05 * Math.sin((i / 30) * Math.PI * 2 * 2.5);
      return stand({ armR: [x, 0.15] });
    });
    seen = s.tr.slots[0].signals.wave;
    expect(seen).toBe(true);
    s.run(1, stand());
    expect(s.tr.slots[0].signals.wave).toBe(false);
  });

  it("stillness: frozen child (with sensor noise) is still, a dancing child is not", () => {
    const s = new Sim();
    let seed = 7;
    const noise = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.0012; // ~ +-0.4 px
    };
    s.run(1.5, () => stand({ cx: 0.5 + noise(), top: 0.2 + noise() }));
    const k = s.tr.slots[0];
    expect(k.signals.still).toBe(true);
    expect(k.signals.stillFor).toBeGreaterThan(0.5);
    // dancing: arms and body move about
    s.run(1, (i) => stand({ cx: 0.5 + 0.03 * Math.sin(i * 0.5), armL: [0.6, 0.3 + 0.1 * Math.sin(i * 0.7)], armR: [0.4, 0.3 + 0.1 * Math.cos(i * 0.7)] }));
    expect(k.signals.still).toBe(false);
    expect(k.signals.stillFor).toBe(0);
    expect(k.signals.energy).toBeGreaterThan(0.5);
  });

  it("one-frame events last exactly one render frame", () => {
    const s = new Sim();
    s.run(1.5, stand());
    const k = s.tr.slots[0];
    for (let i = 0; i < 6; i++) s.step(stand({ top: 0.2 - 0.1 * Math.sin((i / 5) * Math.PI * 0.5) }));
    expect(k.signals.jumpFired).toBe(true);
    s.end();
    expect(k.signals.jumpFired).toBe(false);
  });
});
