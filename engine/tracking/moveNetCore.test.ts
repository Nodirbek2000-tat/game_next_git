import { describe, expect, it } from "vitest";
import { CROWD_CFG } from "./crowdConfig";
import { decodeMultiPose, inputGeo, MN_STRIDE, MN_TO_MP, MP_FILL, PosePool, SizeController } from "./moveNetCore";
import { buildPeople, computeFit } from "./people";

const CFG = CROWD_CFG.movenet;

type Kp = [number, number, number]; // x, y, score

/** One MoveNet person in the output layout: 17 x (y, x, score), then ymin, xmin, ymax, xmax, score. */
function person(score: number, kp: Partial<Record<number, Kp>> = {}, fill: Kp = [0.5, 0.5, 0.9]): number[] {
  const a: number[] = [];
  for (let k = 0; k < 17; k++) {
    const [x, y, s] = kp[k] ?? fill;
    a.push(y, x, s);
  }
  a.push(0, 0, 1, 1, score);
  return a;
}
const out = (...ps: number[][]): Float32Array => {
  const f = new Float32Array(6 * MN_STRIDE);
  ps.forEach((p, i) => f.set(p, i * MN_STRIDE));
  return f;
};

describe("inputGeo", () => {
  it("scales the long side, keeps the aspect ratio, pads to multiples of 32", () => {
    expect(inputGeo(1280, 720, 256)).toEqual({ rw: 256, rh: 144, pw: 256, ph: 160 });
    expect(inputGeo(960, 540, 320)).toEqual({ rw: 320, rh: 180, pw: 320, ph: 192 });
    // portrait phone picture
    expect(inputGeo(720, 1280, 256)).toEqual({ rw: 144, rh: 256, pw: 160, ph: 256 });
  });

  it("never enlarges a small picture", () => {
    const g = inputGeo(160, 90, 256);
    expect(g.rw).toBe(160);
    expect(g.rh).toBe(90);
    expect(g.pw % 32).toBe(0);
    expect(g.ph % 32).toBe(0);
  });

  it("reuses the output object", () => {
    const o = { rw: 0, rh: 0, pw: 0, ph: 0 };
    expect(inputGeo(1280, 720, 192, o)).toBe(o);
    expect(o.rw).toBe(192);
  });
});

