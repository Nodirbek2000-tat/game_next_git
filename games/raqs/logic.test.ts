import { describe, expect, it } from "vitest";
import {
  GRADE_MISS, GRADE_PERFECT, POSE_ARMS_UP, POSE_COUNT, POSE_CROSS, POSE_HIPS, POSE_KNEE, POSE_LEFT_UP, POSE_RIGHT_UP, POSE_SQUAT, POSE_T,
  RaqsLogic, cardX, extract, makeFeat, poseMatch, type Lmv,
} from "./logic";

/** standing person: shoulders y 200, hips y 360 (torso 160), knees y 520. Landmark 11 = the user's left = screen-left (smaller x). */
function skel(over: Record<number, [number, number]> = {}): Lmv[] {
  const base: Record<number, [number, number]> = {
    0: [200, 140], 11: [160, 200], 12: [240, 200], 13: [150, 290], 14: [250, 290], 15: [150, 380], 16: [250, 380],
    23: [175, 360], 24: [225, 360], 25: [170, 520], 26: [230, 520],
  };
  const lm: Lmv[] = Array.from({ length: 33 }, () => ({ x: 200, y: 300, v: 1 }));
  for (const [k, [x, y]] of Object.entries({ ...base, ...over })) {
    lm[+k].x = x;
    lm[+k].y = y;
  }
  return lm;
}

function matches(lm: Lmv[]): number[] {
  const f = makeFeat();
  extract(lm, f);
  const out: number[] = [];
  for (let id = 0; id < POSE_COUNT; id++) if (poseMatch(id, f)) out.push(id);
  return out;
}

describe("raqs poses", () => {
  it("standing with arms down matches nothing", () => {
    expect(matches(skel())).toEqual([]);
  });
  it("arms up", () => {
    expect(matches(skel({ 15: [150, 60], 16: [250, 60], 13: [150, 130], 14: [250, 130] }))).toEqual([POSE_ARMS_UP]);
  });
  it("T pose", () => {
    expect(matches(skel({ 15: [30, 200], 16: [370, 200], 13: [100, 200], 14: [300, 200] }))).toEqual([POSE_T]);
  });
  it("one arm up, either side", () => {
    expect(matches(skel({ 15: [150, 60], 13: [150, 130] }))).toEqual([POSE_LEFT_UP]);
    expect(matches(skel({ 16: [250, 60], 14: [250, 130] }))).toEqual([POSE_RIGHT_UP]);
  });
  it("hands on hips needs the elbows out, arms down does not count", () => {
    expect(matches(skel({ 15: [170, 360], 16: [230, 360], 13: [120, 280], 14: [280, 280] }))).toEqual([POSE_HIPS]);
    expect(matches(skel({ 15: [165, 360], 16: [235, 360] }))).toEqual([]);
  });
  it("squat and knee lift need the knees", () => {
    expect(matches(skel({ 25: [170, 390], 26: [230, 390] }))).toEqual([POSE_SQUAT]);
    expect(matches(skel({ 25: [170, 380] }))).toEqual([POSE_KNEE]);
    const lm = skel({ 25: [170, 390], 26: [230, 390] });
    lm[25].v = 0;
    expect(matches(lm)).toEqual([]);
  });
  it("crossed wrists", () => {
    expect(matches(skel({ 15: [230, 280], 16: [170, 280] }))).toEqual([POSE_CROSS]);
  });
  it("untracked shoulders give no features", () => {
    const lm = skel();
    lm[11].v = 0;
    const f = makeFeat();
    expect(extract(lm, f)).toBe(false);
    expect(poseMatch(POSE_ARMS_UP, f)).toBe(false);
  });
});

describe("raqs timing", () => {
  it("cards travel toward the line", () => {
    expect(cardX(10, 10, 80, 480)).toBe(80);
    expect(cardX(10, 6.8, 80, 480)).toBeCloseTo(480);
  });
  it("the right pose at the right time is Perfect, the wrong one is a Miss", () => {
    const grades: number[] = [];
    const g = new RaqsLogic(60, () => 0, { judge: (_c, gr) => grades.push(gr) });
    const up = makeFeat();
    extract(skel({ 15: [150, 60], 16: [250, 60] }), up);
    const rest = makeFeat();
    extract(skel(), rest);
    for (let i = 0; i < 80; i++) g.update(0.05, i * 0.05 < 3.4 ? rest : up); // first card (arms up) is due at 3.6 s
    expect(grades[0]).toBe(GRADE_PERFECT);
    expect(g.combo).toBe(1);
    expect(g.score).toBeGreaterThanOrEqual(100);
    // never move: every following card is missed
    for (let i = 0; i < 100; i++) g.update(0.05, rest);
    expect(grades.includes(GRADE_MISS)).toBe(true);
    expect(g.combo).toBe(0);
    expect(g.bestCombo).toBe(1);
  });
  it("never repeats a pose twice in a row and skips leg poses without legs", () => {
    const poses: number[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const g = new RaqsLogic(60, rnd, { judge: () => undefined });
    const f = makeFeat();
    f.ok = true;
    f.legs = false;
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      g.update(0.05, f);
      for (const c of g.cards) if (c.on && !seen.has(c.hit)) {
        seen.add(c.hit);
        poses.push(c.pose);
      }
      if (g.over) break;
    }
    expect(poses.length).toBeGreaterThan(20);
    for (let i = 1; i < poses.length; i++) expect(poses[i]).not.toBe(poses[i - 1]);
    expect(poses.some((p) => p === POSE_SQUAT || p === POSE_KNEE)).toBe(false);
  });
});
