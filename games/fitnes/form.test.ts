import { describe, expect, it } from "vitest";
import { angle, flex, makeAnalyser, type Lm } from "./form";

// Synthetic people in a 1000 x 800 picture, shoulder width 100 px, facing the camera unless said otherwise.
const H = 800;
const S = 100;
type Pt = [number, number];
function body(p: Partial<Record<number, Pt>>): Lm[] {
  const base: Record<number, Pt> = {
    0: [500, 100],
    11: [450, 200],
    12: [550, 200],
    13: [430, 300],
    14: [570, 300],
    15: [420, 380],
    16: [580, 380],
    23: [465, 400],
    24: [535, 400],
    25: [465, 550],
    26: [535, 550],
    27: [465, 700],
    28: [535, 700],
  };
  const out: Lm[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
  for (const [k, v] of Object.entries({ ...base, ...p })) if (v) out[Number(k)] = { x: v[0], y: v[1], v: 0.95 };
  return out;
}
const stand = body({});
/** facing the camera at the bottom of a squat: the hips came down to knee height, knees out */
const squatLow = body({ 0: [500, 260], 11: [450, 350], 12: [550, 350], 15: [420, 470], 16: [580, 470], 23: [460, 545], 24: [540, 545], 25: [430, 560], 26: [570, 560] });
const squatHalf = body({ 0: [500, 180], 11: [450, 280], 12: [550, 280], 23: [462, 470], 24: [538, 470], 25: [455, 555], 26: [545, 555] });

function run(id: Parameters<typeof makeAnalyser>[0], frames: Lm[][], each = 10, dt = 1 / 30) {
  const a = makeAnalyser(id);
  const cues = new Set<string>();
  let goodFrames = 0;
  let n = 0;
  for (const f of frames)
    for (let i = 0; i < each; i++) {
      const r = a.update(f, S, H, dt);
      if (r.cue) cues.add(r.cue);
      if (r.good) goodFrames++;
      n++;
    }
  return { a, cues, goodRatio: goodFrames / n };
}

describe("geometry", () => {
  it("angle and leg flex", () => {
    expect(angle({ x: 0, y: 0, v: 1 }, { x: 0, y: 10, v: 1 }, { x: 0, y: 20, v: 1 })).toBeCloseTo(180);
    expect(angle({ x: 10, y: 0, v: 1 }, { x: 0, y: 0, v: 1 }, { x: 0, y: 10, v: 1 })).toBeCloseTo(90);
    expect(flex(stand[23], stand[25], stand[27])).toBeLessThan(0.1);
    expect(flex(squatLow[23], squatLow[25], squatLow[27])).toBeGreaterThan(0.8);
  });
});

describe("squat", () => {
  it("counts a full squat, not a shallow one (and says so)", () => {
    const full = run("squat", [stand, squatLow, stand, squatLow, stand]);
    expect(full.a.reps).toBe(2);
    const shallow = run("squat", [stand, squatHalf, stand]);
    expect(shallow.a.reps).toBe(0);
    expect([...shallow.cues].some((c) => c.startsWith("Pastroq"))).toBe(true);
  });
  it("asks to step back when the feet are not seen", () => {
    const noFeet = body({});
    noFeet[27].v = 0;
    const r = run("squat", [noFeet]);
    expect([...r.cues][0]).toMatch(/Orqaroq/);
    expect(r.a.reps).toBe(0);
  });
});

describe("jumping jack", () => {
  const open = body({ 15: [400, 40], 16: [600, 40], 13: [410, 120], 14: [590, 120], 27: [380, 700], 28: [620, 700], 25: [420, 550], 26: [580, 550] });
  it("open then closed = 1 rep", () => {
    const r = run("jack", [stand, open, stand, open, stand], 12);
    expect(r.a.reps).toBe(2);
  });
});

describe("high knees", () => {
  const leftUp = body({ 25: [465, 410], 27: [465, 540] });
  const rightUp = body({ 26: [535, 410], 28: [535, 540] });
  it("alternating knees count one each; the same knee twice counts once", () => {
    expect(run("knees", [stand, leftUp, stand, rightUp, stand, leftUp, stand], 6).a.reps).toBe(3);
    expect(run("knees", [stand, leftUp, stand, leftUp, stand], 6).a.reps).toBe(1);
  });
});

describe("plank (side view)", () => {
  const straight = body({ 11: [300, 500], 23: [500, 520], 25: [600, 530], 27: [700, 540], 12: [300, 500], 24: [500, 520], 26: [600, 530], 28: [700, 540] });
  const hipsUp = body({ 11: [300, 500], 23: [500, 420], 25: [600, 480], 27: [700, 540], 12: [300, 500], 24: [500, 420], 26: [600, 480], 28: [700, 540] });
  it("times a straight body, corrects raised hips, ignores standing", () => {
    const ok = run("plank", [straight], 60);
    expect(ok.a.held).toBeGreaterThan(1.9);
    const up = run("plank", [hipsUp], 60);
    expect(up.a.held).toBeLessThan(0.6);
    expect([...up.cues]).toContain("Belni pastroq tushiring");
    expect(run("plank", [stand], 60).a.held).toBeLessThan(0.6);
  });
});

describe("tree", () => {
  const tree = body({ 15: [480, 40], 16: [520, 40], 27: [520, 520], 25: [420, 480] });
  it("one foot up at the other knee, hands up = held", () => {
    expect(run("daraxt", [tree], 60).a.held).toBeGreaterThan(1.9);
    const handsDown = body({ 27: [520, 520], 25: [420, 480] });
    const r = run("daraxt", [handsDown], 60);
    expect(r.a.held).toBeLessThan(0.6);
    expect([...r.cues]).toContain("Qo‘llarni boshdan yuqori ko‘taring");
  });
});

describe("warrior II", () => {
  const warrior = body({ 15: [250, 205], 16: [750, 205], 13: [350, 205], 14: [650, 205], 23: [470, 470], 24: [530, 470], 25: [330, 480], 26: [620, 580], 27: [330, 700], 28: [700, 700] });
  it("wide stance, bent front knee, arms level = held; arms down are corrected", () => {
    expect(run("jangchi", [warrior], 60).a.held).toBeGreaterThan(1.9);
    const armsDown = body({ 23: [470, 470], 24: [530, 470], 25: [330, 480], 26: [620, 580], 27: [330, 700], 28: [700, 700] });
    const r = run("jangchi", [armsDown], 60);
    expect(r.a.held).toBeLessThan(0.6);
    expect([...r.cues][0]).toMatch(/Qo‘llarni/);
  });
});

describe("boxing crosses", () => {
  const guard = body({ 15: [470, 170], 16: [530, 170], 13: [440, 260], 14: [560, 260] });
  // the left fist (lm 15, on the left of the nose) crosses to the right at face height, then the right one to the left
  const crossL = body({ 15: [580, 150], 16: [530, 170], 13: [480, 220], 14: [560, 260] });
  const crossR = body({ 15: [470, 170], 16: [420, 150], 13: [440, 260], 14: [520, 220] });
  it("counts alternating crosses, not the same fist twice", () => {
    expect(run("boks", [guard, crossL, guard, crossR, guard, crossL, guard], 5).a.reps).toBe(3);
    expect(run("boks", [guard, crossL, guard, crossL, guard], 5).a.reps).toBe(1);
  });
});

describe("overhead reach", () => {
  const atShoulders = body({ 15: [440, 210], 16: [560, 210], 13: [400, 260], 14: [600, 260] });
  const overhead = body({ 15: [450, 10], 16: [550, 10], 13: [440, 100], 14: [560, 100] });
  const half = body({ 15: [450, 130], 16: [550, 130], 13: [420, 180], 14: [580, 180] });
  it("a full lift counts, a half lift is corrected", () => {
    expect(run("tepaga", [atShoulders, overhead, atShoulders, overhead, atShoulders]).a.reps).toBe(2);
    const r = run("tepaga", [atShoulders, half, atShoulders]);
    expect(r.a.reps).toBe(0);
    expect([...r.cues]).toContain("Qo‘llarni to‘liq tepaga cho‘zing");
  });
});

describe("knee to elbow", () => {
  const handsHead = { 15: [480, 90] as Pt, 16: [520, 90] as Pt, 13: [420, 150] as Pt, 14: [580, 150] as Pt };
  const ready = body(handsHead);
  // left knee (25) up to the right elbow (14), then the right knee up to the left elbow
  const leftUp = body({ ...handsHead, 14: [540, 330], 25: [510, 400], 27: [490, 530] });
  const rightUp = body({ ...handsHead, 13: [460, 330], 26: [490, 400], 28: [510, 530] });
  it("alternating sides count", () => {
    expect(run("tirsak", [ready, leftUp, ready, rightUp, ready], 6).a.reps).toBe(2);
  });
});

describe("side steps", () => {
  const at = (dx: number) => {
    const o: Record<number, Pt> = {};
    for (const k of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) o[k] = [body({})[k].x + dx, body({})[k].y];
    return body(o);
  };
  it("left and right of the middle, one rep each", () => {
    const frames: Lm[][] = [];
    for (let i = 0; i < 4; i++) frames.push(at(0), at(-80), at(0), at(80));
    frames.push(at(0));
    expect(run("yonqadam", frames, 15).a.reps).toBeGreaterThanOrEqual(6);
  });
  it("standing still counts nothing", () => {
    expect(run("yonqadam", [stand], 200).a.reps).toBe(0);
  });
});

describe("side leg raise", () => {
  const leftOut = body({ 27: [330, 620], 25: [400, 520] });
  const rightOut = body({ 28: [670, 620], 26: [600, 520] });
  it("alternating legs count; a small lift is corrected", () => {
    expect(run("yonoyoq", [stand, leftOut, stand, rightOut, stand], 8).a.reps).toBe(2);
    const small = body({ 27: [420, 660] });
    const r = run("yonoyoq", [stand, small, stand], 30);
    expect(r.a.reps).toBe(0);
  });
});

describe("side bend", () => {
  const up = { 15: [480, 40] as Pt, 16: [520, 40] as Pt };
  const centre = body(up);
  const left = body({ ...up, 11: [380, 220], 12: [470, 180], 0: [400, 110] });
  const right = body({ ...up, 11: [530, 180], 12: [620, 220], 0: [600, 110] });
  it("left and right alternate, one rep each", () => {
    expect(run("egilish", [centre, left, centre, right, centre], 8).a.reps).toBe(2);
  });
  it("asks for the arms up", () => {
    expect([...run("egilish", [stand]).cues]).toContain("Qo‘llarni tepaga ko‘taring");
  });
});
