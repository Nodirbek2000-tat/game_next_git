import { describe, expect, it } from "vitest";
import { classify, JackCounter, STAGES, Workout, type Pose } from "./logic";

const DT = 1 / 30;
const blank = (): Pose => ({ up: false, down: false, apart: false, together: false, legs: false });
const OPEN: Pose = { up: true, down: false, apart: true, together: false, legs: true };
const SHUT: Pose = { up: false, down: true, apart: false, together: true, legs: true };

function feed(c: JackCounter, p: Pose, secs: number): number {
  let n = 0;
  for (let t = 0; t < secs; t += DT) if (c.update(DT, p)) n++;
  return n;
}

describe("jack counter", () => {
  it("open then closed is one rep", () => {
    const c = new JackCounter();
    expect(feed(c, SHUT, 0.5)).toBe(0);
    expect(feed(c, OPEN, 0.5)).toBe(0);
    expect(feed(c, SHUT, 0.5)).toBe(1);
    expect(c.reps).toBe(1);
  });
  it("arms up without opening the legs is not a rep", () => {
    const c = new JackCounter();
    const armsOnly: Pose = { ...OPEN, apart: false, together: true };
    feed(c, armsOnly, 0.5);
    feed(c, SHUT, 0.5);
    expect(c.reps).toBe(0);
  });
  it("legs out of the picture: arms alone count", () => {
    const c = new JackCounter();
    const a: Pose = { up: true, down: false, apart: false, together: false, legs: false };
    const b: Pose = { up: false, down: true, apart: false, together: false, legs: false };
    for (let i = 0; i < 3; i++) {
      feed(c, a, 0.4);
      feed(c, b, 0.4);
    }
    expect(c.reps).toBe(3);
  });
  it("a flicker is not a rep", () => {
    const c = new JackCounter();
    feed(c, OPEN, DT);
    feed(c, SHUT, 0.3);
    expect(c.reps).toBe(0);
  });
  it("classifies a skeleton", () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 200, y: 300, v: 0.9 }));
    lm[0] = { x: 200, y: 100, v: 0.9 };
    lm[11] = { x: 230, y: 160, v: 0.9 };
    lm[12] = { x: 170, y: 160, v: 0.9 };
    lm[15] = { x: 260, y: 40, v: 0.9 };
    lm[16] = { x: 140, y: 40, v: 0.9 };
    lm[27] = { x: 300, y: 500, v: 0.9 };
    lm[28] = { x: 100, y: 500, v: 0.9 };
    const p = classify(lm, 60, 600, blank());
    expect(p).toMatchObject({ up: true, down: false, apart: true, together: false, legs: true });
    lm[15] = { x: 235, y: 300, v: 0.9 };
    lm[16] = { x: 165, y: 300, v: 0.9 };
    lm[27] = { x: 215, y: 500, v: 0.9 };
    lm[28] = { x: 185, y: 500, v: 0.9 };
    expect(classify(lm, 60, 600, blank())).toMatchObject({ up: false, down: true, apart: false, together: true });
    lm[27].y = 700; // below the screen: legs unseen
    expect(classify(lm, 60, 600, blank()).legs).toBe(false);
  });
});

describe("workout", () => {
  it("passes a stage when the target is reached, fails it when time runs out", () => {
    const w = new Workout(10);
    let res = 0;
    for (let i = 0; i < STAGES[0]; i++) res = w.update(0.5, true) || res;
    expect(res).toBe(1);
    expect(w.passed).toBe(1);
    // stage 0 ends (10 s total) -> next stage
    for (let t = 0; t < 8; t += 0.5) w.update(0.5, false);
    expect(w.stage).toBe(1);
    // an idle stage fails
    let failed = 0;
    for (let t = 0; t < 10.5; t += 0.5) if (w.update(0.5, false) === 2) failed++;
    expect(failed).toBe(1);
  });
  it("finishes after all stages", () => {
    const w = new Workout(1);
    for (let i = 0; i < STAGES.length * 3; i++) w.update(0.5, false);
    expect(w.done).toBe(true);
  });
});
