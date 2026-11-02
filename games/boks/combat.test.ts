import { describe, expect, it } from "vitest";
import { DefenseTracker, damageFor, judgeDefense, resolvePunch, type DefenseInput, type PadLike } from "./combat";

const still: DefenseInput = { devXMax: 0.05, devXMin: -0.05, devY: 0.02, guard: 0 };

describe("dodge, block, hit", () => {
  it("standing still takes the hit", () => {
    expect(judgeDefense("straight", 1, still)).toBe("hit");
    expect(judgeDefense("hook", -1, still)).toBe("hit");
  });

  it("a lean to either side dodges a straight punch", () => {
    expect(judgeDefense("straight", 1, { ...still, devXMax: 0.7 })).toBe("dodge");
    expect(judgeDefense("straight", -1, { ...still, devXMin: -0.7 })).toBe("dodge");
  });

  it("a hook is dodged only by leaning away from its side, or by ducking", () => {
    // the glove comes from the left of the screen: leaning right (+) avoids it, leaning left runs into it
    expect(judgeDefense("hook", -1, { ...still, devXMax: 0.7 })).toBe("dodge");
    expect(judgeDefense("hook", -1, { ...still, devXMin: -0.7 })).toBe("hit");
    expect(judgeDefense("hook", 1, { ...still, devXMin: -0.7 })).toBe("dodge");
    expect(judgeDefense("hook", 1, { ...still, devY: 0.8 })).toBe("dodge");
  });

  it("both hands at the face block", () => {
    expect(judgeDefense("straight", 1, { ...still, guard: 0.3 })).toBe("block");
    // a guard that has just been raised is not a block yet
    expect(judgeDefense("straight", 1, { ...still, guard: 0.02 })).toBe("hit");
  });

  it("a dodge beats a block", () => {
    expect(judgeDefense("straight", 1, { ...still, devXMax: 0.9, guard: 1 })).toBe("dodge");
  });

  it("a dodge costs nothing, a block a quarter, a hit all (hooks hit harder)", () => {
    expect(damageFor("dodge", 10, false)).toBe(0);
    expect(damageFor("block", 10, false)).toBeCloseTo(2.5);
    expect(damageFor("hit", 10, false)).toBe(10);
    expect(damageFor("hit", 10, true)).toBeCloseTo(12.5);
    expect(damageFor("block", 10, false)).toBeLessThan(damageFor("hit", 10, false));
  });
});

describe("defence tracker", () => {
  const drive = (tr: DefenseTracker, from: number, to: number, hx: (t: number) => number, hy = 0, guard = false): void => {
    for (let t = from; t < to; t += 1 / 30) tr.push(t, hx(t), hy, guard, 1 / 30);
  };

  it("a lean held at the impact is a dodge, measured against where the head stood when the telegraph began", () => {
    const tr = new DefenseTracker();
    drive(tr, 0, 2, () => 3);
    tr.begin();
    drive(tr, 2, 2.7, (t) => (t < 2.45 ? 3 : 3.8));
    const out: DefenseInput = { devXMax: 0, devXMin: 0, devY: 0, guard: 0 };
    tr.read(2.7, out);
    expect(out.devXMax).toBeGreaterThan(0.7);
    expect(judgeDefense("straight", 1, out)).toBe("dodge");
  });

  it("a lean that came back before the impact does not count", () => {
    const tr = new DefenseTracker();
    drive(tr, 0, 2, () => 3);
    tr.begin();
    drive(tr, 2, 2.7, (t) => (t > 2.1 && t < 2.3 ? 3.9 : 3));
    const out: DefenseInput = { devXMax: 0, devXMin: 0, devY: 0, guard: 0 };
    tr.read(2.7, out);
    expect(judgeDefense("straight", 1, out)).toBe("hit");
  });

  it("slow drift of the head moves the baseline along, a sudden lean does not", () => {
    const tr = new DefenseTracker();
    drive(tr, 0, 10, (t) => 3 + t * 0.05);
    tr.begin();
    drive(tr, 10, 10.4, (t) => 3 + t * 0.05);
    const out: DefenseInput = { devXMax: 0, devXMin: 0, devY: 0, guard: 0 };
    tr.read(10.4, out);
    expect(out.devXMax).toBeLessThan(0.3);
  });

  it("ducking shows as devY and the guard time counts continuously", () => {
    const tr = new DefenseTracker();
    drive(tr, 0, 2, () => 0);
    tr.begin();
    drive(tr, 2, 2.5, () => 0, 0.8, true);
    const out: DefenseInput = { devXMax: 0, devXMin: 0, devY: 0, guard: 0 };
    tr.read(2.5, out);
    expect(out.devY).toBeGreaterThan(0.55);
    expect(out.guard).toBeGreaterThan(0.3);
    drive(tr, 2.5, 2.6, () => 0, 0, false);
    tr.read(2.6, out);
    expect(out.guard).toBe(0);
  });
});

describe("which pad does a punch land on", () => {
  const pad = (o: Partial<PadLike>): PadLike => ({ active: true, side: "L", age: 0.5, d: 10, r: 60, ...o });

  it("the matching hand on its pad", () => {
    expect(resolvePunch([pad({ side: "L" }), pad({ side: "R", d: 200 })], "L")).toEqual({ index: 0, wrong: false });
    expect(resolvePunch([pad({ side: "L", d: 200 }), pad({ side: "R" })], "R")).toEqual({ index: 1, wrong: false });
  });

  it("the wrong hand does not score and does not take the pad", () => {
    expect(resolvePunch([pad({ side: "R" })], "L")).toEqual({ index: -1, wrong: true });
  });

  it("out of reach, too young or inactive pads are not hit", () => {
    expect(resolvePunch([pad({ d: 100 })], "L")).toEqual({ index: -1, wrong: false });
    expect(resolvePunch([pad({ age: 0.02 })], "L")).toEqual({ index: -1, wrong: false });
    expect(resolvePunch([pad({ active: false })], "L")).toEqual({ index: -1, wrong: false });
  });

  it("with both colours in reach the right one is taken", () => {
    expect(resolvePunch([pad({ side: "R", d: 5 }), pad({ side: "L", d: 40 })], "L")).toEqual({ index: 1, wrong: false });
  });
});
