import { beforeEach, describe, expect, it } from "vitest";
import { kcal } from "@/lib/fitness/exercises";
import { dayKey, planFor, planKcal, planMinutes } from "@/lib/fitness/plan";
import { loadFitness, recordSession, saveFitness, streak, emptyData } from "@/lib/fitness/store";
import type { Lm } from "./form";
import { INTRO_SEC, Session } from "./session";

function body(p: Record<number, [number, number]>): Lm[] {
  const base: Record<number, [number, number]> = { 0: [500, 100], 11: [450, 200], 12: [550, 200], 13: [430, 300], 14: [570, 300], 15: [420, 380], 16: [580, 380], 23: [465, 400], 24: [535, 400], 25: [465, 550], 26: [535, 550], 27: [465, 700], 28: [535, 700] };
  const out: Lm[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
  for (const [k, v] of Object.entries({ ...base, ...p })) out[Number(k)] = { x: v[0], y: v[1], v: 0.95 };
  return out;
}
const stand = body({});
const low = body({ 0: [500, 260], 11: [450, 350], 12: [550, 350], 15: [420, 470], 16: [580, 470], 23: [460, 545], 24: [540, 545], 25: [430, 560], 26: [570, 560] });

const tick = (s: Session, lm: Lm[] | null, sec: number): void => {
  for (let t = 0; t < sec; t += 1 / 30) s.update(1 / 30, lm, 100, 800);
};

describe("Session", () => {
  it("intro -> work (counts squats, adds kcal) -> rest -> next exercise -> done", () => {
    const s = new Session([{ ex: "squat", amount: 2 }, { ex: "squat", amount: 1 }], 3, 80);
    expect(s.phase).toBe("intro");
    tick(s, stand, INTRO_SEC + 0.1);
    expect(s.phase).toBe("work");
    for (let i = 0; i < 2; i++) {
      tick(s, low, 0.5);
      tick(s, stand, 0.5);
    }
    expect(s.phase).toBe("rest");
    expect(s.results[0]).toMatchObject({ reps: 2, done: true });
    expect(s.kcal).toBeGreaterThan(0);
    tick(s, stand, 3.1);
    expect(s.phase).toBe("intro");
    expect(s.index).toBe(1);
    tick(s, stand, INTRO_SEC + 0.1);
    tick(s, low, 0.5);
    tick(s, stand, 0.5);
    expect(s.phase).toBe("done");
    expect(s.allDone).toBe(true);
    expect(s.reps).toBe(3);
  });
  it("a person who does not manage goes on after the time cap (not stuck forever); nobody seen burns nothing", () => {
    const s = new Session([{ ex: "squat", amount: 10 }], 0, 70);
    tick(s, stand, INTRO_SEC + 0.1);
    const k0 = s.kcal;
    tick(s, null, 5);
    expect(s.kcal).toBe(k0);
    tick(s, stand, 120);
    expect(s.phase).toBe("done");
    expect(s.allDone).toBe(false);
  });
});

describe("plan + kcal", () => {
  it("MET formula: 8 MET, 70 kg, 30 min = 280 kcal", () => {
    expect(kcal(8, 70, 1800)).toBeCloseTo(280);
  });
  it("every weekday has a plan of a few minutes; a higher level is longer", () => {
    for (let d = 0; d < 7; d++) {
      const day = new Date(2026, 10, 8 + d);
      const p1 = planFor(day, 1);
      const p3 = planFor(day, 3);
      expect(p1.steps.length).toBeGreaterThanOrEqual(4);
      expect(planMinutes(p1)).toBeGreaterThanOrEqual(2);
      expect(planMinutes(p1)).toBeLessThanOrEqual(15);
      expect(planKcal(p3, 70)).toBeGreaterThan(planKcal(p1, 70));
    }
  });
});

describe("store", () => {
  beforeEach(() => localStorage.clear());
  it("adds sessions to the day, keeps profile values, counts the streak", () => {
    const d = emptyData();
    d.weightKg = 82;
    saveFitness(d);
    const day1 = new Date(2026, 10, 8, 10);
    const day2 = new Date(2026, 10, 9, 10);
    recordSession({ kcal: 20, sec: 300, reps: 40, planDone: true }, day1);
    recordSession({ kcal: 10, sec: 120, reps: 10, planDone: false }, day2);
    recordSession({ kcal: 5, sec: 60, reps: 5, planDone: false }, day2);
    const back = loadFitness();
    expect(back.weightKg).toBe(82);
    expect(back.days[dayKey(day2)]).toMatchObject({ kcal: 15, sessions: 2, planDone: false });
    expect(back.days[dayKey(day1)].planDone).toBe(true);
    expect(streak(back, day2)).toBe(2);
    expect(streak(back, new Date(2026, 10, 10, 9))).toBe(2); // today not done yet: yesterday's streak still counts
    expect(streak(back, new Date(2026, 10, 12, 9))).toBe(0);
  });
  it("broken storage falls back to the defaults", () => {
    localStorage.setItem("harakat.fitness.v1", "{bad");
    expect(loadFitness()).toEqual(emptyData());
  });
});