describe("decodeMultiPose", () => {
  const geo = inputGeo(1280, 720, 256); // 256x144 picture in a 256x160 tensor
  const pool = () => new PosePool();

  it("maps every MoveNet keypoint to its MediaPipe index", () => {
    const kp: Record<number, Kp> = {};
    for (let k = 0; k < 17; k++) kp[k] = [0.1 + k * 0.01, 0.2, 0.9];
    const p = pool();
    expect(decodeMultiPose(out(person(0.8, kp)), geo, p, 5)).toBe(1);
    const lm = p.view[0];
    expect(lm).toHaveLength(33);
    for (let k = 0; k < 17; k++) expect(lm[MN_TO_MP[k]].x).toBeCloseTo(0.1 + k * 0.01, 5);
    // nose 0, eyes 2/5, ears 7/8, shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, ankles 27/28
    expect([...MN_TO_MP]).toEqual([0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);
  });

  it("covers all 33 landmarks: indices MoveNet lacks sit on a neighbour with visibility 0", () => {
    const covered = new Set<number>([...MN_TO_MP, ...MP_FILL.map((f) => f[0])]);
    expect(covered.size).toBe(33);
    const p = pool();
    decodeMultiPose(out(person(0.8, { 1: [0.3, 0.4, 0.9], 9: [0.6, 0.7, 0.9] })), geo, p, 5);
    const lm = p.view[0];
    for (const [t, s] of MP_FILL) {
      expect(lm[t].visibility).toBe(0);
      expect(lm[t].x).toBe(lm[s].x);
      expect(lm[t].y).toBe(lm[s].y);
    }
    expect(lm[19].x).toBeCloseTo(lm[15].x, 6); // left index finger on the left wrist
    expect(lm[15].visibility).toBeGreaterThan(0.8);
  });

  it("undoes the padding: the picture is the top 144 of the 160 rows", () => {
    const p = pool();
    // a point at the bottom edge of the picture is at y = 144 / 160 = 0.9 of the tensor, x = 1
    decodeMultiPose(out(person(0.8, { 0: [1, 0.9, 0.9], 5: [0.5, 0.45, 0.9] })), geo, p, 5);
    expect(p.view[0][0].y).toBeCloseTo(1, 5);
    expect(p.view[0][0].x).toBeCloseTo(1, 5);
    expect(p.view[0][11].y).toBeCloseTo(0.5, 5);
  });

  it("filters people by score and keeps the best first, at most maxPeople", () => {
    const p = pool();
    const f = out(person(0.3, { 0: [0.1, 0.1, 0.9] }), person(0.1, { 0: [0.2, 0.2, 0.9] }), person(0.9, { 0: [0.3, 0.3, 0.9] }), person(0.6, { 0: [0.4, 0.4, 0.9] }));
    expect(decodeMultiPose(f, geo, p, 5)).toBe(3); // 0.1 < minPoseScore
    expect(p.view.map((l) => Math.round(l[0].x * 10))).toEqual([3, 4, 1]); // 0.9, 0.6, 0.3
    expect(Array.from(p.scores.slice(0, 3)).map((s) => Math.round(s * 10))).toEqual([9, 6, 3]);
    expect(decodeMultiPose(f, geo, p, 2)).toBe(2);
    expect(p.view).toHaveLength(2);
    expect(p.view[0][0].x).toBeCloseTo(0.3, 5);
    expect(decodeMultiPose(f, geo, p, 0)).toBe(0);
    expect(p.view).toHaveLength(0);
  });

  it("keypoint scores: below minKeypoint = visibility 0, otherwise calibrated to MediaPipe's scale (score / visScale, capped at 1)", () => {
    const p = pool();
    decodeMultiPose(out(person(0.8, { 0: [0.5, 0.5, CFG.minKeypoint - 0.01], 5: [0.5, 0.5, 0.3], 6: [0.5, 0.5, 1.7] })), geo, p, 5);
    expect(p.view[0][0].visibility).toBe(0);
    expect(p.view[0][11].visibility).toBeCloseTo(0.3 / CFG.visScale, 6);
    expect(p.view[0][12].visibility).toBe(1);
  });

  it("a small child's typical MoveNet scores (0.3-0.5) count as well seen: they pass the kid / hip checks written for MediaPipe", () => {
    const p = pool();
    decodeMultiPose(out(person(CFG.minPoseScore + 0.01, {}, [0.5, 0.5, 0.42])), geo, p, 5);
    expect(p.view).toHaveLength(1); // the lowered person threshold keeps a faint child
    expect(p.view[0][11].visibility).toBeGreaterThan(0.85);
  });

  it("an empty / garbage output gives nobody and does not throw", () => {
    const p = pool();
    expect(decodeMultiPose(new Float32Array(0), geo, p, 5)).toBe(0);
    expect(decodeMultiPose(out(person(NaN)), geo, p, 5)).toBe(0);
    const bad = person(0.9, { 0: [NaN, Infinity, 0.9] });
    expect(decodeMultiPose(out(bad), geo, p, 5)).toBe(1);
    expect(Number.isFinite(p.view[0][0].x)).toBe(true);
  });

  it("reuses the pool: the same arrays and objects come back", () => {
    const p = pool();
    decodeMultiPose(out(person(0.8)), geo, p, 5);
    const first = p.view[0];
    const o = first[11];
    decodeMultiPose(out(person(0.7, { 5: [0.9, 0.9, 0.9] })), geo, p, 5);
    expect(p.view[0]).toBe(first);
    expect(first[11]).toBe(o);
    expect(o.x).toBeCloseTo(0.9, 5);
  });

  it("through buildPeople: mirrored and cover-fitted exactly like a MediaPipe result", () => {
    // y values are given in the tensor (0.45 of 160 rows = 72 px = 0.5 of the 144 px picture)
    const kp: Record<number, Kp> = { 5: [0.25, 0.45, 0.9], 6: [0.75, 0.45, 0.9], 0: [0.5, 0.18, 0.9] }; // MoveNet 5 / 6 = shoulders (MediaPipe 11 / 12)
    const p = pool();
    decodeMultiPose(out(person(0.9, kp)), geo, p, 5);
    // 16:9 camera on a 16:9 stage
    const wide = computeFit(1600, 900, 1280, 720);
    const a = buildPeople({ landmarks: p.view }, wide)[0].lm;
    expect(a[11].x).toBeCloseTo(1600 * (1 - 0.25), 3); // the image's left side is the stage's right side (mirror)
    expect(a[12].x).toBeCloseTo(1600 * (1 - 0.75), 3);
    expect(a[11].y).toBeCloseTo(0.5 * 900, 3);
    // portrait phone stage: "cover" fills the height, the sides of the camera picture are cut
    const tall = computeFit(390, 844, 1280, 720);
    const b = buildPeople({ landmarks: p.view }, tall)[0].lm;
    expect(b[0].x).toBeCloseTo(390 - (tall.ox + 0.5 * tall.dw), 3);
    expect(b[0].y).toBeCloseTo(tall.oy + 0.2 * tall.dh, 3);
    expect(b[0].v).toBeCloseTo(1, 5); // score 0.9 / visScale, capped
  });
});

describe("SizeController", () => {
  const feed = (c: SizeController, t0: number, sec: number, ms: number): number => {
    let t = t0;
    while (t < t0 + sec) {
      c.report(t, ms);
      t += 1 / 30;
    }
    return t;
  };

  it("starts on the configured rung and stays while the time is in the comfortable band", () => {
    const c = new SizeController();
    expect(c.side).toBe(CFG.sides[CFG.startIdx]);
    feed(c, 0, 30, 50); // 50 ms at 256 px would be 78 ms at 320 px: no reason to go up, none to go down
    expect(c.side).toBe(CFG.sides[CFG.startIdx]);
  });

  it("goes smaller when the model is slow, not before downAfterSec", () => {
    const c = new SizeController();
    // start on the rung above the first normal one so the ordinary "down" threshold applies
    c.idx = 2; // 320
    const t = feed(c, 0, CFG.downAfterSec - 0.5, CFG.downMs + 20);
    expect(c.side).toBe(320);
    feed(c, t, CFG.downAfterSec + 2, CFG.downMs + 20);
    expect(c.side).toBe(256);
  });

  it("192 px is an emergency rung: not taken for an ordinary slow call, only above emergencyMs; left again only when clearly fast", () => {
    const c = new SizeController();
    expect(c.side).toBe(256);
    let t = feed(c, 0, 20, CFG.downMs + 20); // slow, but not hopeless: stays on 256
    expect(c.side).toBe(256);
    t = feed(c, t, CFG.downAfterSec + 2, CFG.emergencyMs + 30);
    expect(c.side).toBe(192);
    // at 192 the same device does ~ (emergencyMs + 30) / 1.78 = 84 ms: going back up to 256 would cost 150 ms, so it stays
    feed(c, t, 60, (CFG.emergencyMs + 30) / 1.78);
    expect(c.side).toBe(192);
    // a device that does 192 px in 30 ms (53 ms at 256) is fine at 256 again
    const d = new SizeController();
    d.idx = 0;
    feed(d, 0, 30, 30);
    expect(d.side).toBe(256);
  });

  it("does not drop to 192 px on the ladder's normal slow-down band (the old thresholds did after 1.5 s)", () => {
    const c = new SizeController();
    feed(c, 0, 30, 47); // the owner's laptop: a main-thread call took 47 ms
    expect(c.side).toBeGreaterThanOrEqual(256);
  });

  it("goes bigger when the area-scaled estimate stays under upMs, and ignores the first call after a change", () => {
    const c = new SizeController();
    feed(c, 0, CFG.upAfterSec - 1, 4);
    expect(c.side).toBe(256);
    let t = CFG.upAfterSec - 1;
    while (c.side === 256 && t < 30) c.report((t += 1 / 30), 4);
    expect(c.side).toBe(320);
    expect(c.ms).toBe(0); // the measurement restarts
    c.report(t, 900); // the first call after the change is the shader compile: huge, ignored
    expect(c.ms).toBe(0);
    c.report(t + 0.03, 5);
    expect(c.ms).toBe(5);
    // 30 ms at 256 would be 47 ms at 320 (> upMs): stays
    const c2 = new SizeController();
    feed(c2, 0, 60, 30);
    expect(c2.side).toBe(256);
  });

  it("waits for a rung that is not allowed yet (shaders not compiled) and moves as soon as it is", () => {
    const c = new SizeController();
    let ok = false;
    c.allow = (i) => i !== 2 || ok;
    let t = feed(c, 0, CFG.upAfterSec + 10, 4);
    expect(c.side).toBe(256); // the estimate says "go up", the next rung is not ready
    ok = true;
    t = feed(c, t, 1, 4);
    expect(c.side).toBe(320);
    // down: the same rule
    c.allow = () => false;
    feed(c, t + 10, 10, CFG.downMs + 30);
    expect(c.side).toBe(320);
    c.allow = () => true;
    feed(c, t + 21, 3, CFG.downMs + 30);
    expect(c.side).toBe(256);
  });

  it("a fixed size never changes", () => {
    const c = SizeController.fixedAt(330);
    expect(c.side).toBe(320);
    feed(c, 0, 30, 100);
    expect(c.side).toBe(320);
    feed(c, 30, 30, 1);
    expect(c.side).toBe(320);
  });
});
